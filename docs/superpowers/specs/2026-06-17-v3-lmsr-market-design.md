# Presto V3 — LMSR market (design)

Status: design, approved 2026-06-17. Scope: the V3 market contract only. PrestoSwap (USDC/EURC pool) and dual-currency buy are a separate spec.

## Goal

Give every Presto market live, continuous pricing and an early exit, without needing professional market makers. Today a market is a fixed-share parimutuel: 1 USDC mints 1 share, odds are just the share split, and there is no way to sell before resolution. V3 replaces that with an LMSR automated market maker so prices move with every trade and holders can sell back to the pool at any time.

## Why LMSR

The scaled leaders (Polymarket, Kalshi) run order books, but an order book is dead without market-maker liquidity, which Presto's agent-seeded, long-tail, low-liquidity markets do not have. An AMM guarantees a price and a counterparty from block one. Polymarket itself started on an AMM (a CPMM/FPMM) before graduating to a CLOB.

Of the two AMM families, LMSR is chosen over CPMM because:
- The maker's maximum loss is fixed and known up front (`b·ln(n)`), so the agent can budget exactly what it risks per market.
- Multi-outcome pricing is native and always sums to 1 — important for the 3-way fixtures.
- Buy and sell are symmetric, so early exit falls out of the same cost function.

Cost accepted: on-chain `exp`/`ln`. Mitigated with a vetted signed fixed-point library (solmate `wadExp`/`wadLn`, 18-decimal WAD), with precision and gas covered by tests.

A future graduation to a CLOB is left open (see Graduation).

## Decisions

- AMM: LMSR.
- Resolution: optimistic propose then a contract-enforced challenge window then settle, with **bonds** on both propose and dispute.
- Challenge window: reuse the current `RESOLUTION_CHALLENGE_WINDOW` (30 minutes).
- Size caps (#74): out of scope; LMSR's bounded loss already caps maker exposure.
- Emergency pause (#76): in scope, OZ `Pausable`, factory-owner guardian.
- Fee: configurable bps on buy and sell, default ~150 (1.5%), split protocol/creator.
- Collateral: agnostic (USDC or EURC), same as today.
- Rollout: new V3 factories (USDC + EURC, binary + multi), env cut over with the old factories moved to the legacy reader, exactly like the 30-minute cutover.

## Contracts

`PrestoLmsrMarket`
- Immutable: collateral token, resolver, closeTime, marketKind, outcomeCount `n`, metadataURI, liquidity param `b`, protocolFeeBps, fee recipients.
- State: per-outcome net shares `q[i]` (signed WAD), accrued fees, market state (Open, Proposed, Resolved, Canceled), proposal record, pause flag.
- Inherits ReentrancyGuard, SafeERC20, Pausable.

`PrestoLmsrMarketFactory`
- `createMarket(...)` mirrors the current factory signature plus a **seed amount `S`** (collateral the creator commits as the maker subsidy). The contract derives `b = S / ln(n)`, so the maximum maker loss `b·ln(n)` equals `S` exactly — the agent budgets one number it understands. Owner controls fee bps and the default bond size. Owner is the pause guardian and can pause any market it created (or a per-market guardian role).
- USDC and EURC variants, same as the current four factories.

Reused unchanged: metadata URI format and `parseMarketMetadata`, the resolver/agent identity, the close-time and timeout-cancel safety (`RESOLUTION_TIMEOUT`).

## LMSR mechanics

All quantities in 18-decimal WAD; collateral is 6-decimal USDC/EURC, so convert at the boundary.

- Cost: `C(q) = b · ln( Σ exp(q_i / b) )`.
- Price of outcome i (live odds): `p_i = exp(q_i/b) / Σ exp(q_j/b)`, in (0,1), Σ p_i = 1.
- Buy `Δ` shares of outcome i: `cost = C(q + Δ·e_i) − C(q)`; caller pays `cost + fee`, `maxCost` slippage guard, `q_i += Δ`.
- Sell `Δ` shares of outcome i: `refund = C(q) − C(q − Δ·e_i)`; caller receives `refund − fee`, `minRefund` slippage guard, `q_i −= Δ`. Open markets only.
- Seeding: at creation the agent commits a seed `S` and the contract sets `b = S / ln(n)`, so the maximum the maker can lose is exactly `S`. Larger `S` means deeper liquidity and flatter price impact for a larger subsidy.

Overflow/precision: clamp `q_i/b` to the safe domain of `wadExp`; subtract `max(q_i/b)` before exponentiating (log-sum-exp trick) to avoid overflow and keep precision.

## Collateral and payout

- The contract holds: the seed (`b·ln(n)`) plus net collateral paid in by buyers minus refunds to sellers, plus accrued fees.
- Invariant (tested): holdings always cover the worst-case payout — every outstanding share of any single outcome redeemable at 1 collateral unit — because LMSR's loss is bounded by the seed.
- On settle: holders of the winning outcome redeem each share for 1 collateral unit; losing-outcome shares are worthless. Leftover collateral (unspent seed + fees − net payout) returns to the creator/agent.
- Cancel/timeout path: refund each holder the collateral value of their position; never trap funds.

## Early exit (sell)

`sell(outcomeIndex, shares, minRefund)` burns shares, returns the LMSR refund minus fee, guarded by `minRefund`, allowed only while Open or Closing soon and not paused. This is the headline user-facing feature: a position can be exited any time before close at the current market price.

## Bonded optimistic resolution

- `propose(outcome, evidenceURI)`: resolver/agent proposes the result and posts a **proposer bond** (configurable, e.g. flat USDC). State -> Proposed, window opens (30 min).
- `dispute(reason)`: any address holding a position posts a **disputer bond** and blocks auto-settle. State -> Disputed.
- Undisputed after the window: `settle()` pays winners, returns the proposer bond.
- Disputed: the resolver must settle directly with evidence. The final outcome decides bonds:
  - Dispute upheld (proposer was wrong): disputer bond returned, proposer bond slashed to the disputer (or split disputer/treasury).
  - Dispute frivolous (proposer was right): disputer bond forfeited to the proposer (or split proposer/treasury).
- Bond sizing: factory default, owner-tunable. Bonds are separate from trading collateral and never touch the LMSR pool.

## Emergency pause (#76)

- OZ `Pausable`. Factory owner (guardian) can `pause()`/`unpause()` a market; optionally a factory-level switch.
- Paused blocks buy, sell, and propose. Claim, refund, and timeout-cancel stay enabled so a pause can never strand funds.

## Fees

- `protocolFeeBps` (default ~150) charged on buy and sell, split between a protocol recipient and the market creator. Accrues in the contract, withdrawable by the recipients. Fees are taken on top of LMSR cost (buy) and out of the refund (sell).

## App and agent changes

- Reader (`onchainMarkets`): detect V3 markets, expose live LMSR prices as the odds, read `b` and pool state. V1/V2 markets keep their current reads via the legacy factory list.
- Trade panel: add a **Sell / exit** action and live price + slippage preview, across all three wallet types (external EOA, Circle UCW, passkey) using the existing per-mode action layer.
- Chart and odds: become real AMM prices instead of the share-split estimate.
- Agent: seed `b` (max-loss subsidy) at creation instead of seeding each outcome; everything downstream (dedup, image gate, propose/settle) unchanged.
- Circle wallet policy + passkey allowlist: add the new `buy`, `sell`, `propose`, `dispute` signatures for the V3 market.

## Rollout

1. Build and test `PrestoLmsrMarket` + factory.
2. Deploy the four V3 factories (binary/multi x USDC/EURC).
3. Env cutover: V3 factories become primary, the current 30-minute V2 factories move into the legacy lists, redeploy, verify existing markets still load (same playbook as the 30-minute cutover).
4. Agent and UI start creating and trading V3 markets; older markets keep working unchanged.

## Testing

Hardhat:
- LMSR cost/price math vs an off-chain reference across ranges, including extreme `q_i/b`.
- Buy/sell round-trips: price moves correctly, refunds are consistent, fees accrue.
- Solvency invariant: holdings always cover the worst-case payout.
- Bonded dispute paths: propose, undisputed settle, disputed settle, both slashing outcomes, bond accounting.
- Pause gating: trading blocked, claims/refunds open.
- Fixed-point precision and gas snapshots for buy/sell.

## Graduation to CLOB (future, not built)

LMSR positions are per-address per-outcome balances. Keep that accounting clean and standard so a market can later list its outcome shares on an order book without re-minting, mirroring Polymarket's AMM -> CLOB path. No CLOB work in V3.

## Out of scope

- PrestoSwap (USDC/EURC pool) and dual-currency buy-at-swap — separate spec.
- Size caps (#74).
- CLOB.

## Risks and open items

- Fixed-point `exp`/`ln` gas and precision on Arc (paris EVM) — pick and pin a vetted lib, snapshot gas.
- Rigorous solvency argument for the `b` seed across n outcomes.
- Sell flow correctness across EOA, Circle UCW, and passkey, including the confirmation modal and Arc-direct confirmation.
- Bond sizing economics on a low-liquidity testnet (too high deters honest disputes, too low invites spam).
- Migrating the frontend odds/chart from parimutuel estimate to live AMM price without breaking V1/V2 market rendering.
