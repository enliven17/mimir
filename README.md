# Mimir

**AI-settled prediction markets on Arc (Circle L1)**

> "In Norse mythology, Mimir guards the Well of Wisdom — an oracle who knows all things past, present, and future."

Mimir is a peer-to-peer claim market where outcomes are settled by an autonomous AI oracle agent, with stakes and payouts in USDC on Arc's stablecoin-native L1.

---

## How it works

1. **Create** — post a claim with your position and stake USDC
2. **Challenge** — opponents accept by staking the other side
3. **Settle** — after the deadline, the Mimir oracle agent:
   - Fetches evidence from the claim's resolution URL
   - Evaluates with Claude AI
   - Pays out winners automatically in USDC

No committees. No disputes. No volatile gas tokens.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS |
| Animations | Framer Motion |
| Blockchain | Arc Testnet (Chain ID 5042002, EVM L1) |
| Native currency | USDC (6 decimals, native gas token) |
| Smart contract | Solidity — `contracts/Mimir.sol` |
| AI oracle | Claude claude-sonnet-4-6 — `agents/oracle/index.ts` |
| Messaging | XMTP Browser SDK v7 (encrypted 1v1 chat) |
| i18n | next-intl (English default) |
| Database | Turso / libsql (read-index cache) |

---

## Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Copy env template
cp .env.example .env.local
# Fill in: NEXT_PUBLIC_CONTRACT_ADDRESS, ARC_RPC, ORACLE_PRIVATE_KEY, ANTHROPIC_API_KEY

# 3. Run dev server
npm run dev

# 4. Start oracle agent (separate terminal)
npm run oracle
```

## Deploy contract

```bash
# Compile Mimir.sol (Hardhat or Foundry)
npx hardhat compile

# Deploy to Arc Testnet
DEPLOYER_PRIVATE_KEY=0x... ORACLE_ADDRESS=0x... npm run deploy:contract
```

---

## Market features

- **6 market types**: binary, moneyline, spread, total, prop, custom
- **Pool odds** (pari-mutuel) and **fixed odds** (creator-backed multiples)
- **1-vs-1** and **1-vs-many** (up to 100 challengers)
- **Private claims** with invite links
- **Rivalry/rematch** chains linked via `parentId`
- **Encrypted 1v1 chat** via XMTP between creator and challenger

---

## Oracle agent

The oracle is the AI heart of Mimir. It runs off-chain, polls for expired claims, and settles them autonomously:

```
Active claim (deadline passed)
  → fetch resolutionUrl
  → Claude evaluates evidence
  → CREATOR_WINS / CHALLENGERS_WIN / DRAW / UNRESOLVABLE
  → resolveClaim() on Arc → USDC payouts
```

```bash
ORACLE_PRIVATE_KEY=0x... ANTHROPIC_API_KEY=sk-ant-... npm run oracle
```

---

## Built for

**Agora Agents Hackathon** — Canteen × Circle on Arc
May 11–25, 2026

USDC-native settlement · Sub-second finality · AI agents as economic actors
