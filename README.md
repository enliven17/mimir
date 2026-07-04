# Mimir

**An AI-settled claim market on [Arc](https://arc.network) — Circle's stablecoin-native L1.**

> *In Norse mythology, Mimir is the guardian of the Well of Wisdom — an oracle who knows all things past, present, and future.*

Mimir is a peer-to-peer market for public claims about future outcomes. Two parties stake USDC on opposite sides of a question; when the deadline passes, an off-chain AI oracle reads the agreed-upon evidence source, evaluates the verdict, and settles the payout on-chain. Every step — staking, challenging, resolution, payout — happens in native USDC with sub-second finality and predictable, sub-cent fees.

The agents that run Mimir do not hold private keys. They sign every transaction through Circle's Programmable Wallets (W3S), use Circle's CCTP V2 to bridge USDC into Arc from any supported chain, and surface a unified balance via Circle Gateway. The result is an economy where AI services are first-class on-chain participants, not just off-chain observers.

---

## Lepton hackathon — what's new since Arc

Mimir won the Arc/Agora hackathon as a macro-stake claim market. For Lepton (nanopayments theme), the agents became **paying and selling economic actors at sub-cent granularity** via **x402** + **Circle Gateway Nanopayments** — settled in test USDC on Arc, signed through W3S (**no local private keys**, the property Circle's own `GatewayClient` can't keep).

| New since Arc | What it does | Endpoint / script | Proven |
| --- | --- | --- | --- |
| **Paying oracle** | Oracle pays per-fetch for paywalled evidence (HTTP 402), budgeting a fraction of the claim pot — the agent *decides* what evidence is worth buying | `lib/x402.ts`, `lib/server/evidence-fetcher.ts` | ✅ live |
| **Premium data API** | Sells price snapshots per call ($0.001) — any agent can buy | `GET /api/premium/price` | ✅ paid e2e |
| **Oracle-as-a-Service** | Sells the oracle's verdict per call ($0.005) | `POST /api/oracle` | ✅ |
| **Creator monetization** (primary RFB) | Each of the 10 council personas sells its reasoning pay-per-read ($0.001); **revenue settles into that persona's own wallet** | `GET /api/council/reasoning` | ✅ paid → persona wallet |
| **Market-creator preflight** | Market-creator buys council persona opinions before opening a market, then filters low-consensus candidates | `POST /api/council/preflight`, `agents/market-creator/council-preflight.ts` | ✅ |
| **Gateway deposit via W3S** | Enables gasless batched payments without a private key | `npm run gateway:deposit` | ✅ 5 USDC deposited |
| **Agent-to-agent payment** | One Mimir agent buys from another, real USDC flowing | `npm run x402:demo` | ✅ |
| **Traction generator** | Drives real nanopayments for the traction story | `npm run x402:traffic` | ✅ 10/10 settled |
| **Revenue dashboard** | Live USDC earned, paying agents, per-endpoint — durable (Neon), each payment links to its on-chain receipt | `/revenue` | ✅ |
| **Council-as-jury settlement** | At settlement the oracle *buys* each eligible persona's verdict ($0.001 → persona wallet) and settles by their tally — multi-agent consensus, committed on-chain via `evidenceHash`. Every persona is a paid juror, not decoration | `GET /api/council/vote`, `agents/oracle/council-vote.ts` | ✅ |
| **Subscription pass** | One nanopayment ($0.01) buys a time-boxed window of free council reads — the recurring-access tier on top of per-read | `POST /api/council/subscribe` | ✅ |
| **Pull-payment safety** | Failed payout pushes park in `pendingWithdrawals` (claim via `withdraw()`) instead of reverting settlement — one bad recipient can't freeze everyone's payout | `contracts/Mimir.sol` | ✅ v2 |

**Architecture:** the buyer signs the x402 EIP-3009 authorization through W3S `signTypedData` (no key), the seller side runs Circle's Gateway middleware which settles through Circle's hosted facilitator on Arc testnet. See `lib/x402.ts` (buy) and `lib/x402-server.ts` (sell).

**Contracts on Arc Testnet:**
- **v2 (live):** [`0x50036154a3bc51f2e7d604a2fbc596f02bb555a1`](https://testnet.arcscan.app/address/0x50036154a3bc51f2e7d604a2fbc596f02bb555a1) — adds pull-payment safety (`withdraw()`).
- **v1 (legacy, immutable):** [`0x8c7016b1124983fb00dc022d88e3de997cdb5873`](https://testnet.arcscan.app/address/0x8c7016b1124983fb00dc022d88e3de997cdb5873) — the Arc/Agora track record: **181 claims created, 104 resolved** in native USDC.

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Paying agent
    participant W3S as Circle W3S
    participant API as Paid endpoint
    participant Gateway as Circle Gateway
    participant Arc as Arc settlement
    participant DB as Neon ledger

    Agent->>API: request paid resource
    API-->>Agent: HTTP 402 + price + payment requirements
    Agent->>W3S: sign EIP-3009 authorization
    W3S-->>Agent: payment payload
    Agent->>API: retry with X-PAYMENT
    API->>Gateway: verify and settle
    Gateway->>Arc: USDC transfer
    API->>DB: record receipt
    API-->>Agent: paid response
```

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [End-to-end market flow](#end-to-end-market-flow)
- [The settlement lifecycle](#the-settlement-lifecycle)
- [Contract state machine](#contract-state-machine)
- [Agents as economic actors](#agents-as-economic-actors)
- [Circle stack integration](#circle-stack-integration)
- [Cross-chain inflow (CCTP V2)](#cross-chain-inflow-cctp-v2)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Local setup](#local-setup)
- [End-to-end demo](#end-to-end-demo)
- [Production deploy (Vercel + Railway)](#production-deploy-vercel--railway)
- [Configuration reference](#configuration-reference)
- [Scripts](#scripts)
- [Game modes roadmap](#game-modes-roadmap)
- [Design principles](#design-principles)

---

## What it does

A **claim** in Mimir is a single, verifiable question with a deadline and a designated resolution source. For example:

> *"Will BTC close above $100,000 USD on 2026-05-25 according to CoinGecko?"*

Anyone can create a claim, stake USDC on one side, and publish it. Another party (or the autonomous market-creator agent) can **challenge** by staking USDC on the opposite side. When the deadline passes, the **oracle agent** fetches the agreed-upon evidence URL, asks a large language model to evaluate the outcome against the stated rule, and submits the verdict on-chain. The smart contract then atomically pays out the winning side.

There are no judges, no committees, no manual disputes. The product surfaces are:

| Page                                 | Purpose                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `/`                                  | Marketing surface — what Mimir is, live stats, recent settlements                  |
| `/explorer`                          | Claim feed with Open / AI signals / Closed tabs and category + stake filters       |
| `/vs/[id]`                           | Claim detail — pool sizes, challengers, settlement receipt with confidence tier     |
| `/vs/create`                         | Author flow — claim drafting with AI-assisted resolution metadata                  |
| `/dashboard`                         | Per-wallet view — your claims, your payouts, your W/L record                       |
| `/bridge`                            | Pull USDC into Arc from any CCTP V2 chain in ~15s                                  |
| `/stats`                             | Real-time on-chain analytics: total volume, accuracy %, refund rate, agent vault   |
| `/agents`                            | Live activity log for the oracle + market-creator (every on-chain action they take) |
| `/docs`                              | Long-form architecture + how-it-works writeup with custom diagrams                  |
| `/emerging-narratives`               | Daily-curated "challenge-ready" opportunities (human-lite curation)                |

---

## Architecture

```mermaid
flowchart LR
    subgraph user[Users]
        U[Wallet user<br/>MetaMask / Coinbase]
    end

    subgraph vercel[Vercel - Frontend tier]
        FE[Next.js 16 app<br/>app/locale/...]
        API[Route handlers<br/>app/api/...]
    end

    subgraph railway[Railway - Worker tier]
        OR[Oracle agent<br/>settle + auto-challenge]
        MC[Market creator agent<br/>markets + duplicate guard]
        CO[Council personas<br/>paid jurors + challengers]
    end

    subgraph circle[Circle stack]
        W3S[Programmable Wallets<br/>W3S - agent signer]
        CCTP[CCTP V2<br/>burn-and-mint bridge]
        GW[Gateway<br/>unified USDC balance]
        APP[App Kit<br/>multichain SDK]
    end

    subgraph arc[Arc Testnet]
        CT[Mimir.sol<br/>0x5003...5a1]
        USDC[Native USDC<br/>18 decimals]
    end

    NEON[(Neon Postgres<br/>read-index cache)]
    LLM[LLM layer<br/>verdicts, drafts, reasoning]

    U -->|connect| FE
    FE -->|signed tx| CT
    FE -->|reads| API
    API -->|RPC| CT
    API --> NEON
    API -->|balance| GW

    OR -->|sign tx via| W3S
    MC -->|sign tx via| W3S
    CO -->|sign tx via| W3S
    W3S -->|submit| CT
    OR -->|fetch evidence + verdict| LLM
    MC -->|draft candidates| LLM
    CO -->|persona reasoning| LLM
    OR -->|index claims| NEON
    MC -->|index claims| NEON

    U -->|optional bridge| CCTP
    CCTP -->|mints to| USDC

    CT -.->|owns the contract & oracle role| W3S
```

The diagram shows three independent runtime tiers:

1. **Frontend tier (Vercel)** — Next.js App Router with API routes. Pure read paths talk to Arc RPC directly; writes are user-signed via wagmi/viem.
2. **Worker tier (Railway)** — long-lived Node processes that poll the chain, evaluate claims with an LLM, and submit settlement transactions. They sign via W3S, never with a local private key.
3. **Data tier (Neon Postgres)** — a denormalised read-index of the on-chain state. Optional; the app boots without it and the contract remains the source of truth.

---

## End-to-end market flow

```mermaid
flowchart LR
    Q[Question + source + settlement rule]
    C[Create claim<br/>creator stakes USDC]
    B[Challenge claim<br/>counter-side stakes USDC]
    D[Deadline passes<br/>market locks]
    E[Fetch evidence<br/>hash raw bytes]
    L[LLM read<br/>verdict + confidence]
    J[Optional council vote<br/>paid persona verdicts]
    R[resolveClaim<br/>write result on Arc]
    P[Payout or refund<br/>native USDC]

    Q --> C --> B --> D --> E --> L --> J --> R --> P
    E -. evidenceHash .-> R
    J -. quorum / fallback .-> R
```

The product keeps the primitive small: one question, one source, one deadline, and funded sides. The chain stores the funded state; workers handle reading, interpretation, paid council coordination, and the final settlement transaction.

---

## The settlement lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant Creator
    participant Challenger
    participant Contract as Mimir.sol (Arc)
    participant Oracle as Oracle Agent
    participant W3S as Circle W3S
    participant LLM as LLM layer
    participant Source as Resolution URL

    Creator->>Contract: createClaim(question, URL, deadline, stake USDC)
    Note over Contract: state = OPEN<br/>creatorStake stored
    Challenger->>Contract: challengeClaim(claimId, stake USDC)
    Note over Contract: state = ACTIVE<br/>challengerStake stored

    Note over Contract: ... deadline passes ...

    Oracle->>Contract: getClaim(claimId) [poll loop]
    Oracle->>Source: fetch resolution evidence
    Source-->>Oracle: raw HTTP body
    Oracle->>LLM: prompt: claim + evidence + settlement rule
    LLM-->>Oracle: verdict + confidence + explanation

    Oracle->>W3S: contractExecution: resolveClaim(...)
    W3S-->>W3S: encrypt entity secret + sign tx
    W3S->>Contract: resolveClaim(side, summary, confidence, evidenceHash)

    Note over Contract: state = RESOLVED<br/>winning side paid out<br/>evidenceHash on-chain
    Contract-->>Creator: payout (if creator wins)
    Contract-->>Challenger: payout (if challenger wins)
```

Several details matter for trust:

- **`evidenceHash`** is `keccak256(raw evidence)` and is committed to the contract storage. Anyone can re-fetch the URL, hash it, and verify what the oracle actually saw.
- **`confidence`** is exposed on-chain. The oracle bakes it into tiers — `≥ 80%` settles as **FIRM**, `60–79%` settles with a **CONTESTED** badge, `< 60%` is force-downgraded to `UNRESOLVABLE` and refunded. The Settlement Receipt UI surfaces the tier explicitly.
- **`UNRESOLVABLE` and `DRAW`** refund all sides instead of forcing an arbitrary winner. The protocol prefers refunding ambiguity over fabricating certainty.
- **Challenge lock window.** `challengeClaim` rejects any tx that lands within `CHALLENGE_LOCK_SECONDS` (60s) of the deadline. Stops late-information actors from waiting until the outcome is observable and slipping in a zero-risk bet.
- **Only the configured `oracle` address** can call `resolveClaim`. That address is a Circle-managed wallet — no human can quietly re-route it.

### Self-resolving jury mode (opt-in)

With `COUNCIL_SETTLEMENT=1 COUNCIL_SELF_RESOLVING=1` the oracle stops deciding alone and runs settlement as a **self-resolving prediction market** over the council, adapting the mechanism from [Srinivasan, Karger & Chen — *Self-Resolving Prediction Markets for Unverifiable Outcomes* (arXiv:2306.04305)](https://arxiv.org/abs/2306.04305):

```mermaid
sequenceDiagram
    autonumber
    participant Oracle as Oracle (terminal agent)
    participant J1 as Juror 1 (shuffled order)
    participant J2 as Juror 2
    participant Jn as Juror n
    participant Contract as Mimir.sol

    Note over Oracle: common prior q0 = 0.5
    Oracle->>J1: buy vote (x402 $0.001) — no history yet
    J1-->>Oracle: verdict + confidence → q1
    Oracle->>J2: buy vote — prompt includes J1's report
    J2-->>Oracle: q2
    Note over Oracle: once quorum is met, each further vote<br/>only happens with probability 1 − α
    Oracle->>Jn: buy vote — sees the full report history
    Jn-->>Oracle: qn
    Note over Oracle: terminal (reference) assessment:<br/>own evidence + all juror reports → qT
    Oracle->>Contract: resolveClaim(verdict, confidence,<br/>evidenceHash incl. q-chain + CE scores)
    Oracle->>J1: cross-entropy bonus (native USDC)<br/>only if score > 0
```

- **Sequential, visible history.** Jurors vote in shuffled order and each sees the prior reports (`"The Optimist: 90% challengers — …"`), so information aggregates like a real market instead of ten blind parallel opinions.
- **Cross-entropy scoring.** Each report maps to `q = P(challengers win)` and is scored against the oracle's terminal, history-informed assessment: `S = qT·ln(qt/qprev) + (1−qT)·ln((1−qt)/(1−qprev))`. Parroting the prior scores **exactly zero**; informative updates toward the reference split the `COUNCIL_BONUS_USDC` pool, paid after settlement as native USDC transfers into juror wallets. The flat $0.001 x402 vote fee remains the participation floor.
- **Random termination.** Once `COUNCIL_QUORUM` decisive reports exist, every further vote happens only with probability `1 − COUNCIL_ALPHA` — the terminal position stays unpredictable and LLM spend per settlement is bounded.
- **Verifiable.** The q-chain, reference belief, and per-juror scores are embedded in the committed `evidenceHash` payload, so the whole scored market can be audited against the on-chain hash.

The truthfulness argument follows the paper: jurors cannot influence the reference belief (the oracle's evidence is independent of their reports), so the cross-entropy rule makes honest probability reporting the payoff-maximizing strategy, and uninformative equilibria pay nothing.

---

## Contract state machine

```mermaid
stateDiagram-v2
    [*] --> OPEN: createClaim + creator stake
    OPEN --> ACTIVE: challengeClaim + counter stake
    ACTIVE --> RESOLVED: oracle resolveClaim
    OPEN --> CANCELLED: creator cancels expired unchallenged claim
    RESOLVED --> [*]: payout or refund complete
    CANCELLED --> [*]: creator stake refunded

    note right of OPEN
      Joinable market.
      Creator side is funded.
    end note
    note right of ACTIVE
      Both sides funded.
      Deadline must pass before settlement.
    end note
    note right of RESOLVED
      CREATOR, CHALLENGERS, DRAW,
      or UNRESOLVABLE.
    end note
```

This narrow state machine is why the UI can stay deterministic: open markets invite challengers, active markets wait for the deadline, resolved markets show receipts, and expired unchallenged markets can be cleaned up without touching live inventory.

---

## Agents as economic actors

**Twelve** background agents run continuously: the oracle (settler + optional auto-challenger), the market-creator, and the ten-persona Mimir Council. None of them holds a local private key — every transaction is signed through Circle's Programmable Wallets.

> **Deep dive:** see [`docs/COUNCIL.md`](docs/COUNCIL.md) for the full council architecture, persona-by-persona strategy, and rate-limit design.

### Oracle agent (`agents/oracle/index.ts`)

A poll loop every 60 seconds. Two roles:

```mermaid
stateDiagram-v2
    [*] --> Polling
    Polling --> ReadClaim: every claim id
    ReadClaim --> Settler: state = ACTIVE and deadline passed
    ReadClaim --> Challenger: state = OPEN and AUTO_CHALLENGE=1
    ReadClaim --> Skip: otherwise

    Settler --> FetchEvidence
    FetchEvidence --> AskLLM
    AskLLM --> SubmitResolve: confidence checked
    SubmitResolve --> Polling

    Challenger --> EarlyEvaluate: read evidence early
    EarlyEvaluate --> KellySize: only if highly confident<br/>challenger side will win
    KellySize --> SubmitChallenge: stake = min(Kelly, 10% bankroll)
    SubmitChallenge --> Polling
    Skip --> Polling
```

- The **settler role** fulfils the protocol's mandate: read evidence, ask the LLM, settle. Pure on-chain side-effect.
- The **challenger role** (opt-in with `AUTO_CHALLENGE=1`) turns the oracle into a real economic participant. It uses the [Kelly criterion](https://en.wikipedia.org/wiki/Kelly_criterion) to size stakes, capped at 25% of its bankroll, never staking when its own confidence is below the configured threshold (default 80%).
- **Settlement runs in one of three modes**: solo LLM verdict (default), council tally (`COUNCIL_SETTLEMENT=1` — buy every eligible persona's verdict and settle by majority), or the **self-resolving jury** (`COUNCIL_SELF_RESOLVING=1` — sequential scored voting; see [the settlement lifecycle](#the-settlement-lifecycle)).

### Market-creator agent (`agents/market-creator/index.ts`)

Runs every 6 hours. Fetches public data feeds (CoinGecko, ESPN, OpenWeather), asks the LLM to draft 1–5 verifiable claim candidates, scores each candidate for quality, and creates the highest-scoring ones on-chain — staking the creator side from its own balance. This means **opening a claim is itself an economic commitment from an AI agent**, not a free tweet.

The agent treats curation as the scarce resource. The default cap is 5 markets per run with a quality floor of 70/100, so the surface stays sparse and challenge-ready rather than noisy. When `MIMIR_BASE_URL` or `MARKET_CREATOR_PREFLIGHT=1` is configured, it also buys paid council preflight opinions from selected personas before opening a market. Low-consensus candidates are dropped; high-consensus candidates are opened gradually with `MARKET_CREATE_DELAY_MS` spacing transactions.

Sports deadlines are guarded twice: ESPN games must have a future start time before they are shown to the LLM, and drafted sports candidates are dropped if the game has already started/passed or if the deadline is not at least 4 hours after kickoff. This prevents markets like a June 25 match receiving a June 27 deadline.

### The Mimir Council (`agents/council/index.ts`)

Ten distinct AI personas, each with its own W3S-managed wallet and its own way of looking at a market. The roster is intentionally heterogenous so different views show up on the same claim:

| Persona | What they do |
|---|---|
| 🌞 Optimist · 🌧️ Pessimist · 💀 Doomer | LLM-biased — the oracle's evaluation prompt with a personality prefix that nudges the model's read. |
| 📊 Statistician | LLM-biased with a 90% confidence floor — rare but decisive bets. |
| 🔁 Contrarian · 🐋 Whale-Watcher | Pure rule-based, never call the LLM. Contrarian stakes the smaller pool; Whale-Watcher copies the biggest individual challenger. |
| ₿ Crypto Maximalist · 🏈 Sports Pundit · 🌤️ Weatherman | Category specialists — only evaluate claims in their domain. |
| 🗣️ Yapper | Micro-stakes (0.5 USDC) at a low 60% confidence threshold for maximum market presence. |

Personas can only call `challengeClaim` (settlement stays with the oracle, market creation stays with the market-creator). A persona that agrees with the creator simply abstains. Decisions are made through the same Kelly-sized, evidence-hashed pipeline the oracle uses — just with persona-specific prompt biases and a shared per-cycle evidence cache so ten personas don't re-fetch the same URL.

The worker runs slowly by default: one deadline-prioritized claim per cycle, with `COUNCIL_DECISION_DELAY_MS` spacing persona decisions to avoid LLM 429s and clustered on-chain stakes.

The council surfaces in the UI on [`/council`](app/[locale]/council/page.tsx) (full roster + balances + bets), in the [`/agents`](app/[locale]/agents/page.tsx) live feed with persona badges and a per-persona dropdown, in the [`/stats`](app/[locale]/stats/page.tsx) "First N stakers" wall, and as a `Council verdict` card on every claim detail page that lists each persona's stake or abstention.

See [`docs/COUNCIL.md`](docs/COUNCIL.md) for the full architecture, rate-limit strategy, and env reference.

---

## Circle stack integration

| Piece                          | Where it lives                                                                | What it actually does in Mimir                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **USDC** as native token       | `contracts/Mimir.sol`, `lib/arc.ts`                                           | Stakes use `msg.value` — no ERC-20 approval flow, no allowance dance, ~$0.01 per call                                |
| **Programmable Wallets (W3S)** | `lib/circle-w3s.ts`, both agent entry points                                  | Oracle + market-creator wallets are Circle-managed. Every contract execution goes through `executeContract(...)`     |
| **CCTP V2 (Fast Transfer)**    | `lib/cctp.ts`, `app/[locale]/bridge/page.tsx`                                 | Browser-driven burn-and-mint bridge from Eth/Base/Avalanche Sepolia into Arc in ~15s                                 |
| **Gateway**                    | `app/api/gateway/balances/route.ts`, `components/GatewayBalanceWidget.tsx`    | Server-side proxy returns the user's unified USDC balance across every CCTP V2 domain in one round-trip              |
| **App Kit / Swap Kit** (key)   | reserved via `CIRCLE_KIT_KEY` for future server-side bridge orchestration     | The CCTP path currently runs entirely on-chain via viem; App Kit hooks in if/when we want server-funded sponsorship  |

### W3S transaction submission

```mermaid
sequenceDiagram
    autonumber
    participant Agent
    participant Helper as lib/circle-w3s.ts
    participant W3S as Circle W3S API
    participant Arc as Arc RPC

    Agent->>Helper: executeContract({ walletId, abiSignature, abiParameters, amount })
    Helper->>W3S: GET /config/entity/publicKey (cached 5min)
    W3S-->>Helper: RSA pubkey (PEM)
    Helper-->>Helper: encrypt CIRCLE_ENTITY_SECRET with RSA-OAEP / SHA-256
    Helper->>W3S: POST /developer/transactions/contractExecution<br/>{ ciphertext, walletId, abi*, amount }
    W3S-->>Helper: { transactionId }

    loop until terminal state
        Helper->>W3S: GET /transactions/:id
        W3S-->>Helper: { state: INITIATED | CONFIRMED | FAILED, txHash? }
    end

    W3S->>Arc: broadcast signed tx
    Helper-->>Agent: txHash
```

A fresh ciphertext is generated for every call. The entity secret never leaves the worker process; only the per-request ciphertext travels to Circle.

---

## Cross-chain inflow (CCTP V2)

The `/bridge` page is a thin orchestrator over Circle's V2 contracts and the Iris attestation API. Everything runs in the browser via wagmi/viem; no backend session, no custodial step.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Wallet as Browser wallet
    participant Source as Source chain<br/>(Eth / Base / Avax Sepolia)
    participant Iris as Circle Iris API
    participant Arc as Arc Testnet

    User->>Wallet: select source chain + amount
    Wallet->>Source: switch_chain
    User->>Wallet: approve USDC for TokenMessengerV2
    Wallet->>Source: approve(spender, amount)
    User->>Wallet: burn for Arc
    Wallet->>Source: depositForBurn(amount, destDomain=26, mintRecipient, ...)
    Source-->>Wallet: tx receipt with messageHash

    loop poll every 3s
        Wallet->>Iris: GET /v2/messages/0/?transactionHash=<burnTx>
        Iris-->>Wallet: { status }
    end
    Iris-->>Wallet: { status: complete, attestation, message }

    User->>Wallet: switch_chain to Arc
    User->>Wallet: mint
    Wallet->>Arc: receiveMessage(message, attestation)
    Arc-->>User: USDC credited
```

Key facts:

- **CCTP V2 contract addresses** are identical across all V2 chains (deterministic CREATE2), only the **domain ID** differs. Mimir hard-codes the four testnet domains we support (Eth Sepolia, Base Sepolia, Avalanche Fuji, Arc Testnet).
- **Fast Transfer** finalises in ~13–19 seconds; we set `minFinalityThreshold = 1000` and pass a 0.1% slippage `maxFee`.
- The `receiveMessage` call on Arc is **permissionless** — the user's own wallet submits it, no backend signer required.

---

## Tech stack

| Layer              | Choice                                                                            | Why                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Frontend           | Next.js 16 (App Router) + React 18 + TypeScript + Tailwind CSS + Framer Motion    | App Router for streaming + parallel route handlers; Framer Motion for the bridge stepper and live deadline UI    |
| Wallet             | wagmi v3 + viem v2                                                                | Chain-aware multi-wallet support; first-class CCTP source-chain switching                                        |
| Smart contract     | Solidity ^0.8.20, compiled with solc 0.8.28 `viaIR`                               | Mimir.sol is dependency-free. `viaIR` is required because the create flow exceeds stack-depth without it         |
| Blockchain         | Arc Testnet (chain ID `5042002`)                                                  | Stablecoin-native L1: USDC is the gas asset, sub-second deterministic finality                                   |
| Native currency    | USDC (18 decimals at the EVM level, 6 display decimals)                           | `msg.value` accepts USDC directly; stakes settle without ERC-20 approval rounds                                  |
| Agent signer       | Circle W3S developer-controlled wallets                                           | Removes private-key handling from worker processes; satisfies prod-grade key management                          |
| Cross-chain        | Circle CCTP V2 Fast Transfer + Iris attestation                                   | ~15s end-to-end, no third-party bridge trust                                                                     |
| Unified balance    | Circle Gateway `POST /v1/balances`                                                | One-call multi-domain balance view, proxied through our API to keep the key server-side                          |
| LLM layer          | Routed language model layer                                                      | `lib/llm.ts` handles model calls, cooldowns, and fallback routing                                                  |
| Messaging          | XMTP Browser SDK v7 (`@xmtp/browser-sdk`)                                         | Optional E2E-encrypted chat between creator and challenger before/after settlement                               |
| Database           | Neon Postgres via `@neondatabase/serverless`                                      | Serverless-friendly driver, works on both Vercel functions and Railway long-running workers                      |
| i18n               | next-intl (English + Spanish)                                                     | Locale-prefixed routing (`/en/*`, `/es/*`), runtime message loading                                              |
| Frontend hosting   | Vercel                                                                            | Native Next.js, `iad1` region, 30s function timeout for /api routes                                              |
| Worker hosting     | Railway                                                                           | Long-lived processes; `npm run workers` runs the oracle + market-creator concurrently with auto-restart           |

---

## Repository layout

```
mimir/
├── app/
│   ├── [locale]/
│   │   ├── bridge/page.tsx               # CCTP V2 bridge stepper UI
│   │   ├── dashboard/                    # personal W/L view
│   │   ├── emerging-narratives/          # daily-curated challenge ideas
│   │   ├── explorer/                     # market discovery feed
│   │   ├── stats/page.tsx                # on-chain analytics
│   │   ├── vs/                           # claim detail + create flows
│   │   ├── messages/                     # XMTP inbox
│   │   ├── layout.tsx                    # i18n root layout
│   │   └── page.tsx                      # landing page
│   └── api/
│       ├── bridge/                       # CCTP bridge helpers
│       ├── challenge-opportunities/      # curated feed
│       ├── claim-draft/                  # LLM-assisted draft endpoint
│       ├── claim-moderation/             # safety filter
│       ├── cron/                         # Vercel cron tasks
│       ├── gateway/balances/             # Circle Gateway proxy
│       ├── network-status/               # Arc RPC health
│       └── vs/                           # feed, detail, sync routes
├── agents/
│   ├── oracle/index.ts                   # settler + Kelly auto-challenger
│   ├── market-creator/index.ts           # autonomous market author
│   └── council/                          # 10 AI personas as economic actors
│       ├── index.ts                      # worker entry, staggered + rate-limited
│       ├── personas.ts                   # 10 persona configs (bios, biases, accents)
│       └── shared/                       # runner, evidence cache, rule evaluators, persona-LLM
├── contracts/
│   └── Mimir.sol                         # the only contract; deployed on Arc
├── lib/
│   ├── arc.ts                            # chain config + viem clients
│   ├── cctp.ts                           # CCTP V2 addresses, ABIs, Iris poller
│   ├── circle-w3s.ts                     # W3S signer + transfer + tx polling
│   ├── contract.ts                       # high-level TypeScript contract client
│   ├── db.ts                             # Neon read-index
│   ├── llm.ts                            # model-routed LLM call
│   ├── mimir-abi.ts                      # generated ABI + state constants
│   ├── wagmi-config.ts                   # multi-chain wagmi config
│   ├── wallet.tsx                        # frontend wallet context
│   └── server/                           # server-only modules (DB writers, etc.)
├── components/
│   ├── GatewayBalanceWidget.tsx          # unified USDC balance widget
│   ├── Header.tsx, Footer.tsx, ...       # layout
│   └── ... ~80 product components
├── scripts/
│   ├── circle-entity-secret.ts           # one-time entity-secret bootstrap
│   ├── circle-create-wallets.ts          # provision oracle + creator wallets
│   ├── check-agent-balances.ts           # read on-chain balances
│   ├── check-claim.ts                    # inspect any claim
│   ├── deploy-mimir-w3s.ts               # compile + deploy via W3S-funded key
│   ├── smoke-test-w3s.ts                 # end-to-end W3S verification
│   ├── test-llm.ts                       # sanity check the LLM layer
│   ├── demo-full-cycle.ts                # full create→challenge→settle in 90s
│   ├── seed-claims.ts                    # bulk-seed demo markets
│   └── warm-vs-index.ts                  # rebuild Neon cache from on-chain
├── tests/node/                           # Node-native smoke tests (no jest)
├── messages/                             # next-intl translations
├── public/                               # static assets
├── vercel.json                           # Vercel deploy config
├── railway.json                          # Railway worker config
└── package.json
```

---

## Local setup

### Prerequisites

- Node.js 20+
- A Circle developer account at [console.circle.com](https://console.circle.com) for an **API Key** and a **Kit Key**
- At least one LLM API key configured in `.env.local`
- Optional: a Neon account at [console.neon.tech](https://console.neon.tech) for the read-index

### One-time bootstrap

```bash
git clone https://github.com/enliven17/mimir
cd mimir
npm install
cp .env.example .env.local
# Open .env.local and paste your CIRCLE_API_KEY + CIRCLE_KIT_KEY at minimum
```

### Provision the agent wallets

This is a sequence of small, idempotent scripts. Each one updates `.env.local` in-place when it succeeds, so re-running is safe.

```bash
# 1. Generate a 32-byte entity secret + an RSA-encrypted ciphertext.
#    Paste the printed ciphertext into Circle Console:
#    Wallets → Dev Controlled → Configurator → Register Entity Secret
npx tsx scripts/circle-entity-secret.ts

# 2. Create one wallet set and two developer-controlled wallets on Arc Testnet.
#    Writes CIRCLE_*_WALLET_ID and CIRCLE_*_ADDRESS to .env.local.
npx tsx scripts/circle-create-wallets.ts

# 3. Fund both new wallets with testnet USDC.
#    https://faucet.circle.com → pick "Arc Testnet" → request for each address.
npx tsx --env-file=.env.local scripts/check-agent-balances.ts
```

### Deploy the contract

```bash
npx tsx --env-file=.env.local scripts/deploy-mimir-w3s.ts
```

The script compiles `contracts/Mimir.sol` in-process (solc 0.8.28, `viaIR: true`), spins up a one-shot deploy key, funds it 2 USDC via W3S, deploys, immediately calls `transferOwnership(market_creator_address)`, writes `NEXT_PUBLIC_CONTRACT_ADDRESS` to `.env.local`, and exits.

### Run the app

```bash
npm run dev                    # http://localhost:3000
```

In a separate terminal, run the agents:

```bash
npm run workers                # oracle + market-creator, color-prefixed logs
# or individually:
npm run oracle                 # poll + settle
AUTO_CHALLENGE=1 npm run oracle  # also Kelly-stake on mispriced claims
npm run market-creator         # opens new markets every 6h
```

---

## End-to-end demo

There is a single script that exercises the full economic loop in ~90 seconds:

```bash
npx tsx --env-file=.env.local scripts/demo-full-cycle.ts
```

What it does:

```mermaid
flowchart TB
    A[market-creator W3S<br/>createClaim BTC > $100k<br/>2 USDC, 90s deadline] --> B[oracle W3S<br/>challengeClaim<br/>2 USDC counter-stake]
    B --> C{wait 95s}
    C --> D[oracle fetches CoinGecko<br/>BTC USD spot]
    D --> E[LLM layer evaluates evidence<br/>CHALLENGERS_WIN or CREATOR_WINS]
    E --> F[oracle W3S<br/>resolveClaim]
    F --> G[contract pays winning side<br/>balances reconcile on-chain]
```

The script prints the Arc explorer URL for every transaction so you can verify each step on chain.

---

## Production deploy (Vercel + Railway)

Mimir splits cleanly between a serverless frontend and long-running agent workers. This is intentional — Vercel functions time out before the oracle's poll cycle completes, and Railway is awkward for static Next.js. The two-platform split lets each piece run where it fits.

```mermaid
flowchart LR
    subgraph github[GitHub]
        REPO[main branch]
    end

    subgraph vercel[Vercel]
        FE[Next.js app + /api routes]
    end

    subgraph railway[Railway]
        WK[npm run workers<br/>oracle + market-creator<br/>auto-restart]
    end

    subgraph neon[Neon]
        DB[(Postgres pooler)]
    end

    subgraph arc[Arc Testnet]
        CT[Mimir.sol]
    end

    REPO -->|push| FE
    REPO -->|push| WK
    FE <-->|reads| DB
    WK -->|reads + writes| DB
    FE -->|RPC| CT
    WK -->|RPC + writes| CT
```

### Vercel — frontend

1. Import the repo at [vercel.com/new](https://vercel.com/new). Framework auto-detects as Next.js.
2. **Settings → Environment Variables**, add (at minimum):
   - `NEXT_PUBLIC_CONTRACT_ADDRESS`
   - `CIRCLE_API_KEY`, `CIRCLE_KIT_KEY`
   - `DATABASE_URL` (Neon pooler URL, optional)
   - `NEXT_PUBLIC_ARC_RPC` (optional override)
3. Push to `main`. Build takes ~60s. `vercel.json` pins the framework, `iad1` region, and bumps the API route `maxDuration` to 30s for the Iris-poll path.

### Railway — agent workers

1. New Project → Deploy from GitHub repo → pick this repo.
2. **Variables**, add everything Vercel has **plus**:
   - `CIRCLE_ENTITY_SECRET`, `CIRCLE_ORACLE_WALLET_ID`, `CIRCLE_ORACLE_ADDRESS`
   - `CIRCLE_CREATOR_WALLET_ID`, `CIRCLE_CREATOR_ADDRESS`
   - at least one LLM API key from `.env.example`
   - `AUTO_CHALLENGE=1` (optional - enables Kelly auto-staking)
3. `railway.json` selects the NIXPACKS builder and runs `npm run workers`, which boots both agents in parallel via `concurrently` and restarts on failure. Logs are prefixed `oracle:` and `creator:`.

### Neon Postgres (optional)

1. [console.neon.tech](https://console.neon.tech) → New Project (free tier).
2. Copy the **pooler** connection string — it already includes `?sslmode=require`.
3. Paste as `DATABASE_URL` into both Vercel and Railway.
4. The schema (`claims`, `challengers`, `sync_meta`, `challenge_opportunities`) auto-creates on the first query; no manual migration step.

Without `DATABASE_URL`, the app still boots and `/bridge`, `/stats`, `/vs/[id]`, `/vs/create`, and direct contract reads all work. Only `/explorer`, `/dashboard`, and `/api/challenge-opportunities` need the database.

---

## Configuration reference

Every env var lives in `.env.example`. Quick reference:

| Variable                          | Required by              | Notes                                                                              |
| --------------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONTRACT_ADDRESS`    | frontend + agents        | Set automatically by `scripts/deploy-mimir-w3s.ts`                                 |
| `NEXT_PUBLIC_ARC_RPC` / `ARC_RPC` | frontend / server reads  | Optional override; defaults to `https://rpc.testnet.arc.network`                   |
| `CIRCLE_API_KEY`                  | agents, deploy, bridge   | Circle Wallets + Contracts auth                                                    |
| `CIRCLE_KIT_KEY`                  | server-side App Kit      | Reserved for future bridge orchestration                                            |
| `CIRCLE_ENTITY_SECRET`            | agents                   | 32-byte hex, generated locally; never sent over the wire raw                       |
| `CIRCLE_WALLET_SET_ID`            | agents                   | Output of `circle-create-wallets.ts`                                               |
| `CIRCLE_ORACLE_WALLET_ID`         | oracle                   | Output of `circle-create-wallets.ts`                                               |
| `CIRCLE_ORACLE_ADDRESS`           | oracle, contract `oracle` | Output of `circle-create-wallets.ts`                                               |
| `CIRCLE_CREATOR_WALLET_ID`        | market-creator           | Output of `circle-create-wallets.ts`                                               |
| `CIRCLE_CREATOR_ADDRESS`          | market-creator, deploy   | Output of `circle-create-wallets.ts`                                               |
| LLM API keys                      | agents                   | At least one LLM API key; see `.env.example` for accepted variable names            |
| `LLM_PROVIDER`                    | optional                 | Optional model routing override for worker-only deployments                        |
| `ORACLE_LLM_MODEL`                | optional                 | Optional model name override                                                       |
| `ORACLE_LLM_THROTTLE_MS`          | oracle                   | Min delay between oracle LLM calls; default `8000`                                 |
| `ORACLE_SETTLEMENT_DELAY_MS`      | oracle                   | Delay between multiple expired settlements in one poll; default `900000` (15 min)  |
| `AUTO_CHALLENGE`                  | oracle (worker)          | `1` to enable Kelly auto-stake                                                     |
| `CHALLENGE_STAKE_USDC`            | oracle (worker)          | Min stake per auto-challenge (default 2)                                            |
| `CHALLENGE_CONFIDENCE`            | oracle (worker)          | Min LLM confidence % to auto-stake (default 80)                                    |
| `MAX_CLAIMS_PER_RUN`              | market-creator           | Max candidates created per run; creation is paced by `MARKET_CREATE_DELAY_MS`      |
| `MARKET_CREATE_DELAY_MS`          | market-creator           | Delay between opening approved markets; default `600000` (10 min)                 |
| `MARKET_CANCEL_DELAY_MS`          | market-creator           | Delay between stale-market cancels; default `60000` (1 min)                       |
| `MARKET_CREATOR_PREFLIGHT`        | market-creator           | `1` to force paid council preflight; also enabled when `MIMIR_BASE_URL` is set     |
| `MARKET_CREATOR_PREFLIGHT_*`      | market-creator           | Paid council preflight score, cap, persona list, and pacing controls              |
| `MIMIR_BASE_URL`                  | oracle, market-creator   | Public app URL for paid council vote/preflight endpoints                           |
| `DATABASE_URL`                    | optional (Neon)          | Read-index cache. Pages that need it fail gracefully if absent                     |
| `CRON_SECRET`                     | optional                 | Vercel cron shared secret                                                          |
| `NEXT_PUBLIC_FEATURE_XMTP`        | optional                 | Toggle the XMTP inbox feature                                                      |
| `CIRCLE_COUNCIL_<SLUG>_WALLET_ID` | council (worker)         | Per-persona W3S wallet ID; created by `npm run council:create-wallets`             |
| `CIRCLE_COUNCIL_<SLUG>_ADDRESS`   | council (worker, UI)     | Per-persona EVM address; used to label on-chain events with the right persona      |
| `COUNCIL_POLL_INTERVAL_MS`        | council (worker)         | Cycle interval (default 180_000 = 3 min)                                            |
| `COUNCIL_MAX_CLAIMS`              | council (worker)         | Max claims per cycle, deadline-sorted (default 1). Raise only with paid quota.     |
| `COUNCIL_DECISION_DELAY_MS`       | council (worker)         | Delay between persona decisions/stakes; default `30000`                            |
| `COUNCIL_LLM_THROTTLE_MS`         | council (worker)         | Min ms between LLM calls (default 8000)                                             |
| `COUNCIL_PEER_READS`              | council (worker)         | `1` lets personas buy other personas' reasoning over x402 before deciding          |
| `COUNCIL_PEER_READS_PER_PERSONA`  | council (worker)         | Peer reads bought before each persona decision; default `2`                         |
| `COUNCIL_PEER_READ_DELAY_MS`      | council (worker)         | Delay between peer-read nanopayments; default `15000`                               |
| `COUNCIL_PEER_READ_CAP_USDC`      | council (worker)         | Max accepted x402 quote per peer read; default `0.003` USDC                         |
| `COUNCIL_SETTLEMENT`              | oracle                   | `1` settles by council tally instead of the solo oracle verdict                     |
| `COUNCIL_QUORUM`                  | oracle                   | Min decisive juror votes before the council verdict is used; default `3`            |
| `COUNCIL_VOTE_CAP_USDC`           | oracle                   | Max accepted x402 quote per settlement vote; default `0.005`                        |
| `COUNCIL_SELF_RESOLVING`          | oracle                   | `1` enables the sequential self-resolving jury (requires `COUNCIL_SETTLEMENT=1`)    |
| `COUNCIL_ALPHA`                   | oracle                   | Per-vote random-termination probability once quorum is met; default `0.25`          |
| `COUNCIL_BONUS_USDC`              | oracle                   | Cross-entropy bonus pool split by positive-scoring jurors; default `0.01`           |

---

## Scripts

| Command                                      | What it does                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`                                | Next.js dev server                                                                 |
| `npm run build` / `npm start`                | Production build / serve                                                           |
| `npm run workers`                            | Run **all three** agent workers in parallel (Railway entry point: oracle + market-creator + council) |
| `npm run oracle`                             | Run only the oracle (settler; optionally `AUTO_CHALLENGE=1`)                       |
| `npm run market-creator`                     | Run only the market-creator                                                        |
| `npm run council`                            | Run only the 10-persona Mimir Council worker                                       |
| `npm run council:create-wallets`             | One-time provisioning of the 10 W3S persona wallets                                |
| `npm run test:smoke`                         | Node-native smoke tests (API validation, XMTP, db-index, etc.)                     |
| `npm run warm:vs-index`                      | Rebuild the Neon read-index from current on-chain state                            |
| `npm run seed` / `npm run seed:dry`          | Seed demo claims (live / dry-run)                                                  |
| `npx tsx scripts/circle-entity-secret.ts`    | One-time W3S entity-secret bootstrap                                               |
| `npx tsx scripts/circle-create-wallets.ts`   | Create oracle + market-creator W3S wallets                                         |
| `npx tsx scripts/deploy-mimir-w3s.ts`        | Compile + deploy `Mimir.sol` via a W3S-funded ephemeral key                        |
| `npx tsx scripts/demo-full-cycle.ts`         | Full create → challenge → settle demo in ~90s                                      |
| `npx tsx scripts/smoke-test-w3s.ts`          | End-to-end W3S verification (no LLM key required)                                  |
| `npx tsx scripts/test-llm.ts`                | Sanity-check whichever LLM layer is configured                                     |
| `npx tsx scripts/check-claim.ts <id>`        | Print a claim's state and deadline                                                 |
| `npx tsx scripts/check-agent-balances.ts`    | Print oracle + market-creator balances                                             |

---

## Game modes roadmap

Mimir currently ships with the core claim-market primitive: a creator stakes one side, challengers stake the counter-side, and settlement pays the winning side from the funded pot. The next product layer should make that economic shape legible as different "game modes" instead of one generic staking form. The contract already supports `oddsMode` (`pool` or `fixed`), `maxChallengers`, challenger stake sizing, rematches, and private invite links, so several modes can be introduced mostly as UI/product policy before requiring deeper contract changes.

### 1. Pool Market

**Status:** live primitive, needs stronger UI education.

Pool Market is the current pari-mutuel mode. The creator's stake forms one side of the pool; all challengers share the creator stake proportionally if the challenger side wins. If the creator wins, the creator receives their own stake plus all challenger stakes.

Example:

```text
Creator stakes YES: 10 USDC
10 challengers stake NO: 10 USDC each
Total challenger side: 100 USDC
Total pot: 110 USDC

If NO wins:
Each challenger receives 10 + (10 / 100 * 10) = 11 USDC
Each challenger's net profit: 1 USDC

If YES wins:
Creator receives 110 USDC
Creator net profit: 100 USDC
```

Why it matters:

- Rewards contrarian conviction. A small, correct side can win a large pot.
- Naturally prices crowd consensus. Joining an already-crowded side lowers expected upside.
- Works well for public markets with many participants.

Product work:

- Keep the payout preview visible before a user stakes: total return, net profit, and where the profit comes from.
- Show side-level pool imbalance clearly: creator stake, total challenger stake, total pot.
- Warn users when they are joining a crowded side with low upside.
- Add educational copy in `/vs/[id]` and `/docs` that explains "your profit comes from the losing side, not from Mimir."

Risks:

- Casual users may dislike staking 10 USDC to win only 1 USDC when joining a crowded side.
- The creator can appear to have huge upside against many challengers, which is fair mathematically but needs clear framing.
- UI must distinguish total payout from net profit at every step.

### 2. Duel / 1v1 Fixed Challenge

**Status:** recommended near-term mode.

Duel is the simplest social format: one creator, one challenger, matched stake, winner takes the two-person pot. This is the cleanest mental model for "I challenge you."

Default rules:

```text
Creator stakes 10 USDC
Challenger stakes 10 USDC
Winner receives 20 USDC
Net profit: 10 USDC
Draw / unresolvable: both refunded
```

Why it matters:

- Extremely easy to understand.
- Best fit for private links, friend challenges, social sharing, and XMTP conversations.
- Avoids the "why did I only win 1 USDC?" problem from crowded pool markets.

Product work:

- Add a mode selector on create: `Duel` vs `Pool Market`.
- For Duel, lock `maxChallengers = 1`.
- Default challenger stake to creator stake.
- Label the CTA as `Accept Duel` instead of generic `Join`.
- On the detail page, use 1v1 language: creator, rival, winner takes pot.

Contract notes:

- Existing `maxChallengers = 1` plus pool mode already approximates this if stake sizes match.
- A stricter version should enforce equal stake for the challenger or use fixed odds with sufficient creator liquidity.

Risks:

- Less market-like liquidity; only one person can take the other side.
- Needs rematch flow to keep engagement after a single settlement.

### 3. Creator-Backed Fixed Odds

**Status:** partially supported by contract, needs product constraints.

Fixed odds lets the creator define a guaranteed challenger return multiple, backed by creator liquidity. Example: a 2x challenger payout means a winning challenger who stakes 10 USDC receives 20 USDC total. The creator must have enough unreserved stake to cover challenger profit.

Example:

```text
Creator deposits liquidity: 100 USDC
Fixed odds: 2.00x
Challenger stakes: 10 USDC

If challenger wins:
Challenger receives 20 USDC total
10 USDC is their returned stake
10 USDC profit comes from creator liquidity

If creator wins:
Creator keeps the challenger stake
```

Why it matters:

- Predictable payout before joining.
- Good for creators who want to "make a market" with a clear price.
- Cleaner than pool mode for users who expect sportsbook-like odds.

Product work:

- Show available creator liquidity and remaining liability.
- Prevent or clearly disable stake amounts that exceed available creator backing.
- Explain total return multiple vs net profit.
- Let creator choose from simple presets: 1.25x, 1.5x, 2x, 3x.

Contract notes:

- `Mimir.sol` already tracks `reservedCreatorLiability`.
- `challengeClaim` checks creator liquidity before accepting a fixed-odds challenge.
- UI should mirror that calculation before a transaction is submitted.

Risks:

- Creator liquidity can fragment across many small challengers.
- Users may confuse "2x payout" with "2x profit"; UI must say "total return."

### 4. Underdog Boost

**Status:** future product layer, likely no contract change at first.

Underdog Boost is a discovery and incentive layer for the less-funded side. The economics can remain pool-based, but the UI highlights markets where the minority side has large upside.

Example signals:

```text
YES pool: 10 USDC
NO pool: 100 USDC
Joining YES has high upside if YES wins.
Joining NO has low upside but follows consensus.
```

Why it matters:

- Makes contrarian opportunities obvious.
- Turns pool imbalance into a game mechanic.
- Helps users understand why unpopular-but-correct predictions are valuable.

Product work:

- Add an `Underdog` badge in `/explorer`.
- Sort or filter by upside multiple.
- Show "minority side" and "crowded side" labels.
- Add an "edge" explanation in the stake preview.

Possible future mechanics:

- Fee discount for joining the underdog side if protocol fees are introduced.
- Leaderboard points for winning from the minority side.
- Agent commentary explaining why a side is underpriced.

Risks:

- The product should not imply the underdog is more likely to win.
- Badges must describe payout asymmetry, not prediction quality.

### 5. Squad vs Squad

**Status:** medium-term product mode.

Squad vs Squad makes both sides feel like teams. Instead of "creator vs challengers," users choose or join `YES` or `NO`, and both sides can have many participants. Settlement pays the winning squad proportionally.

Why it matters:

- More social than a single creator defending against everyone.
- Better for culture, sports, and community-driven claims.
- Lets users rally around a side without feeling like they are merely "challenging" the creator.

Product work:

- Reframe positions as `Side A` and `Side B`.
- Show participant count and total stake for both sides.
- Add squad avatars or stacked wallet peeps.
- Use copy like `Back YES` / `Back NO` instead of `Challenge`.

Contract notes:

- Current contract has one creator side and many challenger-side participants.
- True two-sided squad deposits would require contract changes so multiple wallets can add to creator side too.
- A first version can be approximated by treating creator as captain of side A and all challengers as side B.

Risks:

- Real two-sided deposits need careful accounting for proportional payouts on both sides.
- The current "creator" role may feel too privileged unless the UI explains it.

### 6. Streak Mode

**Status:** future engagement layer, can start off-chain.

Streak Mode rewards users for consecutive correct outcomes. The reward can begin as non-financial status (badges, leaderboard position, profile stats) before any token or payout mechanic is considered.

Why it matters:

- Gives users a reason to return after settlement.
- Makes small bets feel meaningful.
- Creates identity around forecasting skill rather than only money won.

Product work:

- Add profile stats: current streak, best streak, total resolved, win rate.
- Add streak badges in `/dashboard` and `/agents`/feed rows.
- Add claim cards that show "streak at risk" for the connected wallet.

Possible future mechanics:

- Streak-gated private markets.
- Streak leaderboards by category.
- Agent personas with their own visible streaks.

Risks:

- Streaks can encourage reckless betting if overemphasized.
- Need clear handling for draws/refunds: recommended behavior is streak unchanged.

### 7. Rematch Ladder

**Status:** partially supported through `parentId` / rivalry chain.

Rematch Ladder turns a settled claim into a series. After a result, either side can create the next round with inherited question metadata and a new deadline/stake.

Why it matters:

- Keeps social duels alive after one outcome.
- Works especially well for sports series, recurring price targets, and narrative disputes.
- Builds a visible history around rivalry rather than isolated claims.

Product work:

- Make the rivalry chain more prominent on resolved VS pages.
- Add `Best of 3`, `Best of 5`, and `Run it back` flows.
- Show series score: creator side wins vs challenger side wins.
- Let rematch creators adjust stake and deadline while inheriting source/rules.

Contract notes:

- `createRematch` already inherits core fields from a parent claim.
- Series scoring can be computed from the chain of parent/child claims in the read-index.

Risks:

- If the original settlement rule was weak, rematches inherit weak metadata.
- UI should encourage tightening rules before launching the next round.

### 8. Conviction Mode

**Status:** future scoring layer.

Conviction Mode scores not only whether a user was right, but how early and how strongly they backed a side. This is especially useful when monetary payout is small but forecasting quality is high.

Why it matters:

- Rewards early signal, not just late pile-ons.
- Gives agents and humans a comparable skill metric.
- Helps surface credible forecasters in the ecosystem.

Possible score inputs:

```text
Conviction score =
  outcome correctness
  * stake size factor
  * time-before-deadline factor
  * underdog factor
  * confidence / evidence quality factor
```

Product work:

- Add per-market "early backer" markers.
- Add leaderboard columns for realized PnL, win rate, and conviction score.
- Show agent conviction separately from human conviction.
- Let users filter markets by "high disagreement" or "early signal."

Risks:

- Any score can be gamed; keep it transparent and secondary to actual payouts.
- Stake-size weighting should not simply make the richest wallet the highest-ranked forecaster.

### Recommended rollout order

1. **Improve Pool Market legibility** - done in the VS stake preview, continue in explorer cards and docs.
2. **Ship Duel mode** - highest clarity, lowest conceptual risk.
3. **Harden Fixed Odds UI** - expose creator liquidity, reserved liability, and total return copy.
4. **Add Underdog discovery** - badges, sorting, and upside previews.
5. **Expand Rematch Ladder** - use existing `parentId` to build social loops.
6. **Prototype Streak and Conviction scoring** - start as read-index/profile features before contract changes.
7. **Design true Squad vs Squad** - requires deeper contract accounting if both sides accept many deposits.

---

## Design principles

These show up in PR review and shape what we accept:

1. **Contract state is source of truth.** The Postgres read-index is a cache. If the two disagree, the chain wins; warm the cache from chain, never the other way.
2. **Agents own no local keys.** Everything that signs goes through W3S. Adding a new agent flow? Reuse `executeContract(...)`; don't reach for `privateKeyToAccount` outside of one-shot deploy bootstraps.
3. **Trust through process, not branding.** The settlement receipt shows the source, the evidence hash, the verdict, and the confidence. If a market can't be settled cleanly, it refunds — the protocol never fabricates certainty.
4. **Narrow claims over expressive chaos.** The market-creator agent uses a 70/100 quality floor and a per-run cap so the surface stays sparse and actionable, not a firehose.
5. **Legibility over magic.** Every async path that takes more than ~5s (LLM call, Iris poll, contract receipt) surfaces progress in the UI or the worker logs.
6. **Refund the ambiguous.** `DRAW` and `UNRESOLVABLE` are first-class verdicts that return stakes. Better to be inconclusive and refund than to be wrong and pay out.

---

## License

AGPL-3.0 — see [`LICENSE`](./LICENSE).

Mimir is source-available. You can use, study, modify, and share it freely.
The catch (the *A* in AGPL): if you run a modified version as a hosted
service, you must publish your changes under the same license. That keeps
oracle-side modifications visible to users staking USDC against the agent.
