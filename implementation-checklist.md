# Mimir Product Direction and Roadmap

This file is the active product roadmap for Mimir.

`deep-research-report.md` remains useful background research, but this document is the active direction for product and engineering work.

Current implementation anchors:

- Contract: `contracts/Mimir.sol`
- Client wrapper: `lib/contract.ts`
- Create flow: `app/[locale]/vs/create/page.tsx`
- Detail flow: `app/[locale]/vs/[id]/page.tsx`

## Product Direction

Mimir should be built as a **Claim Duel Engine**, not as a trader-first prediction market.

In plain English:

- a user makes a clear claim about a future outcome
- defines both sides
- locks the rules before the deadline
- invites a challenger or joins an open challenge
- lets the AI oracle agent settle the result automatically in USDC

Best short framing:

**Make a claim. Find a challenger. Let the evidence decide.**

Primary target user:

- crypto-native, wallet-comfortable users
- small groups and online communities
- socially competitive users who already make bold public claims
- users motivated by status, being right, and direct challenge dynamics

Why Mimir should optimize for claim duels instead of liquidity depth:

- early users need clarity more than market complexity
- social motivation can compensate for thin liquidity better than trader tooling can
- head-to-head claims are easier to understand, join, and share
- trust will come from clean claim design and legible settlement, not from market size

## Product Principles

- **Clarity before stake.** Users should understand exactly what is being claimed, what source decides it, and when it settles before money is committed.
- **Legibility over magic.** Settlement should feel inspectable and procedural, not like a black-box AI verdict.
- **Social challenge over passive speculation.** The product should feel like a direct challenge, not a trading terminal.
- **Narrow, resolvable claims over expressive chaos.** Early quality matters more than maximum flexibility.
- **Automatic settlement needs a graceful failure path.** If a claim cannot be resolved cleanly, the product should clearly support an unresolvable or refund outcome.
- **Trust comes from process, not AI branding.** Lead with locked rules, evidence, and explainability rather than model language.

## Highest-Leverage Roadmap

### Phase 1: Trust and Discovery

This is the current highest-priority product work.

- strengthen claim quality guidance during creation using **Claim Strength**
- show clearer settlement previews before publish
- surface challenge-ready opportunities instead of generic browsing
- use real homepage stats instead of fake traction numbers
- keep the first-use loop simple and opinionated
- bias discovery toward claims users can confidently challenge

Phase 1 defaults:

- **Claim Strength** is the user-facing term
- popularity is not proof quality
- challengeability and clarity matter more than volume
- discovery should help users act, not just browse

### Phase 2: Settlement Explanation

This is the next trust layer after claim quality.

Resolved claims should show:

- what source was used
- what evidence was checked
- why side A or side B won
- a human-readable verdict summary
- confidence context from the oracle
- a structured receipt users can inspect and share

The goal is to make settlement feel understandable and defensible, not merely automatic.

### Phase 3: Trusted-Source Claim Drafting

Frame this capability as:

**Turn a trusted source into a verifiable claim**

Rules for v1:

- input mode is **trusted URL only**
- AI suggests, users approve
- use one explicit deadline in v1
- do not auto-publish
- do not allow multi-part claims in v1
- every draft needs one primary resolution source
- output should be structured, not free-form prose

Expected output shape at the product level:

- source summary
- 1 to 3 candidate claims
- side A and side B
- recommended deadline
- primary resolution source
- settlement rule
- ambiguity or confidence flags

Support first:

- sports and official fixtures
- company announcements, earnings pages, and investor pages
- crypto or protocol announcements from official sources

Avoid first:

- opinion content
- rumor content
- live blogs
- unsourced social-only discourse
- highly interpretive political or culture claims

### Phase 4: Challenge Opportunities

This is **not** a news feed.

It should be a small curated set of high-quality, challenge-ready opportunities.

Principles for the feed:

- do not show raw articles
- do not create a firehose
- do not build infinite scroll
- start with roughly **10 to 20 opportunities per day**
- operate it as **human-lite curated** early on
- use trusted-source ingestion, AI filtering, deduplication, then curation
- bias the primary CTA toward **Challenge this**
- keep `Create claim from this` as the secondary action
- prefer canonical shared opportunities over duplicate markets

Scarcity is a product choice here:

- fewer, better opportunities
- more coordination around the same claims
- less fragmentation across near-duplicate markets

## What Not to Build Yet

- advanced trading mechanics
- more market-type expansion
- broad social-platform features
- manual arbitration layers
- enterprise or compliance-heavy tooling

## Arc / Hackathon-specific priorities

These are additional priorities for the Agora Agents Hackathon (May 11–25, 2026):

- [x] Deploy `contracts/Mimir.sol` on Arc Testnet (Chain ID 5042002)
- [x] USDC native stakes (no ERC-20 approval flow)
- [x] AI oracle agent (`agents/oracle/index.ts`) — Claude-powered off-chain resolver
- [ ] Event-time lock window (prevent late-info sniping)
- [ ] Confidence-based dispute tiers (high → settle, low → refund)
- [ ] Arc faucet link in onboarding
- [ ] `created_at` populated via `block.timestamp`
