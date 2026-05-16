# Mimir — Betting Theory and Game Design Review

## Purpose

This memo reviews the original research draft against the code currently in this repo and reframes it as a practical design note for Mimir as it exists today.

Source of truth for implementation:

- Contract: `contracts/Mimir.sol`
- Client wrapper: `lib/contract.ts`
- Create flow: `app/[locale]/vs/create/page.tsx`
- Detail flow: `app/[locale]/vs/[id]/page.tsx`

## What Mimir is now

Mimir is not just a "one creator vs many challengers pool bet."

In the current codebase, Mimir is a claim-based market engine with four important degrees of freedom:

1. Participation format
   - `max_challengers = 1` gives classic head-to-head.
   - `max_challengers > 1` gives 1-vs-many.

2. Pricing model
   - `odds_mode = "pool"` behaves like an asymmetric two-sided pari-mutuel pool.
   - `odds_mode = "fixed"` behaves more like creator-posted liquidity offering a fixed challenger payout.

3. Settlement model
   - `market_type` can be `binary`, `moneyline`, `spread`, `total`, `prop`, or `custom`.
   - `handicap_line` and `settlement_rule` let the claim define custom grading logic.

4. Visibility model
   - public claims appear in arena feeds
   - private claims require an invite link and are hidden from public listings

There is also a built-in rivalry layer:

- `parent_id` links related claims
- `createRematch(...)` creates a new claim from an earlier one
- rivalry chain can be reconstructed from `parent_id` traversal

So the best short label for the current product is:

**"An AI-settled claim market supporting head-to-head, 1-v-many, pool-odds, fixed-odds, and rivalry-linked rematches — settled in USDC on Arc."**

## Betting theory classification

### Pool mode

When `odds_mode = "pool"`, Mimir is closest to a two-outcome pari-mutuel pool with asymmetric participation.

Let:

- creator stake = `C`
- total challenger stake = `S`
- total pot = `C + S`

Then:

- if creator wins, creator receives `C + S`
- if challengers win, each challenger receives `stake + proportional share of C`

That is standard pool-bet logic. The crowd determines the payout by where money lands.

### Fixed-odds mode

When `odds_mode = "fixed"`, Mimir is not pari-mutuel anymore.

In the current contract:

- each challenger's gross payout is `stake * challenger_payout_bps / 10000`
- the contract reserves creator liability as challengers join
- if challengers win, they are paid at that fixed rate
- any unused creator stake is returned to the creator

That means Mimir spans two different economic models:

- pool pricing
- creator-backed fixed pricing

## What the current contract already gets right

### 1. Creator self-challenge is blocked

The creator cannot challenge their own claim from the same wallet:

- `challengeClaim(...)` rejects `msg.sender == claim.creator`

This does not stop multi-wallet sybil behavior, but it does close the simplest same-wallet exploit.

### 2. 1-v-many is a first-class primitive

The product is not faking "many challengers" at the UI level. The contract stores:

- challenger addresses
- challenger stakes
- challenger count
- max challengers

This is the right base for open arena claims.

### 3. Fixed odds are liquidity-aware

For fixed-odds claims, the contract reserves creator liability on every challenger join. That is good design:

- it prevents promising more payout than the creator can fund
- it makes fixed odds safer than a naive "trust me" model

### 4. Rematches are modeled cleanly

Rivalry is not a frontend-only concept. It is encoded onchain through `parent_id`, which is the right long-term design.

### 5. Draw / unresolved outcomes refund instead of forcing a bad settlement

If the AI oracle verdict is `DRAW` or `UNRESOLVABLE`, the contract returns funds rather than forcing an arbitrary winner. For a product using web+AI settlement, that is the correct bias.

### 6. Minimum stake floor

The contract enforces `MIN_STAKE = 2_000_000` (2 USDC), and the create/join flows surface that to the user.

That is a good hackathon-grade floor because it filters out the worst dust spam without overcomplicating the UX.

### 7. Private-link claims are first-class

The product is no longer only "public arena" betting.

Private claims:

- are hidden from public feed methods
- require an invite key to view or join
- still reuse the same settlement and rivalry model

That is useful because it gives Mimir both an open-market mode and a direct social challenge mode.

## Main gaps between theory and current implementation

These are the most important remaining issues.

### 1. No lock window before information becomes public

This is still the biggest game integrity risk.

The contract has a `deadline`, but it does not enforce:

- event start time
- market close before public observability
- a pre-resolution lock window

Recommended next step:

- add `eventTime` field to `createClaim`
- require `deadline <= eventTime - buffer`
- stop new challenges during the final lock window

### 2. Minimum stake exists, but deeper stake guardrails do not

What is still missing:

- relative challenger minimums for larger creator stakes
- per-user caps inside a single challenger pool
- creator-to-challenger ratio caps for extreme pool optics

### 3. Oracle ambiguity is still the hardest real risk

Today the contract allows:

- free-form `resolutionUrl`
- free-form `settlementRule`
- free-form `handicapLine`

Recommended next step:

- add category-specific resolution templates
- whitelist a few demo-safe source patterns
- require more structured market metadata for sports and price markets

### 4. AI confidence should stay a validity signal, not payout math

Confidence is valuable, but it should not directly scale payouts.

Better pattern:

- high confidence: settle normally
- medium confidence: settle, mark as contested
- low confidence: refund as unresolvable

### 5. Pool extremes still need work

In pool mode, thin or lopsided pools can produce wild optics.

Recommended:

- optionally cap challenger capacity by ratio, not only by count
- show challenger count or qualitative "heat" more prominently than raw pot totals on discovery surfaces
- keep exact payout math available on the detail page

### 6. No fee or spam-bond strategy yet

The current contract has no rake, no creator bond, and no spam tax.

That is fine for a hackathon demo, but not for a durable public arena.

### 7. `created_at` from `block.timestamp`

`created_at` is now populated via `block.timestamp` on Arc (EVM). This is correct and trustworthy — Arc has sub-second deterministic finality.

### 8. Exploit prevention is still mostly an off-chain operations problem

The contract blocks the easiest same-wallet abuse, but harder attacks will not be solved by a single revert path.

Main risks:

- creator/challenger collusion across multiple wallets
- sybil challengers farming incentives or shaping private pools
- late-join sniping in weakly timed markets
- source manipulation around web evidence and ambiguous settlement links

## Product implications by feature

### Rivalry / rematch

This feature is conceptually strong and already modeled correctly onchain.

Best positioning:

- rivalry is social continuity, not stake escalation
- rematches should be optional and bounded
- the "series score" is the main reward

### Odd bets and custom handicaps

This is one of the strongest differentiators in the current contract.

But it also raises the settlement burden — every extra degree of freedom makes ambiguous grading more likely.

### 1 vs several

Two useful control levers already exist:

- `maxChallengers`
- `oddsMode`

That gives Mimir a nice spectrum:

- 1v1 fixed-odds duel
- 1v1 pool bet
- 1vmany pool arena
- 1vmany fixed-odds liquidity offer

## Arc-specific notes

- USDC is the native gas token on Arc — `msg.value` is USDC (6 decimals), no ERC-20 approval needed.
- Sub-second finality means `block.timestamp` is reliable for `created_at` and deadline enforcement.
- The AI oracle agent runs off-chain (see `agents/oracle/index.ts`) and calls `resolveClaim()` on Arc.
- Settlement cost: ~$0.01 USDC per resolution transaction.

## Recommended short roadmap

If the goal is a stronger demo with minimum surface area, this is the order to prioritize:

1. Keep current unified contract model.
2. Deploy `contracts/Mimir.sol` on Arc Testnet and update `NEXT_PUBLIC_CONTRACT_ADDRESS`.
3. Add lock-window / event-time rule.
4. Add ratio and concentration guardrails for small pools.
5. Add confidence/dispute tiers for low-quality resolutions.
6. Add lightweight series stats for rivalry.
7. Add fee or spam-bond only after the core UX feels trustworthy.

## Recommended one-paragraph product framing

Mimir is an AI-settled claim market where users stake USDC on verifiable outcomes and the Mimir oracle agent resolves the result from explicit market terms, evidence sources, and Claude AI evaluation. A claim can run as a head-to-head duel or a 1-v-many arena, using either pool odds or creator-backed fixed odds, and every rematch can be linked into an onchain rivalry chain. The core experience is not just "betting on a result" but publicly pricing conviction: if you are right against the crowd, the payout reflects it; if a market is ambiguous, the protocol refunds rather than faking certainty. Settlement happens in USDC on Arc with sub-second finality.

## Practical conclusion

Today Mimir should be designed and explained as:

- a unified claim engine on Arc (Circle L1)
- with multiple market types
- multiple pricing modes
- multiple challenger formats
- USDC-native stakes and payouts
- AI oracle settlement via Claude

That is a stronger product story than "one creator versus many challengers," and the code already supports most of it.
