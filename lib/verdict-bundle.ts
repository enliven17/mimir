/**
 * Verdict audit bundles.
 *
 * Everything the oracle used to decide a claim, in one JSON document: the
 * claim as it read it, the evidence text and how it was fetched, the price
 * readings at the deadline, the structured resolver result, the council's
 * votes, the model that answered, and every adjustment between the raw and
 * the final verdict. The claim's on-chain `evidenceHash` is keccak256 of the
 * bundle's canonical JSON, so anyone holding the bundle can check that it is
 * exactly what the oracle committed to, and nothing was added afterwards.
 *
 * Pure: hashing and canonical form only. Storage is lib/server/verdict-bundles.ts.
 */
import { keccak256, toBytes } from "viem";

export const VERDICT_BUNDLE_VERSION = 1;

export interface VerdictBundle {
  version: typeof VERDICT_BUNDLE_VERSION;
  chain: string;
  claimId: number;
  decidedAt: number;
  claim: {
    question: string;
    creatorPosition: string;
    counterPosition: string;
    settlementRule: string;
    resolutionUrl: string;
    category: string;
    deadline: number;
  };
  evidence?: { fetcher: string; text: string; paidAtomic?: string };
  prices?: { symbol: string; threshold: number; readings: Array<{ source: string; priceUsd: number; at: number }> };
  resolver?: { spec: unknown; detail: string };
  council?: {
    tally: unknown;
    votes: Array<{ slug: string; verdict: string; confidence: number }>;
    qHistory?: number[];
    referenceQ?: number;
  };
  model?: string;
  rawVerdict?: { verdict: string; confidence: number; explanation: string };
  adjustments: string[];
  finalVerdict: { verdict: string; confidence: number; explanation: string };
}

/** Sorted keys, compact, no undefined: the one byte sequence that is hashed. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function bundleHash(bundle: unknown): `0x${string}` {
  return keccak256(toBytes(canonicalJson(bundle)));
}

/** A bundle as it is stored and served, with the hash that goes on chain. */
export function sealBundle(bundle: VerdictBundle): { canonical: string; hash: `0x${string}` } {
  const canonical = canonicalJson(bundle);
  return { canonical, hash: keccak256(toBytes(canonical)) };
}
