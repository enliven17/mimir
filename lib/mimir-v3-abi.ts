/**
 * MimirV3 ABI, generated from artifacts/MimirV3.abi.json.
 *
 * Committed rather than read from artifacts/ at runtime: the artifacts
 * directory is build output and is not in the repo, so importing it would work
 * locally and break every clean checkout.
 *
 * Regenerate with: npm run abi:v3
 */
export const MIMIR_V3_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_oracle",
        "type": "address"
      },
      {
        "internalType": "uint16",
        "name": "_platformFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "_agentOwnerFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "address",
        "name": "_platformRecipient",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_usdc",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "participant",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "agentOwner",
        "type": "address"
      }
    ],
    "name": "AgentAttributed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "ClaimCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "challenger",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "stake",
        "type": "uint256"
      }
    ],
    "name": "ClaimChallenged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "category",
        "type": "string"
      }
    ],
    "name": "ClaimCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "winnerSide",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "summary",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "confidence",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "ClaimResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "FeeAccrued",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "FeeClaimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [],
    "name": "FeePolicyCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "platformFeeBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "agentOwnerFeeBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "platformRecipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "eta",
        "type": "uint256"
      }
    ],
    "name": "FeePolicyQueued",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "platformFeeBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "agentOwnerFeeBps",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "platformRecipient",
        "type": "address"
      }
    ],
    "name": "FeePolicyUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalPaid",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalFees",
        "type": "uint256"
      }
    ],
    "name": "MarketSettled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "previous",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "next",
        "type": "address"
      }
    ],
    "name": "OracleChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Withdrawal",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "WithdrawalPending",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "CHALLENGE_LOCK_SECONDS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DEFAULT_PAYOUT_BPS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "FEE_TIMELOCK_SECONDS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_CHALLENGERS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_TOTAL_FEE_BPS",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MIN_STAKE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "SIDE_CHALLENGERS",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "SIDE_CREATOR",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "SIDE_DRAW",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "SIDE_NONE",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "SIDE_UNRESOLVABLE",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ST_ACTIVE",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ST_CANCELLED",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ST_OPEN",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ST_RESOLVED",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "accruedFees",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "claimId",
        "type": "uint256"
      }
    ],
    "name": "cancelClaim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "cancelFeePolicy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "claimId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "stakeAmount",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "inviteKey",
        "type": "string"
      },
      {
        "internalType": "address",
        "name": "agentOwnerRecipient",
        "type": "address"
      }
    ],
    "name": "challengeClaim",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "challengerAddresses",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "challengerAgentOwner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "challengerStakes",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "claimAgentOwner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claimCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "claimFeePolicy",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "platformFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "agentOwnerFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "address",
        "name": "platformRecipient",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claimFees",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "claims",
    "outputs": [
      {
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "question",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "creatorPosition",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "counterPosition",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "resolutionUrl",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "creatorStake",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "totalChallengerStake",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "reservedCreatorLiability",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "state",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "winnerSide",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "resolutionSummary",
        "type": "string"
      },
      {
        "internalType": "uint8",
        "name": "confidence",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "category",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "parentId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "challengerCount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "createdAt",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "marketType",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "oddsMode",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "challengerPayoutBps",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "handicapLine",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "settlementRule",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "maxChallengers",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isPrivate",
        "type": "bool"
      },
      {
        "internalType": "bytes32",
        "name": "inviteKeyHash",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "question",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "creatorPosition",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "counterPosition",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "resolutionUrl",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "stakeAmount",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "category",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "parentId",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "marketType",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "oddsMode",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "challengerPayoutBps",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "handicapLine",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "settlementRule",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "maxChallengers",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isPrivate",
        "type": "bool"
      },
      {
        "internalType": "string",
        "name": "inviteKey",
        "type": "string"
      },
      {
        "internalType": "address",
        "name": "agentOwnerRecipient",
        "type": "address"
      }
    ],
    "name": "createClaim",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "parentId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "stakeAmount",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "inviteKey",
        "type": "string"
      }
    ],
    "name": "createRematch",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "executeFeePolicy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "feePolicy",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "platformFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "agentOwnerFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "address",
        "name": "platformRecipient",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "claimId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "getChallenger",
    "outputs": [
      {
        "internalType": "address",
        "name": "challenger",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "stake",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "claimId",
        "type": "uint256"
      }
    ],
    "name": "getChallengerList",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "addrs",
        "type": "address[]"
      },
      {
        "internalType": "uint256[]",
        "name": "stakes",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "claimId",
        "type": "uint256"
      }
    ],
    "name": "getClaim",
    "outputs": [
      {
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "question",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "creatorPosition",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "counterPosition",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "resolutionUrl",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "creatorStake",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "totalChallengerStake",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "reservedCreatorLiability",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "state",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "winnerSide",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "resolutionSummary",
        "type": "string"
      },
      {
        "internalType": "uint8",
        "name": "confidence",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "category",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "parentId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "challengerCount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "createdAt",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "claimId",
        "type": "uint256"
      }
    ],
    "name": "getClaimFees",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "platformFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "agentOwnerFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "address",
        "name": "platformRecipient",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "agentOwnerRecipient",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "claimId",
        "type": "uint256"
      }
    ],
    "name": "getClaimMarketConfig",
    "outputs": [
      {
        "internalType": "string",
        "name": "marketType",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "oddsMode",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "challengerPayoutBps",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "handicapLine",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "settlementRule",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "maxChallengers",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isPrivate",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "reservedCreatorLiability",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getFeeStats",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "accrued",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "claimed",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "outstanding",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getPlatformStats",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "totalClaims",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "resolved",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "user",
        "type": "address"
      }
    ],
    "name": "getUserStats",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "userWins",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "userLosses",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "hasChallenged",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lifetimeFeesAccrued",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "lifetimeFeesClaimed",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "losses",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "oracle",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingFeePolicy",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "platformFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "agentOwnerFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "address",
        "name": "platformRecipient",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pendingFeePolicyEta",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "pendingWithdrawals",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "platformFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "agentOwnerFeeBps",
        "type": "uint16"
      },
      {
        "internalType": "address",
        "name": "platformRecipient",
        "type": "address"
      }
    ],
    "name": "queueFeePolicy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "claimId",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "winnerSide",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "summary",
        "type": "string"
      },
      {
        "internalType": "uint8",
        "name": "confidence",
        "type": "uint8"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "resolveClaim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_oracle",
        "type": "address"
      }
    ],
    "name": "setOracle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalResolved",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_owner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "usdc",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "wins",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
] as const;
