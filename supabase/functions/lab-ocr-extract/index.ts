
// Enable XHR for OpenAI vision/file fetch support
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

    const prompt = `Extract lab test results in valid JSON format from the uploaded report.
Return only a JSON array of objects like:
[
  {
    "test_name": "Hemoglobin",
    "value": "12.5",
    "unit": "g/dL",
    "reference_range": "12-16",
    "interpretation": "Normal"
  }
]
Rules:
- If a field is missing, output an empty string for it ("").
- If no results, output an empty array [].
- Do not include explanations, markdown, or any other text—strictly JSON array only.`;

    // Call OpenAI Vision API with forced JSON response
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAIApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You extract structured lab test results from medical reports. Return only a JSON array as described." },
          { role: "user", content: prompt },
          { role: "user", content: [{ type: "image_url", image_url: { url: file_url } }] }
        ],
        max_tokens: 1800,
        temperature: 0.2,
        tools: [],
        response_format: { type: "json_object" } // Force JSON
      })
    });

    const data = await response.json();
    let aiContent: string = "";
    let json: any = [];
    let parseError: string | null = null;
    // With `response_format: json_object` OpenAI will return an object with likely a single field containing the array, e.g. { "results": [...] }
    // We'll find the array value inside the object.
    try {
      const obj = data?.choices?.[0]?.message?.content
        ? JSON.parse(data.choices[0].message.content)
        : {};
      aiContent = data.choices?.[0]?.message?.content ?? "";
      // Try to find any top-level array property (for "results" or similar)
      let arr: any = null;
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) arr = v;
      }
      json = arr ?? [];
    } catch (err) {
      parseError = (err as Error).message || String(err);
      json = [];
    }
    console.log("Raw AI output:", aiContent);

    // If still no valid lab results, log and insert a fallback dummy row
    let insertErrors: string[] = [];
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
        explanation: aiContent ? "OCR/AI could not extract valid lab test data from this file." : "No text returned from AI at all.",
        recommendations: null,
      });
      if (error) insertErrors.push(error.message);
      return new Response(
        JSON.stringify({
          extracted: 0,
          aiContent,
          parse_debug: "No results extracted; check aiContent for what AI returned.",
          parseError,
          insert_errors: insertErrors,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normal data insertion
    for (const r of json) {
      const { error } = await supabaseClient.from("lab_results").insert({
        file_id,
        test_name: r.test_name || "",
        value: r.value || "",
        unit: r.unit ?? "",
        normal_range: r.reference_range ?? "",
        status: r.interpretation ?? "",
        severity: null,
        explanation: null,
        recommendations: null,
      });
      if (error) insertErrors.push(error.message);
    }

    return new Response(
      JSON.stringify({
        extracted: json.length,
        aiContent,
        insert_errors: insertErrors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    // Ensure error responses always include full context
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

// end of file
