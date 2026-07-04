/**
 * Canonical decoder for the positional tuples returned by Mimir.sol's
 * getClaim / getClaimMarketConfig.
 *
 * Every consumer (web app reads, oracle, council) must decode through here so
 * that a Solidity struct field reorder is a one-file change instead of three
 * silently desynced copies.
 */
import type { PublicClient } from "viem";
import { MIMIR_ABI } from "./mimir-abi";
import { ZERO_ADDRESS } from "./constants";

export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Raw claim fields, bigint-preserving, straight off the chain. */
export interface DecodedClaim {
  id:                       number;
  creator:                  string;
  question:                 string;
  creatorPosition:          string;
  counterPosition:          string;
  resolutionUrl:            string;
  creatorStake:             bigint;
  totalChallengerStake:     bigint;
  reservedCreatorLiability: bigint;
  deadline:                 bigint;
  state:                    number;
  winnerSide:               number;
  resolutionSummary:        string;
  confidence:               number;
  category:                 string;
  parentId:                 bigint;
  challengerCount:          bigint;
  createdAt:                bigint;
  /** undefined when the on-chain hash is zero bytes32 */
  evidenceHash?:            string;
  marketType:               string;
  oddsMode:                 string;
  challengerPayoutBps:      bigint;
  handicapLine:             string;
  settlementRule:           string;
  maxChallengers:           bigint;
  isPrivate:                boolean;
}

/**
 * Maps the positional getClaim (`base`) and getClaimMarketConfig (`market`)
 * tuples to named fields. Returns null for non-existent claims (zero creator).
 */
export function decodeClaimTuple(
  claimId: number,
  base: readonly any[],
  market: readonly any[],
): DecodedClaim | null {
  const creator: string = base[0];
  if (!creator || creator === ZERO_ADDRESS) return null;

  const evidenceHash: string | undefined =
    base[17] && base[17] !== ZERO_BYTES32 ? (base[17] as string) : undefined;

  return {
    id:                       claimId,
    creator,
    question:                 base[1],
    creatorPosition:          base[2],
    counterPosition:          base[3],
    resolutionUrl:            base[4],
    creatorStake:             BigInt(base[5]),
    totalChallengerStake:     BigInt(base[6]),
    reservedCreatorLiability: BigInt(base[7]),
    deadline:                 BigInt(base[8]),
    state:                    Number(base[9]),
    winnerSide:               Number(base[10]),
    resolutionSummary:        base[11],
    confidence:               Number(base[12]),
    category:                 base[13],
    parentId:                 BigInt(base[14]),
    challengerCount:          BigInt(base[15]),
    createdAt:                BigInt(base[16]),
    evidenceHash,
    marketType:               market[0],
    oddsMode:                 market[1],
    challengerPayoutBps:      BigInt(market[2]),
    handicapLine:             market[3],
    settlementRule:           market[4],
    maxChallengers:           BigInt(market[5]),
    isPrivate:                Boolean(market[6]),
  };
}

/** Reads getClaim + getClaimMarketConfig and decodes them in one call. */
export async function fetchDecodedClaim(
  client: PublicClient,
  contractAddress: `0x${string}`,
  claimId: number,
): Promise<DecodedClaim | null> {
  const [base, market] = await Promise.all([
    client.readContract({
      address: contractAddress, abi: MIMIR_ABI,
      functionName: "getClaim", args: [BigInt(claimId)],
    }) as Promise<readonly any[]>,
    client.readContract({
      address: contractAddress, abi: MIMIR_ABI,
      functionName: "getClaimMarketConfig", args: [BigInt(claimId)],
    }) as Promise<readonly any[]>,
  ]);
  return decodeClaimTuple(claimId, base, market);
}
