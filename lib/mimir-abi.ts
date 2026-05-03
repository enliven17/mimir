/**
 * Mimir.sol ABI — generated from contracts/Mimir.sol
 */
export const MIMIR_ABI = [
  // ── Events ────────────────────────────────────────────────────────────────
  {
    type: "event",
    name: "ClaimCreated",
    inputs: [
      { name: "id",      type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "category",type: "string",  indexed: false },
    ],
  },
  {
    type: "event",
    name: "ClaimChallenged",
    inputs: [
      { name: "id",         type: "uint256", indexed: true },
      { name: "challenger", type: "address", indexed: true },
      { name: "stake",      type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ClaimResolved",
    inputs: [
      { name: "id",           type: "uint256", indexed: true },
      { name: "winnerSide",   type: "uint8",   indexed: false },
      { name: "summary",      type: "string",  indexed: false },
      { name: "confidence",   type: "uint8",   indexed: false },
      { name: "evidenceHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ClaimCancelled",
    inputs: [{ name: "id", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "OracleChanged",
    inputs: [
      { name: "previous", type: "address", indexed: true },
      { name: "next",     type: "address", indexed: true },
    ],
  },
  // ── Constructor ───────────────────────────────────────────────────────────
  {
    type: "constructor",
    inputs: [{ name: "_oracle", type: "address" }],
    stateMutability: "nonpayable",
  },
  // ── Write ─────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "createClaim",
    stateMutability: "payable",
    inputs: [
      { name: "question",             type: "string"  },
      { name: "creatorPosition",      type: "string"  },
      { name: "counterPosition",      type: "string"  },
      { name: "resolutionUrl",        type: "string"  },
      { name: "deadline",             type: "uint256" },
      { name: "stakeAmount",          type: "uint256" },
      { name: "category",             type: "string"  },
      { name: "parentId",             type: "uint256" },
      { name: "marketType",           type: "string"  },
      { name: "oddsMode",             type: "string"  },
      { name: "challengerPayoutBps",  type: "uint256" },
      { name: "handicapLine",         type: "string"  },
      { name: "settlementRule",       type: "string"  },
      { name: "maxChallengers",       type: "uint256" },
      { name: "isPrivate",            type: "bool"    },
      { name: "inviteKey",            type: "string"  },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "createRematch",
    stateMutability: "payable",
    inputs: [
      { name: "parentId",    type: "uint256" },
      { name: "deadline",    type: "uint256" },
      { name: "stakeAmount", type: "uint256" },
      { name: "inviteKey",   type: "string"  },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "challengeClaim",
    stateMutability: "payable",
    inputs: [
      { name: "claimId",     type: "uint256" },
      { name: "stakeAmount", type: "uint256" },
      { name: "inviteKey",   type: "string"  },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveClaim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "claimId",      type: "uint256"  },
      { name: "winnerSide",   type: "uint8"    },
      { name: "summary",      type: "string"   },
      { name: "confidence",   type: "uint8"    },
      { name: "evidenceHash", type: "bytes32"  },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelClaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "claimId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setOracle",
    stateMutability: "nonpayable",
    inputs: [{ name: "_oracle", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "transferOwnership",
    stateMutability: "nonpayable",
    inputs: [{ name: "_owner", type: "address" }],
    outputs: [],
  },
  // ── Read ──────────────────────────────────────────────────────────────────
  {
    type: "function",
    name: "getClaim",
    stateMutability: "view",
    inputs: [{ name: "claimId", type: "uint256" }],
    outputs: [
      { name: "creator",                  type: "address" },
      { name: "question",                 type: "string"  },
      { name: "creatorPosition",          type: "string"  },
      { name: "counterPosition",          type: "string"  },
      { name: "resolutionUrl",            type: "string"  },
      { name: "creatorStake",             type: "uint256" },
      { name: "totalChallengerStake",     type: "uint256" },
      { name: "reservedCreatorLiability", type: "uint256" },
      { name: "deadline",                 type: "uint256" },
      { name: "state",                    type: "uint8"   },
      { name: "winnerSide",               type: "uint8"   },
      { name: "resolutionSummary",        type: "string"  },
      { name: "confidence",               type: "uint8"   },
      { name: "category",                 type: "string"  },
      { name: "parentId",                 type: "uint256" },
      { name: "challengerCount",          type: "uint256" },
      { name: "createdAt",                type: "uint256" },
      { name: "evidenceHash",             type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "getClaimMarketConfig",
    stateMutability: "view",
    inputs: [{ name: "claimId", type: "uint256" }],
    outputs: [
      { name: "marketType",               type: "string"  },
      { name: "oddsMode",                 type: "string"  },
      { name: "challengerPayoutBps",      type: "uint256" },
      { name: "handicapLine",             type: "string"  },
      { name: "settlementRule",           type: "string"  },
      { name: "maxChallengers",           type: "uint256" },
      { name: "isPrivate",                type: "bool"    },
      { name: "reservedCreatorLiability", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getChallenger",
    stateMutability: "view",
    inputs: [
      { name: "claimId", type: "uint256" },
      { name: "index",   type: "uint256" },
    ],
    outputs: [
      { name: "challenger", type: "address" },
      { name: "stake",      type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getChallengerList",
    stateMutability: "view",
    inputs: [{ name: "claimId", type: "uint256" }],
    outputs: [
      { name: "addrs",  type: "address[]" },
      { name: "stakes", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "getUserStats",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "userWins",   type: "uint256" },
      { name: "userLosses", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getPlatformStats",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "totalClaims", type: "uint256" },
      { name: "resolved",    type: "uint256" },
      { name: "balance",     type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "claimCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "oracle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// Winner side constants (mirrors Mimir.sol)
export const WINNER_SIDE = {
  NONE:          0,
  CREATOR:       1,
  CHALLENGERS:   2,
  DRAW:          3,
  UNRESOLVABLE:  4,
} as const;

export const STATE = {
  OPEN:      0,
  ACTIVE:    1,
  RESOLVED:  2,
  CANCELLED: 3,
} as const;
