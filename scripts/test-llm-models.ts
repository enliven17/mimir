/**
 * Probe which Gemini/Gemma model ids actually return data, per agent key.
 * Confirms the exact ids to put in GEMINI_MODELS and that each key is valid.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/test-llm-models.ts
 *
 * Add candidate ids:  MODELS="gemma-4-26b-it,gemma-4-31b-it" npx tsx ...
 * Keys are never printed — only their source name.
 */

const CANDIDATE_MODELS = (process.env.MODELS ??
  "gemma-4-26b-it,gemma-4-31b-it,gemma-3-27b-it,gemini-2.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash")
  .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

const KEYS: Array<{ source: string; key?: string }> = [
  { source: "GEMINI_API_KEY", key: process.env.GEMINI_API_KEY },
  { source: "ORACLE_GEMINI_API_KEY", key: process.env.ORACLE_GEMINI_API_KEY },
  { source: "COUNCIL_GEMINI_API_KEY", key: process.env.COUNCIL_GEMINI_API_KEY },
  { source: "CREATOR_GEMINI_API_KEY", key: process.env.CREATOR_GEMINI_API_KEY },
].filter((k) => k.key && k.key.trim().length > 0);

async function probe(apiKey: string, model: string): Promise<string> {
  const isGemma = model.toLowerCase().startsWith("gemma");
  const generationConfig: Record<string, unknown> = { temperature: 0, maxOutputTokens: 16 };
  if (!isGemma) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with the single word: pong" }] }],
          generationConfig,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      const body = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
      return `✗ ${res.status} ${body}`;
    }
    const json: any = await res.json();
    const text = (json?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p?.text ?? "").join("").trim().replace(/\s+/g, " ");
    return text ? `✓ "${text.slice(0, 40)}"` : `⚠ ok but empty (${json?.candidates?.[0]?.finishReason ?? "?"})`;
  } catch (err: any) {
    return `✗ ${err?.message ?? err}`.slice(0, 100);
  }
}

async function main(): Promise<void> {
  if (KEYS.length === 0) {
    console.error("No Gemini keys found in env. Run with --env-file-if-exists=.env.local");
    process.exit(1);
  }
  console.log(`Keys: ${KEYS.map((k) => k.source).join(", ")}`);
  console.log(`Models: ${CANDIDATE_MODELS.join(", ")}\n`);

  for (const { source, key } of KEYS) {
    console.log(`── ${source} ──`);
    for (const model of CANDIDATE_MODELS) {
      const result = await probe(key!.trim(), model);
      console.log(`  ${model.padEnd(24)} ${result}`);
    }
    console.log("");
  }
}

main().catch((err) => { console.error("Failed:", err); process.exit(1); });
