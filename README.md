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
| Agent wallets | Circle W3S (Programmable Wallets) — `lib/circle-w3s.ts` |
| Cross-chain | Circle CCTP V2 — `lib/cctp.ts`, `app/[locale]/bridge/page.tsx` |
| Unified balance | Circle Gateway — `app/api/gateway/balances/route.ts` |
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

The oracle **does not hold a local private key**. It signs every Arc transaction via Circle's W3S (Programmable Wallets) — agent keys live in Circle's custody, Mimir authorizes via `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET`. Same for the autonomous market-creator agent.

```bash
# All required env vars come from .env.local
npm run oracle
```

## Circle stack (Agora Agents Hackathon)

Mimir uses the full Circle developer stack on Arc:

| Piece | Where | What it does |
|-------|-------|-------------|
| **USDC native** | `contracts/Mimir.sol` | Stakes use `msg.value` — no ERC-20 approval, ~$0.01 fees |
| **Programmable Wallets (W3S)** | `lib/circle-w3s.ts`, `agents/*/index.ts` | Oracle + market-creator agents sign through Circle managed wallets — agents own no local keys |
| **CCTP V2** | `lib/cctp.ts`, `app/[locale]/bridge` | Bridge USDC from Base / Ethereum / Avalanche Sepolia into Arc in ~15s via Fast Transfer |
| **Gateway** | `app/api/gateway/balances`, `components/GatewayBalanceWidget.tsx` | One-call unified USDC balance across every CCTP V2 domain |

### Setting up Circle credentials (one-time)

```bash
# 1. Create an API Key and a Kit Key in https://console.circle.com
#    Paste both into .env.local (CIRCLE_API_KEY, CIRCLE_KIT_KEY)

# 2. Generate an entity secret + register the ciphertext on Console
npx tsx scripts/circle-entity-secret.ts
#    Console → Wallets → Dev Controlled → Configurator → paste the ciphertext

# 3. Create the two agent wallets on Arc Testnet
npx tsx scripts/circle-create-wallets.ts

# 4. Fund both wallet addresses with testnet USDC
#    https://faucet.circle.com  (pick Arc Testnet)
```

---

## Built for

**Agora Agents Hackathon** — Canteen × Circle on Arc
May 11–25, 2026

USDC-native settlement · Sub-second finality · AI agents as economic actors
