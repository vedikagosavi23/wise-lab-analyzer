import "https://deno.land/x/xhr@0.1.0/mod.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { file_url, file_id } = await req.json();
    if (!file_url || !file_id) {
      return new Response(JSON.stringify({ error: "file_url and file_id are required" }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': "application/json" }
      });
    }

    // Set up Supabase client for db save
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      return new Response(JSON.stringify({ error: 'OpenAI API key not set' }), { status: 500, headers: corsHeaders });
    }

    // 1. Extract detailed lab results as before
    const prompt = `
Extract all lab test result values from the uploaded report, returning ONLY a JSON array of objects as below, each with a concise layman explanation and recommendations:

[
  {
    "test_name": "Hemoglobin",
    "value": "12.5",
    "unit": "g/dL",
    "reference_range": "12-16",
    "interpretation": "Normal",
    "explanation": "Hemoglobin is a protein in red blood cells. Your value is within the healthy range, which means your blood can carry oxygen well.",
    "recommendations": [
        "No action needed if you feel well.",
        "Maintain a balanced diet.",
        "Check with your doctor during your next visit."
    ]
  }
]

Instructions:
- Output only a valid JSON array, no markdown, headings or commentary.
- For every test, ALWAYS fill in a short, patient-friendly summary under "explanation", and 1-3 simple health tips in "recommendations".
- Use empty strings "" where data is missing, and an empty array [] for missing recommendations.
- If no results, just return [].
- Again, return only the pure JSON array as described above—absolutely no extra text or formatting.
`;

    // Call OpenAI Vision API
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAIApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You're an expert in extracting and explaining medical lab test results for patients. You respond only with the required JSON array as defined below, with patient-friendly explanations and simple actionable recommendations for each result." },
          { role: "user", content: prompt },
          { role: "user", content: [{ type: "image_url", image_url: { url: file_url } }] }
        ],
        max_tokens: 1800,
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    let aiContent: string = "";
    let json: any = [];
    let parseError: string | null = null;

    try {
      const obj = data?.choices?.[0]?.message?.content
        ? JSON.parse(data.choices[0].message.content)
        : {};
      aiContent = data.choices?.[0]?.message?.content ?? "";
      // Find the first top-level array (in case key name varies)
      let arr: any = null;
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) arr = v;
      }
      if (Array.isArray(obj)) arr = obj;
      json = arr ?? [];
    } catch (err) {
      parseError = (err as Error).message || String(err);
      json = [];
    }

    console.log("Raw AI output:", typeof aiContent === "string" ? aiContent : JSON.stringify(aiContent));

    // Fallback for empty/blank/format errors
    let insertErrors: string[] = [];
    let summaryText: string = "";

    if (!Array.isArray(json) || json.length === 0) {
      // Insert a fallback "no results" entry for user feedback
      const { error } = await supabaseClient.from("lab_results").insert({
        file_id,
        test_name: "No readable lab results found.",
        value: null,
        unit: "",
        normal_range: "",
        status: "",
        severity: "",
        explanation: aiContent && `${aiContent}`.trim() !== "" ? aiContent : "No text returned from AI at all.",
        recommendations: null,
      });
      if (error) insertErrors.push(error.message);
      // Generate a summary even for empty/no-results reports
      summaryText = aiContent && `${aiContent}`.trim() !== "" ? "No extractable results. The report could not be interpreted by AI." : "No summary available.";
      // Save summary to uploaded_files
      await supabaseClient
        .from("uploaded_files")
        .update({ summary: summaryText })
        .eq("id", file_id);
      return new Response(
        JSON.stringify({
          extracted: 0,
          aiContent,
          summary: summaryText,
          parse_debug: "No results extracted; check aiContent for AI's raw output.",
          parseError,
          insert_errors: insertErrors,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Insert all extracted results as before
    for (const r of json) {
      const { error } = await supabaseClient.from("lab_results").insert({
        file_id,
        test_name: r.test_name || "",
        value: r.value || "",
        unit: r.unit ?? "",
        normal_range: r.reference_range ?? "",
        status: r.interpretation ?? "",
        severity: null,
        explanation: r.explanation ?? "",
        recommendations: r.recommendations ?? [],
      });
      if (error) insertErrors.push(error.message);
    }

    // 3. Generate a summary for the whole report via OpenAI
    // Use only the extracted array, send back for summarization
    let summaryPrompt = `
Given the following patient lab test results:
${JSON.stringify(json, null, 2)}

Write a single, concise summary for the patient in plain language that gives an overview of the results, highlights anything abnormal or important, and reassures them as appropriate. Do not include individual test value tables. If most results are normal, say so simply. If any results are abnormal or critical, describe the concern in simple, reassuring wording. DO NOT provide medical advice, just general, understandable guidance. Use 2-5 sentences.`;
    let summaryResponse, summaryData, summaryTextRaw;

    try {
      summaryResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openAIApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You're a kind and knowledgeable medical AI. Write only a plain-language summary of the lab results, as if explaining to a patient, in 2-5 sentences." },
            { role: "user", content: summaryPrompt }
          ],
          max_tokens: 350,
          temperature: 0.2,
        })
      });
      summaryData = await summaryResponse.json();
      summaryTextRaw = summaryData?.choices?.[0]?.message?.content?.trim() || "";
      summaryText = summaryTextRaw.replace(/^\s*["']?|\s*["']?$/g, ""); // Remove wrapping quotes if present

      // Save the summary into the uploaded_files row
      await supabaseClient
        .from("uploaded_files")
        .update({ summary: summaryText })
        .eq("id", file_id);
    } catch (err) {
      summaryText = "";
    }

    return new Response(
      JSON.stringify({
        extracted: json.length,
        aiContent,
        summary: summaryText,
        insert_errors: insertErrors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    let aiContent = undefined;
    let parseError = undefined;
    if (typeof error === "object" && error !== null) {
      if ("aiContent" in error) aiContent = (error as any).aiContent;
      if ("parseError" in error) parseError = (error as any).parseError;
    }
    return new Response(JSON.stringify({
      error: (error as Error).message,
      aiContent,
      parseError
    }), { status: 500, headers: corsHeaders });
  }
});
