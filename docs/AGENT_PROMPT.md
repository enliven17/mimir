# Mimir — Full Project Context for AI Agent

You are being onboarded to the Mimir codebase. This document is **self-contained** — it includes all architecture, source code types, and implementation status so you can work on this project without file access.

---

## What is Mimir?

Mimir is an **AI-settled prediction market** built on **Arc** (Circle L1, Chain ID 5042002). Users create verifiable claims about real-world outcomes (sports, crypto, weather, culture), stake USDC, and share a link for opponents to challenge. When the deadline arrives, the Mimir oracle agent:

1. Fetches live evidence from the web (claim's `resolutionUrl`)
2. Evaluates the evidence via **Claude API (LLM)**
3. Sends a `resolveClaim()` transaction to Arc with the verdict
4. The winner is paid automatically in USDC — no committees, no disputes

**One-liner:** "An AI-settled claim market supporting head-to-head, 1-v-many, pool-odds, fixed-odds, and rivalry-linked rematches — settled in USDC on Arc."

**Built for:** Agora Agents Hackathon 2026 (Canteen × Circle on Arc)
**License:** MIT
**Default locale:** English (en)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router, Server Components), React 18, TypeScript 5 |
| Styling | Tailwind CSS 3.4, Framer Motion 12 (page transitions, stamp animations, confetti) |
| Blockchain | Arc Testnet (Chain ID 5042002), viem 2.47 |
| Smart Contract | Solidity — `contracts/Mimir.sol` |
| AI Oracle | Claude claude-sonnet-4-6 — `agents/oracle/index.ts` (off-chain) |
| Messaging | XMTP Browser SDK v7 (encrypted peer-to-peer 1v1 chat) |
| i18n | next-intl (English default) |
| Auth | MetaMask (EIP-1193) primary + demo relay fallback |
| Notifications | Sonner (toast notifications) |
| Loading | nextjs-toploader (top loading bar) |
| Icons | Lucide React |
| Database | Turso / libsql (read-index cache) |
| Deployment | Vercel (frontend), direct EVM deploy (contract) |

---

## Project Structure

```
mimir/
├── app/                        # Next.js 14 App Router
│   ├── layout.tsx              # Root layout: WalletProvider > XmtpProvider > children + Toaster
│   ├── globals.css             # Global styles
│   ├── [locale]/               # i18n locale routing (en)
│   │   ├── layout.tsx          # Locale layout with Header + main wrapper
│   │   ├── page.tsx            # Home — hero VS showcase + open claims + resolved winners
│   │   ├── dashboard/page.tsx  # User dashboard — my claims, stats (W-L), filter tabs
│   │   ├── explore/            # Browse open claims
│   │   │   ├── page.tsx        # Server wrapper
│   │   │   └── ExploreClient.tsx  # Client component with category/stake filters + search
│   │   ├── vs/
│   │   │   ├── create/page.tsx # Create claim form
│   │   │   └── [id]/page.tsx   # Claim detail (accept, resolve, rematch, XMTP chat)
│   │   └── messages/page.tsx   # XMTP messages hub
│   └── api/
│       ├── vs/route.ts         # GET /api/vs — list all public VS (paginated, 15s cache)
│       ├── vs/[id]/route.ts    # GET /api/vs/:id — single VS detail
│       ├── vs/user/[address]/  # GET /api/vs/user/:address — user's VS
│       └── demo/write/route.ts # POST /api/demo/write — demo relay endpoint
├── agents/
│   └── oracle/
│       └── index.ts            # Off-chain AI oracle agent (Claude-powered)
├── components/
│   ├── Header.tsx
│   ├── VSCard.tsx
│   ├── ArenaCard.tsx
│   ├── DemoRoleSwitcher.tsx
│   ├── ResolutionTerminal.tsx
│   ├── Confetti.tsx
│   ├── ProvenStamp.tsx
│   ├── PageTransition.tsx
│   ├── EmptyState.tsx
│   ├── xmtp/
│   │   └── VsXmtpPanel.tsx
│   ├── MessagesHub.tsx
│   └── ui/                     # Button, Badge, Chip, Input, GlassCard, CountdownTimer, etc.
├── contracts/
│   └── Mimir.sol               # Solidity smart contract — ALL business logic
├── lib/
│   ├── arc.ts                  # Arc chain config (viem, chain 5042002, USDC helpers)
│   ├── mimir-abi.ts            # Mimir.sol ABI + state/winner constants
│   ├── contract.ts             # TypeScript client (read + write functions)
│   ├── wallet.tsx              # WalletProvider context (MetaMask)
│   ├── constants.ts            # Categories, helpers
│   ├── db.ts                   # Turso/libsql read-index
│   ├── pending-vs.ts           # Optimistic localStorage pending VS
│   ├── private-links.ts        # Private invite key generation
│   ├── hooks.ts                # useCountdown hook
│   ├── xmtp/                   # XMTP integration modules
│   └── server/
│       ├── vs-cache.ts         # In-memory + file-backed cache
│       └── api-validation.ts   # API error helpers
├── deploy/
│   └── deploy.ts               # Arc deployment script (viem deployContract)
├── messages/
│   └── en.json                 # English translations
├── middleware.ts               # next-intl locale routing
├── next.config.js
├── tailwind.config.ts
└── tsconfig.json
```

---

## Environment Variables

**Public (browser-exposed):**
```
NEXT_PUBLIC_CONTRACT_ADDRESS        # Deployed Mimir.sol address on Arc
NEXT_PUBLIC_ARC_RPC                 # Arc RPC endpoint override
NEXT_PUBLIC_DEMO_MODE               # "1" to enable demo relay
NEXT_PUBLIC_DEMO_MODE_LABEL         # Optional demo banner label
NEXT_PUBLIC_XMTP_ENV                # XMTP network: local, dev, production
NEXT_PUBLIC_FEATURE_XMTP            # Enable XMTP UI: 1, true, or yes
NEXT_PUBLIC_XMTP_APP_VERSION        # App id for XMTP telemetry
```

**Server-only:**
```
ARC_RPC                             # Server-side RPC override
ORACLE_PRIVATE_KEY                  # Oracle agent wallet private key
ANTHROPIC_API_KEY                   # Claude API key (oracle agent)
DEMO_CREATOR_PRIVATE_KEY            # Demo signer for create/rematch
DEMO_CHALLENGER_PRIVATE_KEY         # Demo signer for challenge
DEMO_SIGNER_PRIVATE_KEY             # Fallback demo signer
TURSO_DATABASE_URL                  # Turso read-index database
TURSO_AUTH_TOKEN                    # Turso auth token
```

---

## Key NPM Scripts

```bash
npm run dev                     # Start dev server
npm run build                   # Production build
npm run oracle                  # Start AI oracle agent
npm run deploy:contract         # Deploy Mimir.sol to Arc Testnet
npm run test:smoke              # Node smoke tests
npm run warm:vs-index           # Pre-warm API cache
```

---

## Smart Contract: Mimir.sol

### Key constants
- `MIN_STAKE = 2_000_000` — 2 USDC (6 decimals), native on Arc
- `MAX_CHALLENGERS = 100`
- `DEFAULT_PAYOUT_BPS = 20_000` — 2x for fixed odds

### State values
- `ST_OPEN = 0`, `ST_ACTIVE = 1`, `ST_RESOLVED = 2`, `ST_CANCELLED = 3`

### Winner side values
- `SIDE_NONE = 0`, `SIDE_CREATOR = 1`, `SIDE_CHALLENGERS = 2`, `SIDE_DRAW = 3`, `SIDE_UNRESOLVABLE = 4`

### Write functions (payable = USDC via msg.value)
```
createClaim(question, creatorPosition, counterPosition, resolutionUrl,
            deadline, stakeAmount, category, parentId, marketType, oddsMode,
            challengerPayoutBps, handicapLine, settlementRule, maxChallengers,
            isPrivate, inviteKey) → claimId

createRematch(parentId, deadline, stakeAmount, inviteKey) → claimId

challengeClaim(claimId, stakeAmount, inviteKey)

resolveClaim(claimId, winnerSide, summary, confidence)  // oracle-only
cancelClaim(claimId)                                    // creator + open state only
```

### Read functions
```
getClaim(claimId) → (creator, question, creatorPosition, counterPosition,
                     resolutionUrl, creatorStake, totalChallengerStake,
                     reservedCreatorLiability, deadline, state, winnerSide,
                     resolutionSummary, confidence, category, parentId,
                     challengerCount, createdAt)

getClaimMarketConfig(claimId) → (marketType, oddsMode, challengerPayoutBps,
                                  handicapLine, settlementRule, maxChallengers,
                                  isPrivate, reservedCreatorLiability)

getChallengerList(claimId) → (address[], uint256[])
getUserStats(user) → (wins, losses)
getPlatformStats() → (totalClaims, resolved, balance)
claimCount() → uint256
```

### Payout logic
- **CREATOR_WINS**: creator receives entire pot (`creatorStake + totalChallengerStake`)
- **CHALLENGERS_WIN (pool)**: each challenger receives `stake + (stake/totalChallengerStake) * creatorStake`
- **CHALLENGERS_WIN (fixed)**: each challenger receives `stake * challengerPayoutBps / 10000`; creator gets remainder
- **DRAW / UNRESOLVABLE**: full refunds to all parties

---

## Arc Chain Config (`lib/arc.ts`)

```typescript
export const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } },
};

// USDC is native — msg.value is USDC (6 decimals = 1 USDC)
export function usdcToWei(usdc: number): bigint  // 1 USDC → 10^18 wei
export function weiToUsdc(wei: bigint): number   // 10^18 wei → 1
export function ensureArcChain(ethereum)           // MetaMask chain switch
```

---

## Oracle Agent (`agents/oracle/index.ts`)

Off-chain TypeScript agent that settles claims:

1. Poll `claimCount` every 60 seconds
2. For each claim with `state === ACTIVE` and `deadline <= now`:
   - Fetch `resolutionUrl` (web scraping, strip HTML)
   - Call Claude claude-sonnet-4-6 to evaluate claim vs evidence
   - LLM returns `{ verdict, confidence, explanation }`
   - Send `resolveClaim(claimId, side, summary, confidence)` to Arc

```bash
npm run oracle
# requires: ORACLE_PRIVATE_KEY, ANTHROPIC_API_KEY, NEXT_PUBLIC_CONTRACT_ADDRESS
```

---

## TypeScript Types (`lib/contract.ts`)

```typescript
interface ClaimData {
  id, creator, question, creator_position, counter_position,
  resolution_url, creator_stake, total_challenger_stake,
  reserved_creator_liability, available_creator_liability,
  deadline, state, winner_side, resolution_summary, confidence,
  category, parent_id, challenger_count, market_type, odds_mode,
  challenger_payout_bps, handicap_line, settlement_rule, max_challengers,
  created_at, visibility, is_private, challengers, challenger_addresses,
  total_pot
}

interface VSData {
  // Same as ClaimData but with UI-friendly aliases:
  // state: "active" → "accepted"
  // counter_position → opponent_position
  // creator_stake → stake_amount
  // first_challenger → opponent
  // winner: address of winner (or ZERO_ADDRESS)
}
```

---

## Authentication

### Primary: MetaMask Wallet (EIP-1193)
1. Click "Connect Wallet"
2. `ensureArcChain(ethereum)` — switches to Arc Testnet (chain 5042002) or adds it
3. `eth_requestAccounts` → gets user address
4. Address stored in React context via `WalletProvider`

### Fallback: Demo Relay Mode
- Enabled when `NEXT_PUBLIC_DEMO_MODE=1`
- Server-side signers: separate keys for creator, challenger roles
- Writes routed through `POST /api/demo/write`
- `DemoRoleSwitcher` component lets user toggle between roles

---

## What is IMPLEMENTED

- [x] Solidity contract on Arc (USDC native stakes, oracle-only resolution)
- [x] Off-chain AI oracle agent (Claude claude-sonnet-4-6)
- [x] Pool odds and fixed odds
- [x] 6 market types: binary, moneyline, spread, total, prop, custom
- [x] Custom handicap lines and settlement rules
- [x] Rivalry/rematch system (`parentId` links, `createRematch`)
- [x] Public + private (invite-link) claims
- [x] Full create UI, full detail UI
- [x] MetaMask wallet auth with Arc chain-switch
- [x] Demo relay mode with role switcher
- [x] Optimistic pending VS (localStorage, 5 min expiry)
- [x] XMTP 1v1 encrypted chat
- [x] Messages hub (`/messages`)
- [x] English i18n
- [x] API cache layer (15s revalidation)
- [x] Category-specific settlement templates
- [x] Home page, Dashboard, Explore page
- [x] Animations (Framer Motion)
- [x] Dark theme UI (glass-morphism, glow effects)

## What is NOT IMPLEMENTED (remaining work)

- [ ] Event-time lock window (prevent late-info sniping)
- [ ] Confidence-based dispute tiers (high → settle, low → refund)
- [ ] On-chain `created_at` (currently uses `block.timestamp` — good on Arc)
- [ ] Ratio guardrails (per-user pool caps)
- [ ] Series/rivalry metadata (best-of-3 UI)
- [ ] Fee or spam-bond strategy

---

## Working Rules

- `contracts/Mimir.sol` is the source of truth — keep `lib/mimir-abi.ts` and `lib/contract.ts` aligned
- USDC is native on Arc — use `msg.value`, not ERC-20 transfers
- Resolution is oracle-only — do not expose user-triggered `resolveClaim()` in UI
- Categories in English: `sports`, `weather`, `crypto`, `culture`, `custom`
- i18n: English (`messages/en.json`) is the default and only locale
- Chain ID: 5042002 (Arc Testnet) — do not hardcode other chain IDs
