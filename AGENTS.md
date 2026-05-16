# AGENTS.md — Mimir

This repository contains Mimir, an AI-settled prediction market on Arc (Circle L1).

## Repository layout

| Path | Purpose |
|------|---------|
| `contracts/Mimir.sol` | Solidity smart contract (EVM, Arc Testnet) |
| `lib/mimir-abi.ts` | ABI + state constants for Mimir.sol |
| `lib/arc.ts` | Arc chain config (viem, chain ID 5042002) |
| `lib/contract.ts` | TypeScript contract client (read + write) |
| `lib/wallet.tsx` | MetaMask wallet context |
| `agents/oracle/index.ts` | Off-chain AI oracle agent (Claude-powered) |
| `deploy/deploy.ts` | Arc deployment script |

## Key rules

- Contract state is the source of truth. The Turso DB is a read-index cache only.
- USDC is the **native currency** on Arc (like ETH on Ethereum). Stakes use `msg.value` — no ERC-20 approval needed.
- Resolution is oracle-only. `resolveClaim()` can only be called by the `oracle` address set in the contract. Do not expose user-triggered resolution.
- When `Mimir.sol` changes, keep `lib/mimir-abi.ts` and `lib/contract.ts` in sync.
- Categories: `sports`, `weather`, `crypto`, `culture`, `custom` (English).

## Oracle agent

```bash
# Start the oracle (needs ORACLE_PRIVATE_KEY + ANTHROPIC_API_KEY)
npm run oracle
```

The oracle polls for active claims past their deadline every 60 seconds, fetches evidence, calls Claude API to evaluate, and sends `resolveClaim()` to Arc.

## Deploy

```bash
# 1. Compile Mimir.sol with Hardhat or Foundry
npx hardhat compile          # → copies bytecode to artifacts/Mimir.bin
# or
forge build --out artifacts  # copy Mimir.bin manually

# 2. Deploy to Arc Testnet
DEPLOYER_PRIVATE_KEY=0x... ORACLE_ADDRESS=0x... npm run deploy:contract
```
