# XMTP Integration — Mimir

**Status:** Steps 1–7 complete — live reference for the XMTP integration.
**Docs index:** `https://docs.xmtp.org/llms.txt` (re-check before implementing new API calls; the SDK evolves).

---

## 1. Package and upstream repository

| Field | Value |
|-------|-------|
| **npm package** | `@xmtp/browser-sdk` |
| **Stable version** | `7.0.0` |
| **Description** | XMTP client SDK for browsers written in TypeScript |
| **Source** | [github.com/xmtp/xmtp-js](https://github.com/xmtp/xmtp-js) (tree `sdks/browser-sdk`) |

> Before `npm install`, run `npm view @xmtp/browser-sdk version` to check for patch bumps. Always verify method signatures against that version's docs, not static memory.

---

## 2. Topic → official docs table (llms.txt)

Base URL: `https://docs.xmtp.org`

| Topic | Path (relative) | Usage in Mimir |
|-------|-----------------|----------------|
| Browser SDK (entry) | `/chat-apps/sdks/browser` | Installation, quickstart, browser overview |
| Create signer | `/chat-apps/core-messaging/create-a-signer` | Connect `window.ethereum` → `Signer` (EOA) |
| Create client | `/chat-apps/core-messaging/create-a-client` | `Client.create` / init after wallet connected |
| Create conversations | `/chat-apps/core-messaging/create-conversations` | 1:1 DM with the other side of a claim |
| Send messages | `/chat-apps/core-messaging/send-messages` | Chat input in claim detail panel |
| List conversations | `/chat-apps/list-stream-sync/list` | Messages hub |
| List messages | `/chat-apps/list-stream-sync/list-messages` | Active thread history |
| Stream | `/chat-apps/list-stream-sync/stream` | Real-time messages / conversations |
| Sync / SyncAll | `/chat-apps/list-stream-sync/sync-and-syncall` | On panel open or tab focus |
| History sync | `/chat-apps/list-stream-sync/history-sync` | Optional (multi-device) |
| Consent (concept) | `/chat-apps/user-consent/user-consent` | Spam / preference model |
| Consent (implement) | `/chat-apps/user-consent/support-user-consent` | Consent methods in UI |
| Rate limits | `/chat-apps/core-messaging/rate-limits` | Errors and backoff in production |
| User signatures | `/protocol/signatures` | What signatures the wallet will request |
| Identity / inboxes | `/chat-apps/core-messaging/manage-inboxes` | Inbox ID, installations (advanced debug) |
| Wallet signature payloads | `/chat-apps/use-signatures` | Sign / verify payloads if extended |

**Useful but non-blocking for MVP**
- `/chat-apps/content-types/content-types` — content types (text first).
- `/chat-apps/debug/debug-your-app` — debugging.
- `/fund-agents-apps/*` — Gateway / fees; revisit only if required on testnet/mainnet.

---

## 3. Mimir project inventory

### 3.1 Wallet (signer integration point)

| File | Role |
|------|------|
| [`app/layout.tsx`](../app/layout.tsx) | `WalletProvider` wraps `{children}` + Toaster; the entire app tree has wallet context. |
| [`lib/wallet.tsx`](../lib/wallet.tsx) | Context: `address`, `isConnected`, `connect`, `disconnect`, `error`; uses `window.ethereum`, `eth_requestAccounts`, `ensureArcChain` (Arc). |

**XMTP implication:** The `Signer` EOA must use the same EIP-1193 provider and address exposed by `useWallet()`. The XMTP signature is implemented in `lib/xmtp/` and imported only from client components.

### 3.2 Framework constraints

- **Next.js 14** App Router: the SDK must **not** be imported in Server Components.
- **i18n:** `next-intl` in [`app/[locale]/layout.tsx`](../app/[locale]/layout.tsx); chat strings in `messages/en.json`.

### 3.3 Folder structure (XMTP)

```
lib/xmtp/
  config.ts               # public env, feature flag, options for Client.create
  signer.ts               # EOA Signer + personal_sign (client-only)
  XmtpProvider.tsx        # React context: Client.create / close / states
  vs-chat-eligibility.ts  # 1v1 accepted rules + peer resolution (no SDK)
  optimistic-send.ts      # remote + pending message merge (Step 7)
  index.ts                # safe barrel: re-exports config only
components/xmtp/
  VsXmtpPanel.tsx         # DM panel + messages + stream + optimistic send (Steps 5–7)
  MessagesHub.tsx         # /messages hub: list claims with active XMTP chat
```

Import **`XmtpProvider` and `useXmtp`** from `@/lib/xmtp/XmtpProvider` (not from `index.ts`) to avoid accidentally loading the SDK in Server Components.

---

## 4. Product decisions (agreed MVP)

| Question | Decision |
|----------|----------|
| Where does chat live in MVP? | **Panel on the claim detail page** `/vs/[id]` (no global inbox in header for first delivery). |
| Who can use chat? | User with **connected wallet** whose address matches **`creator` or `opponent`** of the claim. |
| In which claim state? | Only when the claim is **`accepted`** (opponent != `ZERO_ADDRESS`). |
| Sample VS (negative IDs)? | **No** XMTP conversations; show i18n message "available on real claims" or hide panel. |
| DM vs group? | **1:1 DM** between the two addresses of the claim. |
| Feature flag | `NEXT_PUBLIC_FEATURE_XMTP` for gradual rollout. |

---

## 5. Step 1 — Done ✓

- [x] Official index (`llms.txt`) consulted, route table documented.
- [x] `@xmtp/browser-sdk` version recorded.
- [x] Wallet and layout inventory updated.
- [x] Product decisions written.
- [x] Folder structure proposed.

## 6. Step 2 — Done ✓

| Deliverable | Location |
|-------------|----------|
| npm dependency | `@xmtp/browser-sdk` in `package.json` |
| Documented env vars | [`.env.example`](../.env.example) — `NEXT_PUBLIC_XMTP_ENV`, `NEXT_PUBLIC_FEATURE_XMTP`, `NEXT_PUBLIC_XMTP_APP_VERSION` |
| Typed client options | [`lib/xmtp/config.ts`](../lib/xmtp/config.ts) → `getXmtpClientCreateOptions()` |
| Barrel | [`lib/xmtp/index.ts`](../lib/xmtp/index.ts) |

**Rules:** Do not import `@xmtp/browser-sdk` in Server Components. SDK only in modules under `"use client"`.

## 7. Step 3 — Done ✓

| Deliverable | Location |
|-------------|----------|
| EOA Signer + `personal_sign` | [`lib/xmtp/signer.ts`](../lib/xmtp/signer.ts) — `createXmtpSignerFromEthereum(provider, address)` |
| Typed errors | `XmtpSignerError` (`rejected`, `invalid_address`, `invalid_signature`, `unknown`) |
| Test utilities | `utf8MessageToHexData`, `hexSignatureToUint8Array` |

**Technical details**
- `Signer` interface from `@xmtp/browser-sdk@7`: `type: "EOA"`, `getIdentifier`, `signMessage` → `Uint8Array`.
- Identifier: `IdentifierKind.Ethereum`, address in **lowercase**.
- Signature: `personal_sign` with UTF-8 message passed as hex DATA (`0x` + bytes), signature converted to bytes.

## 8. Step 4 — Done ✓

| Deliverable | Location |
|-------------|----------|
| React context + lifecycle | [`lib/xmtp/XmtpProvider.tsx`](../lib/xmtp/XmtpProvider.tsx) |
| Hook | `useXmtp()` → `{ client, status, error, activeAddress, featureEnabled, retry }` |
| Mount | [`app/layout.tsx`](../app/layout.tsx): `WalletProvider` → **`XmtpProvider`** → `{children}` |

**Status values**

| `status` | Meaning |
|----------|---------|
| `disabled` | `NEXT_PUBLIC_FEATURE_XMTP` not active → `Client.create` not called. |
| `idle` | Feature active but no wallet connected. |
| `initializing` | `Client.create` in progress (may prompt signature to register XMTP inbox). |
| `ready` | `client` ready for `conversations`, streams, etc. |
| `error` | Init failed; `retry()` increments a trigger to retry. |

## 9. Step 5 — Done ✓

| Deliverable | Location |
|-------------|----------|
| 1v1 business rules | [`lib/xmtp/vs-chat-eligibility.ts`](../lib/xmtp/vs-chat-eligibility.ts) — `canOpenVsXmtpChat`, `getVsXmtpPeerAddress` |
| UI + DM + messages + stream | [`components/xmtp/VsXmtpPanel.tsx`](../components/xmtp/VsXmtpPanel.tsx) |
| Integration | [`app/[locale]/vs/[id]/page.tsx`](../app/[locale]/vs/[id]/page.tsx) |
| i18n | `messages/en.json` → namespace **`xmtpVs`** |

**Product rules**
- Chat only if `vs.state === "accepted"`, `opponent !== ZERO`, **`getVSChallengerCount(vs) === 1`** (no multi-challenger).
- Peer: the other address (case-insensitive) relative to the connected wallet.
- **`NEXT_PUBLIC_FEATURE_XMTP`:** panel not rendered if off.

**Technical flow (SDK v7)**
1. `conversations.sync()` → `fetchDmByIdentifier` → if absent, `Client.canMessage` → `createDmWithIdentifier`.
2. `conversation.sync()` → `messages({ limit: 40 })` ordered by `sentAt`.
3. `conversation.stream({ onValue })` for new messages; cleanup: `stream.end()`.

## 10. Step 6 — Done ✓

| Deliverable | Location |
|-------------|----------|
| Client instance type | [`lib/xmtp/types.ts`](../lib/xmtp/types.ts) — `XmtpClientInstance` |
| Thread logic | [`lib/xmtp/chat-thread.ts`](../lib/xmtp/chat-thread.ts) — `ensureVsDmThread`, `loadThreadMessages`, `classifyXmtpThreadError` |
| Lifecycle hook | [`hooks/useVsXmtpThread.ts`](../hooks/useVsXmtpThread.ts) |
| UI | [`components/xmtp/VsXmtpPanel.tsx`](../components/xmtp/VsXmtpPanel.tsx) — Refresh button |

**Behavior**
- **Global sync:** `conversations.syncAll([ConsentState.Allowed])` on thread open and manual refresh.
- **Consent:** if DM exists with `consentState === Unknown`, call `updateConsentState(Allowed)` before `conversation.sync()`.
- **Errors:** `classifyXmtpThreadError` distinguishes `peer_unreachable`, `rate_limit`, `network`, `unknown`.
- **Tab focus refresh:** `visibilitychange` (hidden → visible only) with ~4s throttle.
- **Retry after thread error:** `retryOpenThread` (nonce) restarts thread opening.

## 11. Messages hub (navbar)

| Deliverable | Location |
|-------------|----------|
| Route | [`app/[locale]/messages/page.tsx`](../app/[locale]/messages/page.tsx) |
| UI | [`components/xmtp/MessagesHub.tsx`](../components/xmtp/MessagesHub.tsx) |
| Nav | [`components/Header.tsx`](../components/Header.tsx) — **Messages** chip, shown only if `NEXT_PUBLIC_FEATURE_XMTP` is active |

**Rules**
- **No claims** for user: empty state with CTA to Explore / Challenge.
- **Claims but none XMTP-eligible** (not accepted 1v1, multi-challenger, etc.): notice + list with i18n reason.
- **Active chats:** links to `/vs/[id]#mimir-xmtp-vs-chat` for claims passing `canOpenVsXmtpChat`.

## 12. Step 7 — Done ✓ (optimistic send)

| Deliverable | Location |
|-------------|----------|
| Remote + pending message merge | [`lib/xmtp/optimistic-send.ts`](../lib/xmtp/optimistic-send.ts) — `mergeThreadDisplayRows`, `OptimisticPendingMessage` |
| Panel | [`components/xmtp/VsXmtpPanel.tsx`](../components/xmtp/VsXmtpPanel.tsx) — draft cleared on send, `sendText(text, true)`, dedup by `serverMessageId` vs stream |

**Behavior**
- Message bubble appears instantly; SDK sends with `isOptimistic: true`.
- After `sendText`, the returned ID is saved; when the thread stream receives the same `DecodedMessage.id`, the pending row is removed (no duplicate).
- Send failure: pending row removed, error shown below input.

---

## 13. Environment variables

| Variable | Role |
|----------|------|
| `NEXT_PUBLIC_XMTP_ENV` | Network: `local` \| `dev` \| `production` (default: `dev`). |
| `NEXT_PUBLIC_FEATURE_XMTP` | If not `1`, `true`, or `yes` — provider skips `Client.create` and panel shows nothing. |
| `NEXT_PUBLIC_XMTP_APP_VERSION` | String like `mimir/1.0.0` for XMTP client telemetry. |

Recommended values for local development:
```bash
NEXT_PUBLIC_XMTP_ENV=dev
NEXT_PUBLIC_FEATURE_XMTP=1
NEXT_PUBLIC_XMTP_APP_VERSION=mimir/0.1
```

After editing `.env.local`, restart the dev server (`npm run dev`).

---

## 14. Quick references

- Docs index: <https://docs.xmtp.org/llms.txt>
- Browser SDK: <https://docs.xmtp.org/chat-apps/sdks/browser>
