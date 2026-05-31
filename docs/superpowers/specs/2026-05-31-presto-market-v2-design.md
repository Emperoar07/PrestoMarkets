# PrestoMarket V2 — optimistic, self-terminating markets — design

**Date:** 2026-05-31
**Status:** Approved (design), pending spec review
**Owner:** Presto Markets

## Problem

V1 markets give the named `resolver` unilateral, unconstrained `resolve(outcome)`
power once the market closes. Because the factory is permissionless and the
resolver is caller-chosen, a creator can name themselves resolver, attract bets,
then settle to their own side and drain the parimutuel pool. V1 markets can also
get stuck Active forever if the resolver never acts (funds locked), and
`refund()` reverts with a mislabeled `NotResolved` error. We shipped a UI trust
*badge* (V1) but the contract-level risk remains.

## Goal

A V2 redeploy where:

1. **The resolver can never move funds to a wrong outcome.** Resolution is
   *optimistic*: the resolver only *proposes*; a challenge can only *void to
   refund*; nobody adjudicates. Worst case is everyone is refunded.
2. **No market can lock funds forever** — an unproposed market self-cancels
   (apoptosis) after a deadline; anyone can trigger it.
3. **Operability**: emergency pause and pre-close cancel for bad/erroneous
   markets.
4. Correct error naming.

## Decisions (from `/adhd` + brainstorming)

- **Scope:** optimistic settlement + apoptosis timeout + pause + pre-close
  cancel + error rename. **No bonds. No on-chain oracle.** (Both are documented
  follow-ups.)
- **No trusted arbiter.** A challenge is a trustless veto: it cancels the market
  and refunds everyone. Nobody rules on "who is right."
- **One contract, 2–12 outcomes.** V2 collapses V1's binary + multi-outcome
  contracts into a single parimutuel market.
- **Coexist with V1.** New V2 factory; the app keeps reading/trading/claiming
  existing V1 markets. The agent creates all new markets on the V2 factory.

## Non-goals

- No proposer/challenger bonds or slashing (deferred — needs the agent to manage
  bond capital across many markets).
- No on-chain price-oracle resolution (deferred — Arc has Pyth/Chainlink/etc.;
  price markets keep using the off-chain deterministic resolver for now).
- No change to the parimutuel model (1 USDC = 1 share, winners split the pot).
- No migration of V1 markets; they play out under V1 rules.

## Contract: `PrestoMarketV2`

Parimutuel fixed-share USDC market, 2–12 outcomes, `ReentrancyGuard`, `SafeERC20`,
Solidity ^0.8.24, OpenZeppelin. Mirrors V1 storage (immutables: collateral,
creator, resolver, feeRecipient, closeTime, protocolFeeBps, marketKind,
outcomeCount, metadataURI) plus the V2 fields below.

### State machine

```
enum State { Open, Proposed, Resolved, Canceled }
```

There is no separate `Closed` state: "closed" simply means
`state == Open && block.timestamp >= closeTime` (buys revert past `closeTime`).
The market stays `Open` until a proposal, cancel, or apoptosis transitions it.

- **Open & past close** → `propose(outcome, uri)` → **Proposed**
- **Proposed** → `challenge()` → **Canceled** (refund all)
- **Proposed** → `finalize()` after the window → **Resolved** (winners claim)
- **Open & past `resolutionDeadline`** → `apoptosis()` → **Canceled**
- **Open** (before or after close) → `cancel()` (creator/guardian) → **Canceled**

### New fields

- `uint64 challengeWindow` (immutable, set by factory; default 24h)
- `uint64 resolutionDeadline` (immutable = `closeTime + RESOLUTION_TIMEOUT`,
  default `closeTime + 96h`)
- `uint8 proposedOutcome`, `uint64 proposedAt`, `string proposalURI`
- `address guardian` (immutable = factory owner at creation)
- `bool paused`
- `uint256 resolvedCollateral` (snapshot at finalize, as in V1)

### Functions

- `buy(outcome, amount)` / `buyFor(recipient, outcome, amount)` — as V1; reverts
  if `paused`, if `state != Open`, if `block.timestamp >= closeTime`, if
  `outcome >= outcomeCount`, if `amount == 0`. Pulls USDC via `safeTransferFrom`.
- `propose(uint8 outcome, string calldata uri)` — `onlyResolver`; requires
  `state == Open`, `block.timestamp >= closeTime`, `outcome < outcomeCount`,
  `totalShares[outcome] > 0` (else resolver must `cancel`). Sets
  `proposedOutcome/proposalURI/proposedAt`, `state = Proposed`. Emits
  `OutcomeProposed`.
- `challenge()` — requires `state == Proposed`, within window
  (`block.timestamp <= proposedAt + challengeWindow`), and
  `sharesOf-any-outcome[msg.sender] > 0` (caller is a participant). Sets
  `state = Canceled`. Emits `OutcomeChallenged(msg.sender)` + `MarketCanceled`.
- `finalize()` — permissionless; requires `state == Proposed` and
  `block.timestamp > proposedAt + challengeWindow`. Sets
  `resolvedCollateral = collateral.balanceOf(this)`, `winningOutcome =
  proposedOutcome`, `state = Resolved`. Emits `MarketResolved`.
- `apoptosis()` — permissionless; requires `state == Open`,
  `block.timestamp > resolutionDeadline`. Sets `state = Canceled`. Emits
  `MarketCanceled` (reason: timeout).
- `cancel()` — `creator` or `guardian`; requires `state == Open`. Allowed before
  OR after close (covers a bad market spotted any time pre-resolution). Sets
  `state = Canceled`. Emits `MarketCanceled`.
- `pause()` / `unpause()` — `onlyGuardian`; toggles `paused` (blocks `buy`/
  `buyFor` and `propose`). Does not block `claim`/`refund`/`challenge`/`finalize`
  /`apoptosis` (so users can always exit). Emits `Paused`/`Unpaused`.
- `claim()` — requires `state == Resolved`, `!claimed[msg.sender]`,
  `sharesOf[winningOutcome][msg.sender] > 0`. Pull-based; pro-rata of
  `resolvedCollateral`, minus protocol fee (capped 5%). CEI: set `claimed` before
  transfers. (Unchanged math from V1.)
- `refund()` — requires `state == Canceled`, `!claimed[msg.sender]`; refunds the
  sum of the caller's shares across all outcomes (1 USDC = 1 share). Reverts with
  **`NotCanceled`** when `state != Canceled` (the renamed error). CEI.
- Views: `previewClaim(user)`, `previewRefund(user)`, plus
  `challengeDeadline()` and a `phase()` helper for the UI.

### Errors

`MarketClosed, MarketNotClosed, InvalidOutcome, InvalidOutcomeCount, InvalidFee,
ZeroAddress, NotResolver, NotGuardian, NotActive, NotProposed, NotResolved,
NotCanceled, AlreadyClaimed, NoWinningShares, WindowOpen, WindowClosed, Paused,
DeadlineNotReached, NotParticipant`.

### Factory: `PrestoMarketV2Factory`

Like V1's factory: `createMarket(resolver, closeTime, metadataURI, marketKind,
outcomeCount)` deploys a `PrestoMarketV2`, passing `owner` as `guardian`,
`feeRecipient`, `protocolFeeBps`, and `challengeWindow`. Tracks `markets[]`,
`marketCount()`, `MarketCreated` event (same shape as V1 + `outcomeCount`).
`onlyOwner`: `setFees`, `setChallengeWindow` (bounded 1h–7d), `transferOwnership`.

## App-side changes (same delivery)

- `src/lib/contracts.ts`: add `prestoMarketV2Abi` + `prestoMarketV2FactoryAbi`;
  `NEXT_PUBLIC_MARKET_FACTORY_V2_ADDRESS` env in `arcConfig.ts`.
- `src/lib/onchainMarkets.ts`: enumerate the V2 factory alongside V1; map the V2
  `State` + phase (Open / Closed / Proposed+challenge-countdown / Resolved /
  Canceled) into `MarketStatus` and a new `phase`/`challengeDeadline` field on
  `AppMarket`; `resolverVerified` already computed.
- `src/lib/agentWallet.ts`: V2 markets resolve via `propose()`; the
  auto-resolve cron proposes, and a follow-up `finalize()` pass settles proposals
  whose window has elapsed (same cron loop). No-winning-shares → `cancel()`.
- `src/lib/circleActions.ts` + `liveActions.ts` + `appState.tsx`: add
  `challengeMarket(marketId)` and `finalizeMarket(marketId)` actions (routed
  through the existing transaction tracker/toasts); `claim`/`refund`/`buy`
  unchanged for V2 (same selectors).
- `src/components/MarketDetailClient.tsx`: render the V2 phases — show the
  proposed outcome + a challenge-window countdown with a **"Dispute outcome"**
  button (participants only), a **"Finalize"** action once the window passes, and
  the Canceled→refund path. Keep the resolver-verified badge.

## Migration / coexistence

- The app reads both factories; V1 markets keep their V1 ABI/behavior.
- Only the V2 factory is used for new creation (agent + user create flows).
- No on-chain migration; no funds moved.

## Testing

Hardhat/Foundry unit tests, all before any deploy:

- buy: paused blocks; post-close reverts; invalid outcome reverts; shares/pot
  accounting.
- propose: only resolver; only after close; only outcome-with-shares; sets
  Proposed.
- challenge: only participant; only within window; → Canceled → refund path.
- finalize: only after window; only from Proposed; sets Resolved + resolvedCollateral.
- apoptosis: reverts before deadline; reverts if Proposed/Resolved/Canceled;
  succeeds on a closed-never-proposed market past deadline.
- cancel: creator/guardian only; works pre- and post-close; refund path.
- pause/unpause: guardian only; blocks buy/propose; never blocks claim/refund.
- claim: pro-rata math + fee + dust; double-claim blocked.
- refund: sums all outcomes; reverts `NotCanceled` when Resolved.
- Coexistence smoke: factory deploy + create + full happy path + full dispute
  path on a forked/local Arc.

## Risks

- **Free griefing of resolution.** A small-stake participant can `challenge()`
  any proposal → forced refund (no funds lost, but markets may not pay out).
  Accepted for testnet; the documented mainnet fix is a refundable/slashable
  challenge deposit (the deferred bond layer).
- **Finalize liveness.** Someone must call `finalize()` after the window; the
  agent cron does this, and any claimer can trigger it — but a market with no
  interested party could sit Proposed. Mitigation: the cron finalizes all
  past-window proposals each run.
- **Apoptosis vs late proposal race** — avoided by design: apoptosis only fires
  on `state == Open` (never proposed); a Proposed market is governed by
  finalize/challenge, never apoptosis.

## Out of scope / follow-ups

- Challenge/proposer bonds + slashing (mainnet credibility).
- On-chain oracle self-resolution for price/conviction markets.
- Reputation registry for resolvers across the factory.
