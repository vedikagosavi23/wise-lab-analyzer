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

    const prompt = `
  You are a medical assistant AI. An image or PDF of a lab report has been uploaded.
  Extract all test results clearly and convert them into a valid JSON array in the format below:

  [
    {
      "test_name": "Test name here",
      "value": "Measured value",
      "unit": "Unit (if any)",
      "reference_range": "Reference range (if available)",
      "interpretation": "Low / Normal / High / Critical / Unknown"
    }
  ]

  Rules:
  - Output only valid JSON. Do not use markdown code fences or extra explanation—return a single JSON array as defined above and nothing else.
  - If something is missing (e.g., unit or reference range), use an empty string "".
  - Include all tests listed in the report (e.g., CBC, thyroid, lipid, urine, etc.).
  - Return at least an empty array [] if no tests are found.
  - Do NOT output any formatting, explanation, or prose—JSON only, one array, one line.
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
          { role: "system", content: "You extract structured lab data from medical reports." },
          { role: "user", content: prompt },
          { role: "user", content: [{ type: "image_url", image_url: { url: file_url } }] }
        ],
        max_tokens: 1800,
        temperature: 0.2,
        tools: []
      })
    });

    const data = await response.json();
    const aiContent = data?.choices?.[0]?.message?.content ?? "";
    console.log("Raw AI output:", aiContent);

    // Robust parsing logic: always return aiContent (even on errors)
    let json: any = [];
    let parseError: string | null = null;
    try {
      let clean = aiContent || "";
      clean = clean.replace(/```json\s*|```/gi, '').trim();
      const firstBracket = clean.indexOf('[');
      const lastBracket = clean.lastIndexOf(']');
      if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) {
        if (!clean || clean === "") {
          json = [];
        } else {
          // try fallback: parse as empty array; save parse error
          throw new Error("Could not locate JSON array in output.");
        }
      } else {
        clean = clean.substring(firstBracket, lastBracket + 1).trim();
        json = JSON.parse(clean);
      }
    } catch (err) {
      parseError = (err as Error).message || String(err);
      json = [];
    }

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
