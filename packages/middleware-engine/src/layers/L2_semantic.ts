import type { LayerResult } from "@ios-plus/shared";
import OpenAI from "openai";

export interface L2Output { detectedActivity: string; entities: string[]; intent: string; }

export async function runL2(normalizedInput: string): Promise<LayerResult & { output: L2Output }> {
  const start = Date.now();
  
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error("OpenAI API Key is missing. Cannot perform semantic classification.");
  }

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a compliance semantic classifier. Parse the user query and output a JSON object with three keys: 'detectedActivity' (a brief verb-noun phrase of the primary action, e.g. 'Read grades', 'Access patient charts'), 'entities' (an array of sensitive entities or nouns mentioned), and 'intent' (e.g. 'query', 'command', 'update')."
        },
        {
          role: "user",
          content: normalizedInput
        }
      ],
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(completion.choices[0]?.message.content ?? "{}");
    const output: L2Output = {
      detectedActivity: parsed.detectedActivity ?? normalizedInput.slice(0, 64),
      entities: parsed.entities ?? [],
      intent: parsed.intent ?? "query",
    };
    return { layer: 2, success: true, latencyMs: Date.now() - start, output };
  } catch (err) {
    throw new Error(`Layer 2 Semantic Classification failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

