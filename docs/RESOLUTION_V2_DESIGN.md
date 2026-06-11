# Resolution V2 Design

Status: design for review. Nothing here is deployed. Written 2026-06-10 after a deep audit flagged
the two structural risks in V1 settlement: a single resolver key with no escape hatch, and
resolution truth resting on one LLM's self-attested confidence.

References studied for this design (validated against public docs, 2026-06):

- **Polymarket / UMA Optimistic Oracle** — propose with a ~$750 bond, 2-hour challenge window,
  one counter-bond round, second dispute escalates to a DVM token-holder vote (48–96h). Winner
  of a disputed round gets their bond back plus 50% of the loser's bond. In practice ~98.5% of
  proposals resolve unchallenged — the optimistic path is the normal path, escalation is the
  rare exception. Clarifications ("additional context") can sharpen wording but never flip the
  plain-reading intent.
- **Opinion Labs / Opinion AI oracle** — after expiry the AI ingests predefined sources and
  proposes an outcome; a jury of models (Claude, GPT, Grok/Gemini) reviews; independent human
  reviewers verify the final determination (token-holder vote planned post-TGE). Objective
  data (macro prints, crypto prices) bypasses the AI entirely via third-party oracles like
  Chainlink. Markets that can't settle under clear objective conditions are never published.

Two extra patterns worth copying beyond the dispute flow:

1. **A deterministic-oracle tier.** Opinion routes objective data around the AI completely.
   Presto already does this for crypto prices (CoinGecko deterministic path); extend the same
   tier to macro prints (official BLS/Fed releases) so the jury only ever judges genuinely
   interpretive questions.
2. **Resolvability as a publication gate, not a settlement problem.** Both venues refuse to
   list markets that can't settle objectively. Presto's draft validators already enforce this;
   keep treating cancel-and-refund as a failure of the gate, not a normal outcome.

### Circle's Arc prediction-markets sample (added 2026-06-11)

Circle released an open-source prediction market sample on Arc Testnet
(github.com/circlefin/arc-prediction-markets) that changes the Phase B build-vs-write calculus:

- **`EventBasedPredictionMarket` + `PredictionMarketAMM`** — lifecycle contract plus a
  constant-product AMM (x·y=k, 2% fee, YES/NO prices always sum to 1) with the exact quote
  surface Presto V2 wants: `getYesPrice/getNoPrice`, `calcBuyYes/No`, `calcSellYes/No`,
  `getReserves`.
- **UMA OOv2 bootstrapped on Arc** — their deploy script stands up the full UMA stack on Arc
  Testnet (Finder, IdentifierWhitelist, AddressWhitelist, Store, OptimisticOracleV2) with
  `MockOracleAncillary` substituting for the DVM. Event-based mode, `priceSettled()` /
  `priceDisputed()` callbacks, multiple dispute rounds with fresh timestamps, 1-minute testnet
  liveness.
- **Caveats before reuse:** sample collateral is ARCT (18-decimal mintable test token), not
  USDC (6 decimals) — decimal handling must be reworked; the DVM is a mock (fine for testnet,
  matches our council stand-in); liveness must be raised from 1 minute to our 2-hour window.

Implication for Phase B: rather than writing a bespoke optimistic resolver, adapt the Circle
sample's OOv2 deployment + event-based market pattern with USDC collateral and council
escalation. The AMM contract doubles as the reference for the separate Phase 4 pricing track,
which keeps quote math (#displayed chance = trade price = chart source) consistent by
construction.

## Goals

1. No market can ever strand funds. If the resolver disappears, anyone can eventually trigger a
   full refund.
2. No single model output settles a market. Settlement requires either multi-model agreement or
   an unchallenged public proposal window.
3. Bad markets can be cleaned up early. Cancel is full-refund by construction, so it is safe to
   allow before close.
4. Keep the V1 trust surface: every settlement publishes evidence on chain.

## Non-goals

- AMM or order book pricing (separate Phase 4 track).
- Token-holder voting (no token; a resolution council stands in until there is one).
- Mainnet deployment. This ships to Arc Testnet first like everything else.

## Phase A — app-level hardening (no contract changes)

These close most of the risk immediately and need no redeploy of markets.

**A1. Multi-model resolution jury.** Before the agent submits `resolve()`, the evidence bundle is
judged by three independent models from the existing provider chain (e.g. Claude, Gemini, Groq).
Each returns `{ outcome, confidence }`. The agent only resolves when at least two agree on the
outcome and the mean confidence clears the existing 0.75 gate. Disagreement defers the market to
the next tick; persistent disagreement past the grace window cancels and refunds as today.
This is the Opinion Labs jury pattern applied with infrastructure we already run.

**A2. Public proposal window.** Resolution becomes two-step at the app level: on tick N the agent
publishes a proposed outcome (notification to watchers and holders, a `source_update` comment on
the market, and a row in a `resolution_proposals` table). The on-chain `resolve()` executes on
tick N+1 (about 2 hours later, mirroring Polymarket's challenge window) unless an operator flags
the proposal. Flagging is manual for now; bonded challenges arrive with the V2 contract.

**A3. Clarifications.** An append-only `additional context` field on market metadata overrides,
shown on the market page. Clarifications may sharpen wording but must never flip the plain-reading
intent of the question — same rule Polymarket applies to its onchain clarifications.

## Phase B — PrestoMarketV2 contract

New market contract used by new factories; V1 markets run out their lives untouched.

**State machine.** `Active → Proposed → Resolved` plus `Canceled` reachable as below.

**Key functions.**

- `proposeResolution(uint8 outcome, string evidenceURI)` — callable by the resolver, posts
  `proposalBond` (USDC, e.g. 1 testnet / sized up for mainnet). Starts `challengeWindow`
  (default 2 hours, immutable per market).
- `challenge(uint8 counterOutcome)` — callable by anyone with a matching bond during the window.
  One challenge per round, max two rounds (Polymarket pattern). A second challenged round
  escalates to the council.
- `finalize()` — permissionless after an unchallenged window; settles to the proposed outcome,
  pays the proposer their bond back plus half of any losing challenger bond.
- `councilResolve(uint8 outcome, string evidenceURI)` — 3-of-5 council multisig, only reachable
  in escalation. Stand-in for a DVM-style vote until a token exists.
- `cancel()` — resolver may cancel at ANY time while Active (early-cancel is safe because cancel
  refunds every participant in full). Cancels also clear an open proposal round and return bonds.
- `timeoutCancel()` — permissionless. If a market is past `closeTime + resolutionTimeout`
  (default 14 days) and still not Resolved, anyone may cancel it. This is the escape hatch that
  guarantees funds can never be stranded by a lost resolver key.

**Bond economics.** Winner of a disputed round receives their bond plus half the loser's bond;
the other half goes to the protocol fee recipient. This is exactly UMA's live incentive shape
on Polymarket ($750 bond, +50% on a won dispute): proposing honestly is profitable,
spam-challenging is expensive. UMA's track record (~98.5% of proposals settle unchallenged)
says the window is a deterrent that almost never fires — so its cost to honest UX is one
2-hour delay, nothing more.

**Conflict-of-interest rule.** The seeding wallet and the proposing wallet must be different
addresses on mainnet (the audit's C4). On testnet the agent may do both, but the contract should
already expose `seeder` vs `resolver` roles so the split is a config change, not a migration.

## Rollout order

1. Phase A1 (jury) — pure app change inside `auto-resolve`, lowest risk, biggest credibility win.
2. Phase A2 (proposal window) — needs one table + notification hook, makes settlement observable.
3. Phase A3 (clarifications) — small; rides the existing metadata-overrides table.
4. Phase B contract + tests + new factory deployment, then point the agent at V2 for new markets.

## Open questions for review

- Challenge bond size on testnet (1 USDC keeps it accessible; too low invites noise).
- Council composition before mainnet (who are the 5 signers?).
- Whether `timeoutCancel` should pay a small bounty to the caller (gas is near-free on Arc, so
  probably unnecessary).
