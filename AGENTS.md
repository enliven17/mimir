# AGENTS.md — Mimir

This repository contains Mimir, an AI-settled prediction market on Arc (Circle L1).

## Repository layout

| Path | Purpose |
|------|---------|
| `contracts/Mimir.sol` | Solidity smart contract (EVM, Arc Testnet) |
| `lib/mimir-abi.ts` | ABI + state constants for Mimir.sol |
| `lib/arc.ts` | Arc chain config (viem, chain ID 5042002) |
| `lib/contract.ts` | TypeScript contract client (read + write) |
| `lib/wallet.tsx` | MetaMask wallet context (frontend, wagmi) |
| `lib/wagmi-config.ts` | wagmi config — Arc + CCTP source chains (Base/Eth/Avax Sepolia) |
| `lib/circle-w3s.ts` | Circle W3S signer — agents transact via Programmable Wallets |
| `lib/cctp.ts` | CCTP V2 helpers — addresses, ABIs, Iris attestation polling |
| `agents/oracle/index.ts` | Off-chain AI oracle agent (Claude + W3S) |
| `agents/market-creator/index.ts` | Autonomous market creator (Claude + W3S) |
| `app/[locale]/bridge/page.tsx` | User-facing CCTP V2 bridge UI |
| `app/api/gateway/balances/route.ts` | Circle Gateway unified balance proxy |
| `components/GatewayBalanceWidget.tsx` | Unified USDC balance widget |
| `scripts/circle-entity-secret.ts` | One-time entity secret bootstrap |
| `scripts/circle-create-wallets.ts` | Provision oracle + market-creator wallets |
| `deploy/deploy.ts` | Arc deployment script |

## Key rules

- Contract state is the source of truth. The Turso DB is a read-index cache only.
- USDC is the **native currency** on Arc (like ETH on Ethereum). Stakes use `msg.value` — no ERC-20 approval needed.
- Resolution is oracle-only. `resolveClaim()` can only be called by the `oracle` address set in the contract (which is the W3S-managed `CIRCLE_ORACLE_ADDRESS`). Do not expose user-triggered resolution.
- Agents (oracle, market-creator) sign via `lib/circle-w3s.ts` — never with a local private key. Adding new agent flows? Reuse `executeContract({ walletId, ... })`.
- When `Mimir.sol` changes, keep `lib/mimir-abi.ts` and `lib/contract.ts` in sync. The W3S signer derives function signatures from `MIMIR_ABI` at runtime, so ABI completeness matters for both reads (viem) and writes (Circle).
- CCTP V2 bridge uses 6-decimal USDC on source chains; Arc displays 6-significant decimals but the EVM token has 18 decimals. Don't mix the two in the same code path.
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
