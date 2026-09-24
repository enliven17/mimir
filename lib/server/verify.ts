import "server-only";

import { createChainPublicClient, getContractAddress } from "@/lib/arc";
import type { ChainKey } from "@/lib/chains";
import { fetchDecodedClaim } from "@/lib/claim-codec";
import { bundleHash, type VerdictBundle } from "@/lib/verdict-bundle";
import { getVerdictBundleText } from "@/lib/server/verdict-bundles";

export interface VerificationReport {
  chain: ChainKey;
  claimId: number;
  found: boolean;
  resolved: boolean;
  onChain: {
    state: number;
    winnerSide: number;
    confidence: number;
    summary: string;
    evidenceHash: string | null;
  } | null;
  /** Canonical JSON exactly as hashed, for anyone who wants to hash it themselves. */
  bundleText: string | null;
  bundle: VerdictBundle | null;
  recomputedHash: string | null;
  /** The stored bundle hashes to the on-chain evidenceHash. */
  matches: boolean;
}

/**
 * Check a claim's on-chain evidenceHash against the stored audit bundle. The
 * hash is recomputed here from the stored text, never trusted from the row.
 */
export async function verifyClaim(chain: ChainKey, claimId: number): Promise<VerificationReport> {
  const empty: VerificationReport = {
    chain, claimId, found: false, resolved: false, onChain: null,
    bundleText: null, bundle: null, recomputedHash: null, matches: false,
  };
  const claim = await fetchDecodedClaim(createChainPublicClient(chain), getContractAddress(chain), claimId);
  if (!claim) return empty;

  const onChain = {
    state: claim.state,
    winnerSide: claim.winnerSide,
    confidence: claim.confidence,
    summary: claim.resolutionSummary,
    evidenceHash: claim.evidenceHash ?? null,
  };
  const report: VerificationReport = { ...empty, found: true, resolved: claim.state === 2, onChain };
  if (!onChain.evidenceHash) return report;

  const text = await getVerdictBundleText(onChain.evidenceHash).catch(() => null);
  if (!text) return report;

  let bundle: VerdictBundle | null = null;
  try {
    bundle = JSON.parse(text) as VerdictBundle;
  } catch {
    bundle = null;
  }
  const recomputedHash = bundle ? bundleHash(bundle) : null;
  return {
    ...report,
    bundleText: text,
    bundle,
    recomputedHash,
    matches: recomputedHash !== null && recomputedHash.toLowerCase() === onChain.evidenceHash.toLowerCase(),
  };
}
