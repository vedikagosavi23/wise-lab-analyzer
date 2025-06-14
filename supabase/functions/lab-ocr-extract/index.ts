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
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! // requires service role to insert labs
    );
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      return new Response(JSON.stringify({ error: 'OpenAI API key not set' }), { status: 500, headers: corsHeaders });
    }

    // Compose prompt and OpenAI Vision request
    const prompt = `
      You are an expert in laboratory medicine. Analyze the following lab report image or PDF and extract the results in this JSON format:
      [{
        "test_name": string,
        "value": number | null,
        "unit": string | null,
        "normal_range": string | null,
        "status": string | null,
        "severity": string | null,
        "explanation": string | null,
        "recommendations": string[] | null
      }]

      Only output valid parseable JSON, no prose, explanation, or markdown.
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

    // Log the raw AI output for better debugging
    console.log("Raw AI output:", aiContent);

    // Attempt to parse: robust cleaning of AI output
    let json: any = [];
    try {
      let clean = aiContent;
      // Remove '```json' or '```' with or without spaces, at start and end
      clean = clean.replace(/```json\s*|```/gi, '');
      clean = clean.trim();

      // Look for the first '[' and the last ']' to extract the JSON array
      const firstBracket = clean.indexOf('[');
      const lastBracket = clean.lastIndexOf(']');
      if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) {
        throw new Error("Could not locate JSON array in output.");
      }
      clean = clean.substring(firstBracket, lastBracket + 1);

      // Final trim and parse
      json = JSON.parse(clean);
    } catch (err) {
      // Always include the raw AI output AND error
      return new Response(
        JSON.stringify({
          error: "Could not parse AI output",
          aiContent,
          parseError: (err as Error).message || String(err)
        }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Sanity: array of lab tests, insert into lab_results
    let insertErrors = [];
    for (const r of json) {
      const { error } = await supabaseClient.from("lab_results").insert({
        file_id,
        test_name: r.test_name,
        value: r.value,
        unit: r.unit,
        normal_range: r.normal_range,
        status: r.status,
        severity: r.severity,
        explanation: r.explanation,
        recommendations: r.recommendations,
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
    // Improved error: always provide .aiContent if present
    const aiContent = (error && typeof error === "object" && "aiContent" in error) ? (error as any).aiContent : undefined;
    return new Response(JSON.stringify({
      error: (error as Error).message,
      aiContent
    }), { status: 500, headers: corsHeaders });
  }
});
