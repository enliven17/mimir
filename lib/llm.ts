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

export type LLMProvider = "gemini" | "anthropic";

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

let anthropicClient: Anthropic | null = null;

export function activeLLMProvider(): LLMProvider {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced === "gemini" || forced === "anthropic") return forced;
  if (process.env.GEMINI_API_KEY?.trim())    return "gemini";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  throw new Error("No LLM API key configured. Set GEMINI_API_KEY or ANTHROPIC_API_KEY.");
}

export function activeLLMModel(): string {
  return activeLLMProvider() === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_ANTHROPIC_MODEL;
}

export async function callLLM(prompt: string, opts: CallLLMOptions = {}): Promise<string> {
  const provider = activeLLMProvider();
  const maxTokens   = opts.maxTokens   ?? 1024;
  const temperature = opts.temperature ?? 0.2;
  const jsonOnly    = opts.jsonOnly    ?? false;

  if (provider === "gemini") return callGemini(prompt, { maxTokens, temperature, jsonOnly });
  return callAnthropic(prompt, { maxTokens, temperature, jsonOnly });
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

  const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
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
