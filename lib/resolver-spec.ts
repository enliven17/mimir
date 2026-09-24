/**
 * Structured resolvers: a machine-readable settlement rule.
 *
 * A claim's settlement rule may end with one line
 *
 *   resolver: {"kind":"price","symbol":"BTC","op":">","threshold":100000}
 *   resolver: {"kind":"json","url":"https://…","path":"data.items[0].score","op":">=","value":3}
 *
 * which says, in terms code can check, what makes the claim's YES side true.
 * The oracle evaluates it before asking any model; the LLM is only the
 * fallback when the resolver cannot reach a determinate answer. It lives in
 * the settlement rule so existing escrows carry it with no contract change,
 * and every participant can read it before staking.
 *
 * Pure: no network. The oracle supplies the price readings or fetched JSON.
 */

export type ResolverOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

export type ResolverSpec =
  | { kind: "price"; symbol: string; op: ResolverOp; threshold: number }
  | { kind: "json"; url: string; path: string; op: ResolverOp; value: number | string | boolean };

const OPS: readonly ResolverOp[] = [">", ">=", "<", "<=", "==", "!="];
const LINE = /^\s*resolver:\s*(\{.*\})\s*$/m;

function isOp(v: unknown): v is ResolverOp {
  return typeof v === "string" && (OPS as readonly string[]).includes(v);
}

/** The spec a settlement rule carries, or null when it has none (or a malformed one). */
export function parseResolverSpec(settlementRule: string | null | undefined): ResolverSpec | null {
  const match = LINE.exec(settlementRule ?? "");
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || !isOp(raw.op)) return null;

  if (raw.kind === "price") {
    const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
    const threshold = Number(raw.threshold);
    if (!/^[A-Z0-9]{2,10}$/.test(symbol) || !Number.isFinite(threshold) || threshold <= 0) return null;
    if (raw.op === "==" || raw.op === "!=") return null; // a price never equals a threshold exactly
    return { kind: "price", symbol, op: raw.op, threshold };
  }

  if (raw.kind === "json") {
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    const path = typeof raw.path === "string" ? raw.path.trim() : "";
    const value = raw.value;
    if (!/^https:\/\//.test(url) || !/^[A-Za-z0-9_$.[\]-]{1,200}$/.test(path)) return null;
    if (!["number", "string", "boolean"].includes(typeof value)) return null;
    if (typeof value !== "number" && raw.op !== "==" && raw.op !== "!=") return null;
    return { kind: "json", url, path, op: raw.op, value: value as number | string | boolean };
  }
  return null;
}

/** Serialize a spec as the line the market creator appends to a rule. */
export function resolverLine(spec: ResolverSpec): string {
  return `resolver: ${JSON.stringify(spec)}`;
}

export function compare(actual: number | string | boolean, op: ResolverOp, expected: number | string | boolean): boolean {
  switch (op) {
    case ">": return Number(actual) > Number(expected);
    case ">=": return Number(actual) >= Number(expected);
    case "<": return Number(actual) < Number(expected);
    case "<=": return Number(actual) <= Number(expected);
    case "==": return actual === expected || (typeof expected === "number" && Number(actual) === expected);
    case "!=": return !(actual === expected || (typeof expected === "number" && Number(actual) === expected));
  }
}

/** `a.b[0].c` into a value, or undefined. No eval, no wildcards. */
export function readPath(data: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = data;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export type ResolverOutcome =
  | { determined: true; conditionMet: boolean; detail: string }
  | { determined: false; detail: string };

/**
 * A price spec against independent readings: every reading must land on the
 * same side, or the outcome is not determined (and the LLM path takes over,
 * where the two-source rule refunds a straddle).
 */
export function evaluatePriceSpec(
  spec: Extract<ResolverSpec, { kind: "price" }>,
  readings: Array<{ source: string; priceUsd: number }>,
): ResolverOutcome {
  const usable = readings.filter((r) => Number.isFinite(r.priceUsd) && r.priceUsd > 0);
  if (usable.length < 2) return { determined: false, detail: `only ${usable.length} price reading(s)` };
  const results = usable.map((r) => compare(r.priceUsd, spec.op, spec.threshold));
  const shown = usable.map((r) => `${r.source} $${r.priceUsd}`).join(", ");
  if (results.every(Boolean)) return { determined: true, conditionMet: true, detail: `${spec.symbol} ${spec.op} ${spec.threshold}: ${shown}` };
  if (results.every((x) => !x)) return { determined: true, conditionMet: false, detail: `${spec.symbol} not ${spec.op} ${spec.threshold}: ${shown}` };
  return { determined: false, detail: `sources straddle ${spec.threshold}: ${shown}` };
}

export function evaluateJsonSpec(spec: Extract<ResolverSpec, { kind: "json" }>, data: unknown): ResolverOutcome {
  const actual = readPath(data, spec.path);
  if (actual === undefined || actual === null || typeof actual === "object") {
    return { determined: false, detail: `${spec.path} missing in the response` };
  }
  const met = compare(actual as number | string | boolean, spec.op, spec.value);
  return { determined: true, conditionMet: met, detail: `${spec.path} = ${String(actual)} (${spec.op} ${String(spec.value)})` };
}

/**
 * Which side a met / unmet condition means, for claims whose positions read
 * Yes/No. Null when the positions are free-form: the resolver then cannot
 * pick a side and the model decides.
 */
export function winnerFor(conditionMet: boolean, creatorPosition: string, counterPosition: string): "CREATOR_WINS" | "CHALLENGERS_WIN" | null {
  const yes = /^\s*yes\b/i;
  const no = /^\s*no\b/i;
  const creatorIsYes = yes.test(creatorPosition) && no.test(counterPosition);
  const creatorIsNo = no.test(creatorPosition) && yes.test(counterPosition);
  if (!creatorIsYes && !creatorIsNo) return null;
  return conditionMet === creatorIsYes ? "CREATOR_WINS" : "CHALLENGERS_WIN";
}

/**
 * A price spec for a drafted claim, when its question is an unambiguous
 * single-asset threshold ("above $X" / "below $X"). Used by the market
 * creator to make its own crypto markets deterministic.
 */
export function priceSpecFromQuestion(question: string, symbol: string, threshold: number): ResolverSpec | null {
  const above = /\b(above|over|exceeds?|higher than|more than)\b/i.test(question);
  const below = /\b(below|under|less than|lower than)\b/i.test(question);
  if (above === below) return null;
  return { kind: "price", symbol, op: above ? ">" : "<", threshold };
}
