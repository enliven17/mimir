/**
 * Sanity check: callLLM works with whichever provider is configured.
 * Run: npx tsx --env-file=.env.local scripts/test-llm.ts
 */
import { callLLM, activeLLMProvider, activeLLMModel } from "../lib/llm";

async function main(): Promise<void> {
  console.log(`Provider: ${activeLLMProvider()} / ${activeLLMModel()}\n`);
  const prompt = `You are Mimir, a prediction-market oracle. Reply with JSON only.

Claim: "Bitcoin closes above $100,000 USD by end of 2026-05-17 UTC."
Evidence: According to CoinGecko, BTC price is currently $107,432.

Return:
{ "verdict": "CREATOR_WINS" | "CHALLENGERS_WIN" | "DRAW" | "UNRESOLVABLE",
  "confidence": <0-100>,
  "explanation": "<one sentence>" }`;

  const text = await callLLM(prompt, { maxTokens: 256, jsonOnly: true });
  console.log("Raw response:");
  console.log(text);

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in response");
  const json = JSON.parse(match[0]);
  console.log("\nParsed:");
  console.log(`  verdict   : ${json.verdict}`);
  console.log(`  confidence: ${json.confidence}`);
  console.log(`  reason    : ${json.explanation}`);

  console.log("\n✓ LLM integration works");
}

main().catch((e) => { console.error("\nFailed:", e?.message ?? e); process.exit(1); });
