/**
 * Provider-agnostic LLM call for Mimir agents.
 *
 * Auto-selects between Google Gemini and Anthropic Claude based on which
 * API key is present in the environment. Falls back gracefully so a hackathon
 * demo only needs ONE of:
 *   - GEMINI_API_KEY     (preferred when present)
 *   - ANTHROPIC_API_KEY
 *
 * The provider can also be forced via LLM_PROVIDER=gemini|anthropic.
 * Each provider uses its own default model unless ORACLE_LLM_MODEL is set.
 *
 *   import { callLLM } from "@/lib/llm";
 *   const text = await callLLM(prompt, { maxTokens: 512, jsonOnly: true });
 */

import Anthropic from "@anthropic-ai/sdk";

export type LLMProvider = "gemini" | "anthropic" | "groq";

export interface CallLLMOptions {
  /** Max output tokens. Defaults to 1024. */
  maxTokens?: number;
  /** Sampling temperature 0–1. Defaults to 0.2 (deterministic). */
  temperature?: number;
  /** Ask the model for JSON output. Gemini uses responseMimeType; Claude is prompt-hinted. */
  jsonOnly?: boolean;
}

const DEFAULT_GEMINI_MODEL    = process.env.ORACLE_LLM_MODEL || "gemini-2.5-flash";
const DEFAULT_ANTHROPIC_MODEL = process.env.ORACLE_LLM_MODEL || "claude-sonnet-4-6";
// Groq is the always-on fallback so the council never stalls on a Gemini 429.
const DEFAULT_GROQ_MODEL      = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

let anthropicClient: Anthropic | null = null;

// ── Quota cooldown gate ─────────────────────────────────────────────────────
// When Gemini returns 429 (RESOURCE_EXHAUSTED) we set a cooldown timestamp.
// Until it expires, callLLM short-circuits with a thrown error instead of
// hammering the API with retries — gives the rolling-minute quota window
// time to actually reset. Per-process (module-scoped), so each worker
// (oracle / council / creator) tracks its own bucket independently.
const QUOTA_COOLDOWN_MS = Number(process.env.LLM_QUOTA_COOLDOWN_MS ?? "300000"); // 5 min default
let quotaCooldownUntil = 0;

function inQuotaCooldown(): number {
  const remaining = quotaCooldownUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

function tripQuotaCooldown(): void {
  quotaCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
}

export function activeLLMProvider(): LLMProvider {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced === "gemini" || forced === "anthropic" || forced === "groq") return forced;
  if (process.env.GEMINI_API_KEY?.trim())    return "gemini";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (process.env.GROQ_API_KEY?.trim())      return "groq";
  throw new Error("No LLM API key configured. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY.");
}

export function activeLLMModel(): string {
  const p = activeLLMProvider();
  return p === "gemini" ? DEFAULT_GEMINI_MODEL : p === "groq" ? DEFAULT_GROQ_MODEL : DEFAULT_ANTHROPIC_MODEL;
}

/** Redacted fingerprint of the active API key. Use in startup logs to verify
 *  that per-worker overrides are landing — different workers should print
 *  different suffixes. Format: `…XXXXXX (len=N)`. */
export function activeLLMKeyFingerprint(): string {
  const provider = activeLLMProvider();
  const raw = provider === "gemini"
    ? process.env.GEMINI_API_KEY
    : provider === "groq"
    ? process.env.GROQ_API_KEY
    : process.env.ANTHROPIC_API_KEY;
  const key = raw?.trim() ?? "";
  if (!key) return "(missing)";
  return `…${key.slice(-6)} (len=${key.length})`;
}

export async function callLLM(prompt: string, opts: CallLLMOptions = {}): Promise<string> {
  const provider = activeLLMProvider();
  const o = {
    maxTokens:   opts.maxTokens   ?? 1024,
    temperature: opts.temperature ?? 0.2,
    jsonOnly:    opts.jsonOnly    ?? false,
  };
  const hasGroq = !!process.env.GROQ_API_KEY?.trim();

  // Gemini cooling down from a prior 429 → go straight to Groq instead of
  // stalling (the whole point of the fallback: the council keeps voting).
  const cooldown = inQuotaCooldown();
  if (provider === "gemini" && cooldown > 0) {
    if (hasGroq) {
      console.warn(`[llm] Gemini in cooldown (${Math.ceil(cooldown / 1000)}s) → Groq fallback`);
      return callGroq(prompt, o);
    }
    throw new Error(`LLM quota cooldown — ${Math.ceil(cooldown / 1000)}s remaining (set by prior 429)`);
  }

  try {
    if (provider === "gemini") return await callGemini(prompt, o);
    if (provider === "groq")   return await callGroq(prompt, o);
    return await callAnthropic(prompt, o);
  } catch (err) {
    // Any primary failure (429, 5xx, timeout, empty) → Groq, so a juror still votes.
    if (hasGroq && provider !== "groq") {
      console.warn(`[llm] ${provider} failed → Groq fallback: ${err instanceof Error ? err.message.slice(0, 90) : err}`);
      return callGroq(prompt, o);
    }
    throw err;
  }
}

// ── Groq (OpenAI-compatible) — fast Llama fallback ──────────────────────────────
async function callGroq(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY!.trim();
  const body: Record<string, unknown> = {
    model:       DEFAULT_GROQ_MODEL,
    messages:    [{ role: "user", content: prompt }],
    max_tokens:  opts.maxTokens,
    temperature: opts.temperature,
  };
  // response_format json_object requires the literal word "json" in the prompt —
  // our oracle/council prompts already say "Return JSON only", so it's satisfied.
  if (opts.jsonOnly) body.response_format = { type: "json_object" };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  const text: string = (json?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new Error("Groq empty response");
  return text;
}

// ── Gemini ────────────────────────────────────────────────────────────────────
async function callGemini(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY!.trim();
  const model  = DEFAULT_GEMINI_MODEL;
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const generationConfig: Record<string, unknown> = {
    temperature:     opts.temperature,
    maxOutputTokens: opts.maxTokens,
    // Gemini 2.5+ models default to "thinking", which consumes output tokens
    // before producing visible text. Disabled here so small max_tokens budgets
    // don't yield empty responses for short JSON outputs.
    thinkingConfig:  { thinkingBudget: 0 },
  };
  if (opts.jsonOnly) generationConfig.responseMimeType = "application/json";

  // 429 trips the module-wide cooldown and throws on the first hit — retrying
  // inside the rolling-minute window just wastes attempts. Other transient
  // codes still get exponential backoff.
  const TRANSIENT = new Set([408, 500, 502, 503, 504]);
  const MAX_ATTEMPTS = 4;
  let res: Response | null = null;
  let lastBody = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) break;
    lastBody = (await res.text()).slice(0, 500);
    if (res.status === 429) {
      tripQuotaCooldown();
      console.warn(`[llm] Gemini 429 — entering ${Math.round(QUOTA_COOLDOWN_MS / 1000)}s cooldown, skipping further calls`);
      throw new Error(`Gemini 429: ${lastBody}`);
    }
    if (!TRANSIENT.has(res.status) || attempt === MAX_ATTEMPTS) {
      throw new Error(`Gemini ${res.status}: ${lastBody}`);
    }
    const delayMs = 1000 * 2 ** (attempt - 1);
    console.warn(`[llm] Gemini ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const json: any = await res!.json();
  const text: string = (json?.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p?.text ?? "")
    .join("")
    .trim();
  if (!text) {
    const finishReason = json?.candidates?.[0]?.finishReason ?? "unknown";
    const safety = JSON.stringify(json?.candidates?.[0]?.safetyRatings ?? json?.promptFeedback ?? {});
    throw new Error(`Gemini empty response (finishReason=${finishReason}, safety=${safety})`);
  }
  return text;
}

// ── Anthropic ─────────────────────────────────────────────────────────────────
async function callAnthropic(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim() });
  }
  const message = await anthropicClient.messages.create({
    model:       DEFAULT_ANTHROPIC_MODEL,
    max_tokens:  opts.maxTokens,
    temperature: opts.temperature,
    messages:    [{ role: "user", content: prompt }],
  });
  const block = message.content[0];
  return (block as { text?: string }).text ?? "";
}
