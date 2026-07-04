/** The four settlement outcomes Mimir.sol understands. */
export const VERDICTS = [
  "CREATOR_WINS",
  "CHALLENGERS_WIN",
  "DRAW",
  "UNRESOLVABLE",
] as const;

export type Verdict = (typeof VERDICTS)[number];

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}
