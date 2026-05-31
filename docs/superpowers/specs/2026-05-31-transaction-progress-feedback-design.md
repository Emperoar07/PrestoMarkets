# Transaction progress feedback — design

**Date:** 2026-05-31
**Status:** Approved (design), pending spec review
**Owner:** Presto Markets

## Problem

Outside the wallet/PIN confirmation modal, a user has no way to tell whether a
transaction is pending, processing, succeeded, or failed. The UI shows a single
static line ("Waiting for wallet confirmation…") and a disabled button, then a
terminal success/fail message — with no visible lifecycle in between.

Worse, for **Circle user-controlled wallet** buys the action returns with
`waitForConfirmation: false`, so "success" is declared *before* the chain
confirms. The post-transaction refresh then runs against stale state, and the
wallet balance / positions do not reliably update until a hard page refresh.

This affects both wallet paths (Circle UCW and external EVM wallets) and every
value action (buy, claim, refund, resolve, cancel, create).

## Goals

1. Show a clear transaction lifecycle: `submitting → confirming → confirmed | failed | pending`.
2. Make "confirmed" mean **on-chain confirmed**, and refresh balances/positions
   at exactly that moment — no stale UI, no hard refresh.
3. Surface status in two complementary places (decision: *Both*):
   - **Inline** in the active modal for the wallet/PIN phase.
   - A **global toast** that carries the on-chain confirmation tail after the
     modal closes, and covers modal-less actions (claim/refund).
4. Work uniformly for Circle UCW and external wallets, across all value actions.

## Non-goals

- No per-step ("Approving…/Buying…") granularity in v1 — coarse `confirming`
  state spanning the Circle approve+buy two-PIN flow. An optional `onStage` hook
  is left in place so this can be added later without reshaping anything.
- No optimistic UI. Success is shown only after confirmation (explicit decision).
- No changes to the liquidity path (being deprecated; unreachable in the UI).
- No state-machine library (xstate) — four stages do not warrant it.

## Decisions (from brainstorming)

- **Surface:** Both — inline modal step + global toast tail.
- **Success timing:** Wait for on-chain confirmation, then refresh.
- **Architecture:** Approach A — central transaction tracker + global toast stack.

## Architecture (Approach A)

A single React context owns transaction state and the toast stack; every value
action is invoked through it. One source of truth, no per-modal duplication,
modal-less actions covered for free.

### Correctness fix (root cause of staleness)

Flip the Circle money actions in `src/lib/circleActions.ts` from
`waitForConfirmation: false` to wait for the Arc receipt:

- `buyCircleShares` (the buy step)
- `claimCircleMarket`, `refundCircleMarket` (user money out)
- `resolveCircleMarket`, `cancelCircleMarket` (resolver actions) — included for
  consistent status, lower priority.

The machinery already exists: `runContractExecution` →
`findRecentTransactionId` → `waitForTx` (polls Circle + `waitForArcReceipt`).
`waitForTx` returns `{ txHash, pending }`, where `pending: true` means Arc
finalized but Circle's indexer lagged past the timeout — surfaced as a real
`pending` toast state with an explorer link, not a silent stall.

External-wallet actions in `src/lib/liveActions.ts` already
`waitForTransactionReceipt` before resolving, so they need no change beyond
being routed through the tracker.

Once actions resolve `ok` only after confirmation, the existing refresh-on-`ok`
logic in `appState` becomes accurate. The refresh is moved to fire from the
tracker's `onConfirmed` so it is tied to the visible ✓.

### New units

- **`src/lib/transactions.tsx`** — `TransactionProvider` + `useTransactions()`.
  - State: `TxEntry[]` where
    `TxEntry = { id: string; label: string; amountLabel?: string; stage: TxStage; txHash?: string; error?: string; createdAt: number }`
    and `TxStage = 'submitting' | 'confirming' | 'confirmed' | 'pending' | 'failed' | 'cancelled'`.
  - API:
    - `track<T extends LiveActionResult>(meta: { label: string; amountLabel?: string }, runner: () => Promise<T>, opts?: { onConfirmed?: () => void; onStage?: (stage: TxStage) => void }): Promise<T>`
      - create entry as `submitting`; transition to `confirming` once the runner's
        wallet/PIN phase is underway (coarse: set `confirming` immediately after
        create for v1, since the runner is a single awaited promise);
      - on resolve: `ok && !pending → confirmed`; `ok && pending → pending`;
        `!ok` and message looks like a user rejection → `cancelled`; else `failed`;
      - attach `txHash` from the result; call `onConfirmed` on `confirmed`/`pending`.
    - `dismiss(id)`.
  - Auto-dismiss: `confirmed` after ~6s; `cancelled` after ~4s; `pending` and
    `failed` are sticky (manual dismiss).
  - A pure reducer `reduceStage(result) → TxStage` is exported for unit testing.

- **`src/components/ToastStack.tsx`** — fixed top-right stack, mounted once in
  the providers tree (alongside the app state provider). Renders per entry:
  spinner / ✓ / ✗ / ⏳, the `label`, `amountLabel`, and "View on Arc ↗"
  (`https://testnet.arcscan.app/tx/<txHash>`) when a hash is present. Stacks
  newest on top; respects reduced-motion.

### Wiring

- `src/lib/appState.tsx`: keep `placeTrade`/`claimMarket`/etc. returning the
  `LiveActionResult`. The per-action refresh stays but is triggered via the
  tracker's `onConfirmed` (passed as `() => { void refreshAll({ force: true }); schedulePostTransactionRefresh(); }`)
  so it fires on confirmation rather than on early return. (Net behavior is the
  same for external wallets; fixed for Circle.)
- `src/components/MarketDetailClient.tsx` and `src/components/QuickBuyModal.tsx`:
  replace local `runAction` with `track(...)`. Keep an inline one-liner + button
  label driven by the current stage for the in-modal phase. The toast owns the
  tail after the modal closes.
- Claim / refund / resolve / cancel buttons route through `track(...)` too.

### Data flow

```
user clicks Buy
  → modal: stage=submitting (button "Submitting…", inline spinner)
  → track() pushes toast (submitting → confirming)
  → runner: wallet/PIN (+ Circle approve+buy) → waits for Arc receipt
  → resolve:
       ok            → toast ✓ Confirmed + explorer link → onConfirmed() refresh → auto-dismiss
       ok & pending  → toast ⏳ Pending + explorer link  → onConfirmed() refresh → sticky
       failed        → toast ✗ Failed (real error)       → sticky; modal shows error
       cancelled     → toast "Cancelled"                 → auto-dismiss
```

## Error handling

- Reverted / API failure → `failed`, sticky red toast + inline error with the
  underlying message.
- `pending` (indexer lag) → amber toast with explorer link; balance still
  refreshes because the Arc receipt exists.
- Wallet/PIN rejected ("cancelled the Circle signing request") → neutral
  `cancelled` toast, no error styling.

## Testing

- Unit (vitest): `reduceStage` mapping for ok / ok+pending / failed / cancelled;
  auto-dismiss vs sticky selection per stage.
- Manual live: one Circle UCW buy and one external-wallet buy — confirm the
  toast goes submitting → confirming → ✓ and that the balance/positions update
  without a hard refresh.

## Risks

- Longer perceived wait on Circle (now waits for confirmation, ~3-8s for SCA
  user-ops). Mitigated by the visible `confirming` toast so the wait is
  legible rather than a frozen UI.
- `waitForTx` timeout tuning: if Circle's indexer is slow, the `pending` state
  (with explorer link + a completed refresh) is the designed, non-broken
  fallback.

## Out of scope / follow-ups

- Per-step Circle staging (Approving… / Buying…) via the `onStage` hook.
- A persistent activity/history view of past transactions.
