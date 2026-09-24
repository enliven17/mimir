# Mainnet cutover

Moving Mimir from Arc Testnet to Arc mainnet, and from the fee-less v2 escrow to
`MimirV3`.

The order below is the one that stays reversible for as long as possible. The
step that stops being reversible is the first mainnet `createClaim`: after that,
somebody's real USDC is in the contract and the address cannot be swapped
without stranding it.

## Principle

**Never reinterpret an old escrow.** A new deployment is a clean state with its
own claim ids, its own read index and its own deploy block. The previous
contract keeps its history at its own address; it is linked, not migrated.
Copying rows from one index into the other would produce a feed where claim #7
means two different things depending on when it was written.

---

## 0. Decide the fee recipient

`PLATFORM_FEE_RECIPIENT` must **not** be an address that also creates or takes
positions. The contract waives a fee leg whose recipient is the winner ("nobody
pays themselves"), so pointing the platform fee at the market-creator agent
means the platform leg silently collects nothing whenever that agent wins.

This is the current state on testnet: the recipient is the market-creator's own
W3S address, and the platform leg has never accrued.

Pick a treasury address that does nothing else. Changing it later is possible
but slow: `queueFeePolicy` then `executeFeePolicy` after the two-day timelock.

## 1. Prerequisites

- [ ] Treasury address chosen and funded with nothing (it only receives).
- [ ] W3S wallets provisioned on mainnet: oracle, market-creator, and each
      council persona that will run. `npm run council:create-wallets`.
- [ ] Every agent wallet funded with real USDC. Budget the market creator for
      `MAX_CLAIMS_PER_RUN × CREATOR_STAKE_USDC` per run, plus gas.
- [ ] `npm run test:contract` green, including the fuzzed fee invariant.
- [ ] An independent audit of `MimirV3.sol`. The forge suite is repo evidence,
      not an audit, and this is the point where that distinction starts costing
      real money.
- [ ] A multisig to own the contract (`MIMIR_V3_OWNER`). The owner can queue an
      oracle change (2-day timelock), pause new positions, and is the arbiter
      for disputed verdicts (`resolveDispute`), so it must not be the
      market-creator hot wallet that also trades.
- [ ] A dispute window (`V3_DISPUTE_WINDOW_SECONDS`, default 24h). The oracle
      only proposes a verdict; participants can dispute it with a MIN_STAKE
      bond, and the oracle worker finalizes undisputed ones when the window
      closes. Someone must watch for `ResolutionDisputed` events and rule.

## 2. Deploy

```bash
# Point the deploy at mainnet, then:
V3_PLATFORM_FEE_BPS=50 V3_AGENT_OWNER_FEE_BPS=50 \
PLATFORM_FEE_RECIPIENT=0x<treasury> \
MIMIR_V3_OWNER=0x<multisig> \
npm run deploy:v3
```

The script refuses to run twice against a populated
`NEXT_PUBLIC_V3_CONTRACT_ADDRESS`, verifies the deployed runtime bytecode
against the local artifact, starts the two-step ownership transfer to the
multisig (which then calls `acceptOwnership()`), and reads the live fee policy
back rather than trusting the constructor arguments.

Record: contract address, deploy block, deploy tx, the runtime bytecode hash,
and the fee policy as read back from the chain.

## 3. Verify on chain before anyone else can

```bash
npm run smoke:v3
```

Opens a market, challenges it, settles it, and checks that the winner received
gross minus exactly the policy fee and that the fee is claimable. It costs two
stakes. Run it before the workers are pointed at the new address, so the first
market on mainnet is one you control.

## 4. Cut the app over

All four together, or none:

| Variable | New value |
| --- | --- |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | the v3 address |
| `NEXT_PUBLIC_DEPLOY_BLOCK` | the v3 deploy block |
| `NEXT_PUBLIC_LEGACY_CONTRACT_ADDRESS` | the previous address |
| `NEXT_PUBLIC_LEGACY_DEPLOY_BLOCK` | the previous deploy block |

Then rebuild the read index from the new deploy block:

```bash
npm run warm:vs-index
```

A stale index against a new contract is the failure that looks like data
corruption: claim ids collide and the feed shows the wrong questions against the
right pots.

## 5. Start the workers paused

Bring the worker tier up with the money-moving capabilities off, confirm
heartbeats, then enable them one at a time:

```bash
MIMIR_PAUSE_CREATE_MARKET=1 MIMIR_PAUSE_STAKE=1 npm run workers
```

- [ ] `GET /api/health` reports every worker as `ok`.
- [ ] `GET /api/live` returns 200.
- [ ] Unpause `create_market`. Watch one market-creator run end to end.
- [ ] Unpause `stake`. Watch one council cycle.
- [ ] Leave `copy_execution` paused until a follower has actually granted a
      permission and their execution agent has been dry-run.

## 6. What stays off at launch

| Surface | Flag | Why |
| --- | --- | --- |
| Funded BYOA actions | absent from the API | The agent API exposes registration and reads only; funded actions ship after the contract is audited. |
| Copy trading | `MIMIR_FEATURE_COPY_TRADING` | The policy layer is complete and tested; execution has not run against real money. |
| Live-market sourcing | `MARKET_CREATOR_POLYMARKET` | Verified against recorded payloads, never against the live API. Enable it, watch one run, then leave it on. |

## 7. Rollback

Within the window where no real money has entered the new contract: revert the
four environment variables, rebuild the index, done.

After that, there is no rollback, only a stop. Pause `create_market` and `stake`
so no new positions open (the owner can also call `setPaused(true)` on the
contract, which stops direct callers too), let the open ones settle on their
own deadlines, and leave `withdraw` and the read paths alone. If the oracle
itself is gone, any ACTIVE claim becomes refundable by anyone through
`refundExpired(id)` seven days after its deadline. They are deliberately not pausable
for exactly this case: whatever else is wrong, people must be able to see their
positions and take their money out.

**Never** mutate financial state to undo a deploy. A contract that has taken
deposits is finished taking decisions from us.
