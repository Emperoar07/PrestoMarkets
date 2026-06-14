# Spend any market in both USDC and EURC — plan

Date: 2026-06-14. Sources: Arc docs MCP (app-kit/swap), Circle docs MCP,
circlefin/arc-prediction-markets, installed @circle-fin/app-kit + adapter-viem-v2.

## Goal
Let a user pay for ANY market in either USDC or EURC, regardless of the market's collateral —
"dynamic, spendable on any market."

## What the references say
- **Circle's arc-prediction-markets sample does NOT do this.** It uses a single hardcoded
  collateral (ARCT); the AMM pulls only that token on buy. No swap, no multi-collateral. So it's
  not a reference for this feature.
- **Arc does it natively via App Kit Swap.** Arc Testnet is the only testnet that supports Swap,
  for USDC / EURC / cirBTC. Verified API (installed packages):
  - `@circle-fin/app-kit` exports `AppKit`; `new AppKit().swap(params)` and `.estimateSwap(params)`.
  - `@circle-fin/adapter-viem-v2` exports **`createViemAdapterFromProvider`** — a browser adapter
    over an EIP-1193 provider (window.ethereum), so swaps sign with the user's connected MetaMask.
  - Shape: `kit.swap({ from: { adapter, chain: 'Arc_Testnet' }, tokenIn: 'USDC', tokenOut: 'EURC',
    amountIn: '1.00', config: { kitKey, stopLimit? , customFee? } })`.
  - `estimateSwap` returns `estimatedOutput` for a pre-swap quote; `stopLimit` sets the min output
    (slippage protection).

## Design: swap-at-buy
A market keeps its single on-chain collateral (USDC or EURC — Presto contracts are
collateral-agnostic). To pay in the OTHER currency:

1. Trade panel gains a **Pay with: USDC | EURC** selector (the `payWith` state already exists).
2. On buy, if `payWith === market.collateralSymbol` → buy directly (today's path).
3. If `payWith !== collateral` →
   a. `estimateSwap` to show the user the converted amount + rate,
   b. `kit.swap(payToken → collateral, amountIn)` with a `stopLimit` for slippage,
   c. then the normal approve+buy with the received collateral.
4. Surface each step (estimate → swap → approve → buy) like the Move-to-Arc flow.

## Prerequisites (blockers)
- **KIT_KEY** — App Kit Swap requires a kit key from the Circle Console
  (`config.kitKey`). Must be provisioned and set as env (e.g. `NEXT_PUBLIC_CIRCLE_KIT_KEY`).
  Presto already carries a `CIRCLE_KIT_KEY` env name — confirm it's a valid App Kit key.
- **EOA first.** `createViemAdapterFromProvider` covers MetaMask/external wallets. Circle
  user-controlled wallets need the developer-controlled `adapter-circle-wallets` (apiKey +
  entitySecret) — a different trust model — so Circle-wallet swap is a phase 2.

## Fees / guardrails
- App Kit takes a small provider fee (~2 bps) + optional custom fee (we can set 0). Gas is USDC.
- Always `estimateSwap` first and pass `stopLimit` so the user can't be surprised by slippage
  (#37: no silent conversion — the swap is an explicit, quoted user action).
- EURC and USDC are both 6-decimal on Arc — no decimal mismatch.

## Build order
1. `src/lib/swapActions.ts` — `estimateArcSwap()` + `swapArcTokens()` using AppKit +
   `createViemAdapterFromProvider`, gated on KIT_KEY (clear "swap unavailable" when absent).
2. Trade panel: Pay-with selector → estimate badge → swap-then-buy for the cross-currency case.
3. Phase 2: Circle-wallet swap via the Circle adapter.

## Status
Browser swap API confirmed present in installed packages. **Blocked only on a valid App Kit
KIT_KEY.** Once set, the swap lib + pay-with selector are a bounded build (no new contracts —
markets stay single-collateral; the swap happens client-side before the buy).
