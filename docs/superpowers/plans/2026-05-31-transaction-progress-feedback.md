# Transaction Progress Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every value transaction (buy, claim, refund, resolve, cancel) a visible lifecycle — submitting → confirming → confirmed/pending/failed — via a global toast stack plus inline modal state, and make "confirmed" mean on-chain confirmed so balances refresh without a hard reload.

**Architecture:** A presentational `TransactionProvider` context owns a toast stack and a `track(meta, runner)` wrapper that drives toast stages from the action's `LiveActionResult`. Circle money actions are flipped to wait for the Arc receipt, so `appState`'s existing refresh-on-`ok` fires only after real confirmation. The tracker does not own refresh — it visualizes; refresh stays in `appState` and is now correctly timed.

**Tech Stack:** Next.js 16 (App Router), React context, TypeScript, viem, vitest.

---

## File structure

- `src/lib/liveActions.ts` — add `pending?: boolean` to `LiveActionResult` (modify).
- `src/lib/circleActions.ts` — set `pending: true` in `pendingResultFromError`; flip Circle actions to `waitForConfirmation: true` (modify).
- `src/lib/transactions.tsx` — NEW: `TransactionProvider`, `useTransactions`, `reduceStage`, types.
- `src/lib/__tests__/transactions.test.ts` — NEW: unit tests for `reduceStage`.
- `src/components/ToastStack.tsx` — NEW: global top-right toast UI.
- `app/layout.tsx` — mount `TransactionProvider` + `<ToastStack/>` (modify).
- `src/components/MarketDetailClient.tsx` — route `runAction` through `track` (modify).
- `src/components/QuickBuyModal.tsx` — route submit through `track` (modify).

Test runner note: run the **full** vitest suite (`node "/c/Program Files/nodejs/node.exe"`… see commands). Single-file vitest invocation errors with a config quirk in this repo, so always run the whole suite and grep for the target.

---

### Task 1: Add `pending` to the result type and surface it from Circle

**Files:**
- Modify: `src/lib/liveActions.ts` (the `LiveActionResult` type)
- Modify: `src/lib/circleActions.ts` (`pendingResultFromError`, and the `waitForConfirmation` flags)

- [ ] **Step 1: Add `pending` to `LiveActionResult`**

In `src/lib/liveActions.ts`, change the type:

```ts
export type LiveActionResult = {
  ok: boolean;
  message: string;
  txHash?: Hex;
  marketAddress?: Address;
  /** True when submitted and finalized on Arc but Circle's indexer is still catching up. */
  pending?: boolean;
};
```

- [ ] **Step 2: Mark pending results as `pending` in `circleActions.ts`**

In `src/lib/circleActions.ts`, update `pendingResultFromError` to set the flag (add the `pending: true` line and the type):

```ts
function pendingResultFromError(err: unknown, label: string): { ok: boolean; message: string; txHash?: `0x${string}`; pending?: boolean } | null {
  const msg = err instanceof Error ? err.message : '';
  if (!msg.startsWith(PENDING_TAG)) return null;
  const hashPart = msg.slice(PENDING_TAG.length).trim();
  const hash = hashPart && hashPart !== 'undefined' ? hashPart : '';
  return {
    ok: true,
    pending: true,
    message: `${label} submitted. Arc confirmation is updating in the background.`,
    txHash: hash ? (hash as `0x${string}`) : undefined,
  };
}
```

- [ ] **Step 3: Make Circle money actions wait for confirmation**

In `src/lib/circleActions.ts`, in `buyCircleShares`, the `buy(uint8,uint256)` call currently passes `waitForConfirmation: false`. Change it to `true`:

```ts
    const txHash = await runContractExecution({
      session,
      contractAddress: input.marketAddress,
      abiFunctionSignature: 'buy(uint8,uint256)',
      abiParameters: [String(input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1)), amount],
      refId: `presto-buy-${input.marketAddress}-${Date.now()}`,
      preview: {
        label: `Buy ${input.outcome} · ${humanAmount}`,
        action: `Mints ${input.outcome} shares for this market against your approved USDC.`,
        amountDisplay: humanAmount,
        parameters: [
          `outcome: ${input.outcome} (${input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1)})`,
          `amount: ${humanAmount}`,
        ],
      },
      waitForConfirmation: true,
    });
```

In the same file, `resolveCircleMarket` and `noArgAction` (used by claim/refund/cancel) pass `waitForConfirmation: false`. Change both occurrences to `waitForConfirmation: true` so claim/refund/resolve/cancel also wait for the Arc receipt before reporting success.

- [ ] **Step 4: Verify typecheck + build**

Run:
```
"/c/Program Files/nodejs/node.exe" node_modules/typescript/bin/tsc --noEmit
```
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/liveActions.ts src/lib/circleActions.ts
git commit -m "fix(tx): wait for Arc confirmation on Circle actions + flag pending results"
```

---

### Task 2: Transaction tracker context (TDD on the reducer)

**Files:**
- Create: `src/lib/transactions.tsx`
- Test: `src/lib/__tests__/transactions.test.ts`

- [ ] **Step 1: Write the failing test for `reduceStage`**

Create `src/lib/__tests__/transactions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reduceStage } from '../transactions';

describe('reduceStage', () => {
  it('confirmed when ok and not pending', () => {
    expect(reduceStage({ ok: true })).toBe('confirmed');
    expect(reduceStage({ ok: true, pending: false })).toBe('confirmed');
  });

  it('pending when ok and pending', () => {
    expect(reduceStage({ ok: true, pending: true })).toBe('pending');
  });

  it('failed when not ok', () => {
    expect(reduceStage({ ok: false, message: 'Arc transaction reverted.' })).toBe('failed');
  });

  it('cancelled when not ok and message mentions cancel', () => {
    expect(reduceStage({ ok: false, message: 'You cancelled the Circle signing request.' })).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run the suite to verify it fails**

Run:
```
"/c/Program Files/nodejs/node.exe" node_modules/vitest/vitest.mjs run 2>&1 | grep -E "transactions|Failed|Test Files|Tests "
```
Expected: FAIL — `Cannot find module '../transactions'` (or reduceStage undefined).

- [ ] **Step 3: Create `src/lib/transactions.tsx`**

```tsx
'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type TxStage = 'confirming' | 'confirmed' | 'pending' | 'failed' | 'cancelled';

export type TxEntry = {
  id: string;
  label: string;
  amountLabel?: string;
  stage: TxStage;
  txHash?: string;
  error?: string;
  createdAt: number;
};

type TrackResult = { ok: boolean; message?: string; txHash?: string; pending?: boolean };

/** Pure mapping from an action result to a terminal toast stage. Unit-tested. */
export function reduceStage(result: TrackResult): TxStage {
  if (!result.ok) {
    return /cancel/i.test(result.message ?? '') ? 'cancelled' : 'failed';
  }
  return result.pending ? 'pending' : 'confirmed';
}

type TrackMeta = { label: string; amountLabel?: string };

type TransactionContextValue = {
  entries: TxEntry[];
  track: <T extends TrackResult>(meta: TrackMeta, runner: () => Promise<T>) => Promise<T>;
  dismiss: (id: string) => void;
};

const TransactionContext = createContext<TransactionContextValue | null>(null);

// confirmed/cancelled auto-dismiss; pending/failed are sticky until dismissed.
const AUTO_DISMISS_MS: Partial<Record<TxStage, number>> = { confirmed: 6_000, cancelled: 4_000 };

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `tx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function TransactionProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TxEntry[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setEntries((list) => list.filter((entry) => entry.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const settle = useCallback((id: string, stage: TxStage, patch: Partial<TxEntry>) => {
    setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, ...patch, stage } : entry)));
    const ttl = AUTO_DISMISS_MS[stage];
    if (ttl) {
      const timer = setTimeout(() => dismiss(id), ttl);
      timers.current.set(id, timer);
    }
  }, [dismiss]);

  const track = useCallback(async <T extends TrackResult>(meta: TrackMeta, runner: () => Promise<T>): Promise<T> => {
    const id = newId();
    setEntries((list) => [
      { id, label: meta.label, amountLabel: meta.amountLabel, stage: 'confirming', createdAt: Date.now() },
      ...list,
    ]);
    try {
      const result = await runner();
      const stage = reduceStage(result);
      settle(id, stage, { txHash: result.txHash, error: stage === 'failed' ? result.message : undefined });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed.';
      const stage: TxStage = /cancel/i.test(message) ? 'cancelled' : 'failed';
      settle(id, stage, { error: stage === 'failed' ? message : undefined });
      throw error;
    }
  }, [settle]);

  return (
    <TransactionContext.Provider value={{ entries, track, dismiss }}>
      {children}
    </TransactionContext.Provider>
  );
}

export function useTransactions(): TransactionContextValue {
  const ctx = useContext(TransactionContext);
  if (!ctx) throw new Error('useTransactions must be used within TransactionProvider');
  return ctx;
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run:
```
"/c/Program Files/nodejs/node.exe" node_modules/vitest/vitest.mjs run 2>&1 | grep -E "transactions|Test Files|Tests "
```
Expected: the `transactions` suite passes; overall `Tests N passed` increases by 4.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transactions.tsx src/lib/__tests__/transactions.test.ts
git commit -m "feat(tx): transaction tracker context + reduceStage (tested)"
```

---

### Task 3: Toast stack UI

**Files:**
- Create: `src/components/ToastStack.tsx`

- [ ] **Step 1: Create `src/components/ToastStack.tsx`**

```tsx
'use client';

import { useTransactions, type TxStage } from '@/lib/transactions';

const ARC_TX_EXPLORER = 'https://testnet.arcscan.app/tx/';

const STAGE_META: Record<TxStage, { icon: string; title: string; cls: string; spin?: boolean }> = {
  confirming: { icon: '⟳', title: 'Confirming on Arc…', cls: 'border-cyan/30 bg-cyan/10 text-cyan', spin: true },
  confirmed: { icon: '✓', title: 'Confirmed', cls: 'border-mint/30 bg-mint/10 text-mint' },
  pending: { icon: '⏳', title: 'Submitted · still confirming', cls: 'border-amber-400/30 bg-amber-400/10 text-amber-300' },
  failed: { icon: '✕', title: 'Failed', cls: 'border-red-400/30 bg-red-400/10 text-red-200' },
  cancelled: { icon: '—', title: 'Cancelled', cls: 'border-white/15 bg-white/[0.06] text-muted' },
};

export function ToastStack() {
  const { entries, dismiss } = useTransactions();
  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {entries.map((entry) => {
        const meta = STAGE_META[entry.stage];
        return (
          <div
            key={entry.id}
            className={`pointer-events-auto rounded-[12px] border px-3.5 py-3 shadow-lg backdrop-blur ${meta.cls}`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2.5">
              <span className={`text-sm font-black ${meta.spin ? 'animate-spin' : ''}`} aria-hidden>{meta.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black">{meta.title}</p>
                <p className="mt-0.5 truncate text-[11px] font-bold text-white/90">
                  {entry.label}{entry.amountLabel ? ` · ${entry.amountLabel}` : ''}
                </p>
                {entry.error ? (
                  <p className="mt-1 break-words text-[11px] leading-4 text-red-200/90">{entry.error}</p>
                ) : null}
                {entry.txHash ? (
                  <a
                    href={`${ARC_TX_EXPLORER}${entry.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-[11px] font-bold underline underline-offset-2 hover:opacity-80"
                  >
                    View on Arc ↗
                  </a>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(entry.id)}
                className="text-xs font-black text-white/50 hover:text-white"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run:
```
"/c/Program Files/nodejs/node.exe" node_modules/typescript/bin/tsc --noEmit
```
Expected: exit 0 (component compiles; not yet mounted).

- [ ] **Step 3: Commit**

```bash
git add src/components/ToastStack.tsx
git commit -m "feat(tx): global toast stack UI"
```

---

### Task 4: Mount the provider + toast stack

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Import and wrap**

In `app/layout.tsx`, add the imports near the other component imports:

```tsx
import { TransactionProvider } from '@/lib/transactions';
import { ToastStack } from '@/components/ToastStack';
```

Then change the `AppStateProvider` line:

```tsx
          <AppStateProvider>{children}</AppStateProvider>
```

to:

```tsx
          <AppStateProvider>
            <TransactionProvider>
              {children}
              <ToastStack />
            </TransactionProvider>
          </AppStateProvider>
```

- [ ] **Step 2: Verify build**

Run:
```
"/c/Program Files/nodejs/node.exe" node_modules/next/dist/bin/next build --webpack 2>&1 | tail -4
```
Expected: `BUILD EXIT: 0` / build completes (route table prints).

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(tx): mount TransactionProvider + ToastStack in layout"
```

---

### Task 5: Wire MarketDetailClient through the tracker

**Files:**
- Modify: `src/components/MarketDetailClient.tsx`

- [ ] **Step 1: Import the hook**

Add near the other imports in `src/components/MarketDetailClient.tsx`:

```tsx
import { useTransactions } from '@/lib/transactions';
```

- [ ] **Step 2: Read `track` and route `runAction` through it**

Inside the component, where other hooks/state are declared, add:

```tsx
  const { track } = useTransactions();
```

Then change `runAction` to take a label and wrap the action with `track`. Replace the existing `runAction` body:

```tsx
  async function runAction(action: () => Promise<{ ok: boolean; message: string; txHash?: string }>) {
    setIsSubmitting(true);
    setMessage('Waiting for wallet confirmation...');
    try {
      const result = await action();
      setMessage(result.message);
```

with:

```tsx
  async function runAction(
    action: () => Promise<{ ok: boolean; message: string; txHash?: string; pending?: boolean }>,
    label: string,
  ) {
    setIsSubmitting(true);
    setMessage('Waiting for wallet confirmation...');
    try {
      const result = await track({ label }, action);
      setMessage(result.message);
```

(The rest of `runAction` — the `catch` and `finally setIsSubmitting(false)` — stays unchanged.)

- [ ] **Step 3: Pass labels at each call site**

Update the `runAction(...)` callers in this file to pass a label as the second argument:

- Buy button (`tradeMode === 'liquidity' ? addLiquidity(...) : placeTrade(...)`):
  ```tsx
                onClick={() => void runAction(() => (
                  tradeMode === 'liquidity'
                    ? addLiquidity({ marketId, amount: amountValue, payWith })
                    : placeTrade({ marketId, outcome: selectedOutcome, outcomeIndex: activeOutcomeIndex, amount: amountValue, payWith })
                ), tradeMode === 'liquidity' ? `Add liquidity · ${unit}${amountValue}` : `Buy ${selectedOutcome} · ${unit}${amountValue}`)}
  ```
- Claim button: `void runAction(() => claimMarket(marketId), 'Claim winnings')`
- Refund button: `void runAction(() => refundMarket(marketId), 'Refund')`
- Resolve button: `void runAction(() => resolveMarket({ marketId, outcome: outcome.label, outcomeIndex: index, resolutionURI }), 'Resolve market')`
- Cancel button: `void runAction(() => cancelMarket(marketId), 'Cancel market')`

- [ ] **Step 4: Update the in-flight button copy (the inline half of "Both")**

Find the buy button label expression that currently includes `: isSubmitting ? 'Submitting...'` and change that branch to `: isSubmitting ? 'Confirming…'` so the inline button reflects the wait.

- [ ] **Step 5: Verify typecheck + build**

Run:
```
"/c/Program Files/nodejs/node.exe" node_modules/typescript/bin/tsc --noEmit
```
Expected: exit 0. If TS complains a callback result lacks `pending`, that is fine — `pending` is optional; ensure the `runAction` param type includes `pending?: boolean` as shown in Step 2.

- [ ] **Step 6: Commit**

```bash
git add src/components/MarketDetailClient.tsx
git commit -m "feat(tx): drive market detail actions through the transaction tracker"
```

---

### Task 6: Wire QuickBuyModal through the tracker

**Files:**
- Modify: `src/components/QuickBuyModal.tsx`

- [ ] **Step 1: Import the hook**

Add near the other imports:

```tsx
import { useTransactions } from '@/lib/transactions';
```

- [ ] **Step 2: Read `track` and wrap the submit**

Inside the component add:

```tsx
  const { track } = useTransactions();
```

In the submit handler (the `async function` around line 85 that does `setIsSubmitting(true)` / `setMessage('Waiting for wallet confirmation...')`), find the line that awaits the trade, e.g.:

```tsx
      const result = await placeTrade({ ... });
```

and wrap it with `track`, building a label from the existing outcome + amount values used in the modal:

```tsx
      const result = await track(
        { label: `Buy ${selectedOutcome} · ${unit}${amountValue}` },
        () => placeTrade({ /* keep the exact same arguments already passed here */ }),
      );
```

Use the modal's existing variable names for the outcome label and amount (the same ones already used to build the `placeTrade` call and the on-screen amount). Do not introduce new variables.

- [ ] **Step 3: Update in-flight button copy**

If the submit button shows `'Submitting...'` while `isSubmitting`, change it to `'Confirming…'`.

- [ ] **Step 4: Verify typecheck + build**

Run:
```
"/c/Program Files/nodejs/node.exe" node_modules/typescript/bin/tsc --noEmit
"/c/Program Files/nodejs/node.exe" node_modules/next/dist/bin/next build --webpack 2>&1 | tail -4
```
Expected: tsc exit 0; build completes.

- [ ] **Step 5: Commit**

```bash
git add src/components/QuickBuyModal.tsx
git commit -m "feat(tx): drive quick-buy through the transaction tracker"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck, tests, build**

Run:
```
"/c/Program Files/nodejs/node.exe" node_modules/typescript/bin/tsc --noEmit && echo TSC_OK
"/c/Program Files/nodejs/node.exe" node_modules/vitest/vitest.mjs run 2>&1 | grep -E "Test Files|Tests "
"/c/Program Files/nodejs/node.exe" node_modules/next/dist/bin/next build --webpack 2>&1 | tail -4
```
Expected: `TSC_OK`; tests all pass (prior count + 4 from Task 2); build completes.

- [ ] **Step 2: Manual live check (flag to the user)**

This cannot be verified headless. Ask the user to:
1. Do one **Circle UCW** buy → confirm the toast goes Confirming… → ✓ Confirmed, the balance/positions update without a hard refresh, and "View on Arc ↗" opens the tx.
2. Do one **external-wallet** buy → same lifecycle.
3. Reject a wallet/PIN prompt → confirm a neutral "Cancelled" toast (not a red error).

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
git add -A -- src/ app/
git commit -m "chore(tx): transaction progress feedback complete" || echo "nothing to commit"
```
Note: stage only `src/` and `app/` paths you changed — do not stage unrelated working-tree files.

---

## Self-review

**Spec coverage:**
- Lifecycle submitting→confirming→confirmed/failed/pending → Task 2 (`reduceStage`, stages) + Task 3 (UI). ✓
- Confirmed = on-chain confirmed + refresh at that moment → Task 1 (waitForConfirmation flip; `appState` refresh-on-`ok` now accurate). ✓
- Both surfaces (inline + toast) → Tasks 3–6 (toast + inline button copy/message). ✓
- Both wallet types, all value actions → Task 1 (Circle buy/claim/refund/resolve/cancel) + Tasks 5–6 (call sites); external already waits. ✓
- Pending (indexer lag) state with explorer link → Task 1 (`pending: true`) + Task 3 (pending styling, link). ✓
- Error/cancelled handling → `reduceStage` (cancel regex) + Task 3 styling. ✓
- Testing → Task 2 unit tests + Task 7 manual. ✓

**Placeholder scan:** Task 6 Step 2 intentionally reuses the modal's existing argument list rather than reprinting it (the exact `placeTrade` args already exist at that call site and must not be altered); all other code steps are complete. No TBD/TODO.

**Type consistency:** `reduceStage`, `TxStage`, `TxEntry`, `track`, `useTransactions`, `TransactionProvider`, `ToastStack` names are consistent across tasks. `LiveActionResult.pending` (Task 1) matches the `pending?: boolean` read in `reduceStage` and `runAction` param types (Tasks 2, 5, 6).
