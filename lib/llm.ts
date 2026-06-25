/**
 * Provider-agnostic LLM calls for Mimir agents.
 *
 * Auto-selects between Gemini, Claude, Groq, and OpenRouter based on
 * configured API keys. The active provider can be forced with:
 *   LLM_PROVIDER=gemini|anthropic|groq|openrouter
 *
 * Each provider uses its own default model unless ORACLE_LLM_MODEL is set.
 */

import Anthropic from "@anthropic-ai/sdk";

export type LLMProvider = "gemini" | "anthropic" | "groq" | "openrouter";

export interface CallLLMOptions {
  /** Max output tokens. Defaults to 1024. */
  maxTokens?: number;
  /** Sampling temperature 0-1. Defaults to 0.2 (deterministic). */
  temperature?: number;
  /** Ask the model for JSON output. Gemini uses responseMimeType; Claude is prompt-hinted. */
  jsonOnly?: boolean;
}

const DEFAULT_GEMINI_MODEL = process.env.ORACLE_LLM_MODEL || "gemini-2.5-flash";
const DEFAULT_ANTHROPIC_MODEL = process.env.ORACLE_LLM_MODEL || "claude-sonnet-4-6";
const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";

const GEMINI_QUOTA_COOLDOWN_MS = Number(process.env.LLM_QUOTA_COOLDOWN_MS ?? "300000"); // 5 min
const GROQ_QUOTA_COOLDOWN_MS = Number(process.env.GROQ_QUOTA_COOLDOWN_MS ?? "2700000"); // 45 min
const OPENROUTER_QUOTA_COOLDOWN_MS = Number(process.env.OPENROUTER_QUOTA_COOLDOWN_MS ?? "2700000"); // 45 min

let anthropicClient: Anthropic | null = null;
let geminiCooldownUntil = 0;
let openrouterCooldownUntil = 0;
const groqCooldownByKey = new Map<string, number>();

function cooldownRemaining(until: number): number {
  const remaining = until - Date.now();
  return remaining > 0 ? remaining : 0;
}

function geminiCooldownRemaining(): number {
  return cooldownRemaining(geminiCooldownUntil);
}

function openrouterCooldownRemaining(): number {
  return cooldownRemaining(openrouterCooldownUntil);
}

function getGroqKeys(): string[] {
  const raw = [
    process.env.GROQ_API_KEY,
    ...(process.env.GROQ_API_KEYS ?? "").split(/[,\s]+/),
  ];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const key = value?.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function groqKeyCooldownRemaining(key: string): number {
  return cooldownRemaining(groqCooldownByKey.get(key) ?? 0);
}

function groqCooldownRemaining(): number {
  const keys = getGroqKeys();
  if (keys.length === 0) return 0;
  const ready = keys.some((key) => groqKeyCooldownRemaining(key) === 0);
  if (ready) return 0;
  return Math.min(...keys.map(groqKeyCooldownRemaining));
}

function tripGroqCooldown(key: string): void {
  groqCooldownByKey.set(key, Date.now() + GROQ_QUOTA_COOLDOWN_MS);
}

function groqKeyFingerprint(key: string): string {
  return `...${key.slice(-6)}`;
}

function tripGeminiCooldown(): void {
  geminiCooldownUntil = Date.now() + GEMINI_QUOTA_COOLDOWN_MS;
}

function tripOpenRouterCooldown(): void {
  openrouterCooldownUntil = Date.now() + OPENROUTER_QUOTA_COOLDOWN_MS;
}

function hasProviderKey(provider: LLMProvider): boolean {
  if (provider === "gemini") return !!process.env.GEMINI_API_KEY?.trim();
  if (provider === "groq") return getGroqKeys().length > 0;
  if (provider === "openrouter") return !!process.env.OPENROUTER_API_KEY?.trim();
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

function providerCooldown(provider: LLMProvider): number {
  if (provider === "gemini") return geminiCooldownRemaining();
  if (provider === "groq") return groqCooldownRemaining();
  if (provider === "openrouter") return openrouterCooldownRemaining();
  return 0;
}

function fallbackProviders(primary: LLMProvider): LLMProvider[] {
  const preferred: LLMProvider[] = primary === "openrouter"
    ? [primary, "groq", "anthropic", "gemini"]
    : [primary, "groq", "anthropic", "gemini", "openrouter"];
  return preferred.filter((provider, index) =>
    preferred.indexOf(provider) === index && hasProviderKey(provider)
  );
}

export function activeLLMProvider(): LLMProvider {
  const forced = process.env.LLM_PROVIDER?.toLowerCase();
  if (forced === "gemini" || forced === "anthropic" || forced === "groq" || forced === "openrouter") return forced;
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (getGroqKeys().length > 0) return "groq";
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  throw new Error("No LLM API key configured. Set GEMINI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY/GROQ_API_KEYS, or OPENROUTER_API_KEY.");
}

export function activeLLMModel(): string {
  const provider = activeLLMProvider();
  if (provider === "gemini") return DEFAULT_GEMINI_MODEL;
  if (provider === "groq") return DEFAULT_GROQ_MODEL;
  if (provider === "openrouter") return DEFAULT_OPENROUTER_MODEL;
  return DEFAULT_ANTHROPIC_MODEL;
}

/** Redacted fingerprint of the active API key for startup logs. */
export function activeLLMKeyFingerprint(): string {
  const provider = activeLLMProvider();
  const raw = provider === "gemini"
    ? process.env.GEMINI_API_KEY
    : provider === "groq"
    ? getGroqKeys()[0]
    : provider === "openrouter"
    ? process.env.OPENROUTER_API_KEY
    : process.env.ANTHROPIC_API_KEY;
  const key = raw?.trim() ?? "";
  if (!key) return "(missing)";
  return `...${key.slice(-6)} (len=${key.length})`;
}

export async function callLLM(prompt: string, opts: CallLLMOptions = {}): Promise<string> {
  const primary = activeLLMProvider();
  const options = {
    maxTokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.2,
    jsonOnly: opts.jsonOnly ?? false,
  };
  const candidates = fallbackProviders(primary);
  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const cooldown = providerCooldown(candidate);
    const next = candidates.slice(index + 1).find((provider) => providerCooldown(provider) === 0);

    if (cooldown > 0) {
      lastError = new Error(`${candidate} quota cooldown - ${Math.ceil(cooldown / 1000)}s remaining`);
      if (next) {
        console.warn(`[llm] ${candidate} in cooldown (${Math.ceil(cooldown / 1000)}s) -> ${next} fallback`);
      }
      continue;
    }

    try {
      if (candidate === "gemini") return await callGemini(prompt, options);
      if (candidate === "groq") return await callGroq(prompt, options);
      if (candidate === "openrouter") return await callOpenRouter(prompt, options);
      return await callAnthropic(prompt, options);
    } catch (err) {
      lastError = err;
      if (next) {
        console.warn(`[llm] ${candidate} failed -> ${next} fallback: ${err instanceof Error ? err.message.slice(0, 90) : err}`);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All configured LLM providers failed");
}

async function callGroq(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  const keys = getGroqKeys();
  let lastError: Error | null = null;

  for (const apiKey of keys) {
    const cooldown = groqKeyCooldownRemaining(apiKey);
    if (cooldown > 0) {
      lastError = new Error(`Groq key ${groqKeyFingerprint(apiKey)} in cooldown - ${Math.ceil(cooldown / 1000)}s remaining`);
      continue;
    }

    const body: Record<string, unknown> = {
      model: DEFAULT_GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
    };
    if (opts.jsonOnly) body.response_format = { type: "json_object" };

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const bodyText = (await res.text()).slice(0, 500);
      if (res.status === 429) {
        tripGroqCooldown(apiKey);
        lastError = new Error(`Groq ${res.status}: ${bodyText.slice(0, 300)}`);
        console.warn(
          `[llm] Groq key ${groqKeyFingerprint(apiKey)} 429 - trying next key (${Math.round(GROQ_QUOTA_COOLDOWN_MS / 1000)}s cooldown)`,
        );
        continue;
      }
      const lowerBody = bodyText.toLowerCase();
      const badKeyOrRestricted =
        res.status === 401 ||
        res.status === 403 ||
        (res.status === 400 && (
          lowerBody.includes("organization has been restricted") ||
          lowerBody.includes("invalid api key") ||
          lowerBody.includes("invalid_api_key")
        ));
      if (badKeyOrRestricted) {
        tripGroqCooldown(apiKey);
        lastError = new Error(`Groq key ${groqKeyFingerprint(apiKey)} rejected (${res.status}): ${bodyText.slice(0, 180)}`);
        console.warn(`[llm] Groq key ${groqKeyFingerprint(apiKey)} rejected (${res.status}) - trying next key`);
        continue;
      }
      throw new Error(`Groq ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    const json: any = await res.json();
    const text: string = (json?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw new Error("Groq empty response");
    return text;
  }

  throw lastError ?? new Error("No Groq API key configured");
}

async function callOpenRouter(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY!.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-OpenRouter-Title": process.env.OPENROUTER_APP_NAME || "Mimir",
  };
  if (process.env.OPENROUTER_SITE_URL?.trim()) {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL.trim();
  }

  const body: Record<string, unknown> = {
    model: DEFAULT_OPENROUTER_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
  };
  if (opts.jsonOnly && DEFAULT_OPENROUTER_MODEL !== "openrouter/free") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const bodyText = (await res.text()).slice(0, 500);
    if (res.status === 429) {
      tripOpenRouterCooldown();
      console.warn(`[llm] OpenRouter 429 - entering ${Math.round(OPENROUTER_QUOTA_COOLDOWN_MS / 1000)}s cooldown`);
    }
    throw new Error(`OpenRouter ${res.status}: ${bodyText.slice(0, 300)}`);
  }

  const json: any = await res.json();
  const text: string = (json?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new Error("OpenRouter empty response");
  return text;
}

async function callGemini(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY!.trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`;
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature,
    maxOutputTokens: opts.maxTokens,
    thinkingConfig: { thinkingBudget: 0 },
  };
  if (opts.jsonOnly) generationConfig.responseMimeType = "application/json";

  const transient = new Set([408, 500, 502, 503, 504]);
  const maxAttempts = 4;
  let res: Response | null = null;
  let lastBody = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
      tripGeminiCooldown();
      console.warn(`[llm] Gemini 429 - entering ${Math.round(GEMINI_QUOTA_COOLDOWN_MS / 1000)}s cooldown`);
      throw new Error(`Gemini 429: ${lastBody}`);
    }
    if (!transient.has(res.status) || attempt === maxAttempts) {
      throw new Error(`Gemini ${res.status}: ${lastBody}`);
    }

    const delayMs = 1000 * 2 ** (attempt - 1);
    console.warn(`[llm] Gemini ${res.status} (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const json: any = await res!.json();
  const text: string = (json?.candidates?.[0]?.content?.parts ?? [])
    .map((part: any) => part?.text ?? "")
    .join("")
    .trim();
  if (!text) {
    const finishReason = json?.candidates?.[0]?.finishReason ?? "unknown";
    const safety = JSON.stringify(json?.candidates?.[0]?.safetyRatings ?? json?.promptFeedback ?? {});
    throw new Error(`Gemini empty response (finishReason=${finishReason}, safety=${safety})`);
  }
  return text;
}

async function callAnthropic(
  prompt: string,
  opts: { maxTokens: number; temperature: number; jsonOnly: boolean },
): Promise<string> {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim() });
  }
  const message = await anthropicClient.messages.create({
    model: DEFAULT_ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    messages: [{ role: "user", content: prompt }],
  });
  const block = message.content[0];
  return (block as { text?: string }).text ?? "";
}
