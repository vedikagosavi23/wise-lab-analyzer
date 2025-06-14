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

    // New: Use a stricter and more explicit prompt
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

    // Call OpenAI Vision (gpt-4o, image/file tool)
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

    // More robust parsing logic
    let json: any = [];
    try {
      let clean = aiContent || "";
      clean = clean.replace(/```json\s*|```/gi, '').trim();
      // Look for the first '[' and last ']'
      const firstBracket = clean.indexOf('[');
      const lastBracket = clean.lastIndexOf(']');
      if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) {
        // If the model returns truly nothing, fallback to []
        if (!clean || clean === "") {
          json = [];
        } else {
          throw new Error("Could not locate JSON array in output.");
        }
      } else {
        clean = clean.substring(firstBracket, lastBracket + 1).trim();
        json = JSON.parse(clean);
      }
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Could not parse AI output",
          aiContent,
          parseError: (err as Error).message || String(err)
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Insert into lab_results table (new schema with new fields)
    let insertErrors = [];
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

    // If zero results, include aiContent in the response for debugging
    if (json.length === 0) {
      return new Response(
        JSON.stringify({
          extracted: 0,
          aiContent,
          parse_debug: "No results extracted; check aiContent for what AI returned.",
          insert_errors: insertErrors,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
    const aiContent = (error && typeof error === "object" && "aiContent" in error) ? (error as any).aiContent : undefined;
    return new Response(JSON.stringify({
      error: (error as Error).message,
      aiContent
    }), { status: 500, headers: corsHeaders });
  }
});
