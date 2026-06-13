# EURC on Presto — plan & recommendation

Date: 2026-06-13. Sources: Circle docs MCP, Arc docs MCP, circlefin/arc-prediction-markets.
Question: what's the best way to make use of EURC (euro stablecoin) on Presto?

## Verified facts

**EURC is live and native on Arc Testnet.**
- Address `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`, **6 decimals** (same as USDC), standard ERC-20.
- Testnet EURC from the Circle faucet: faucet.circle.com → Arc Testnet → EURC.
- Arc is explicitly multi-stablecoin: "Native support for USDC and EURC… use Swap to exchange between currencies."

**Cross-chain EURC also exists** (Base Sepolia `0x8084…359F`, Ethereum Sepolia `0x0821…94D4`, Avalanche Fuji `0x5E44…5c6B`) — but note: **Gateway and CCTP Bridge are USDC-only**. Arc's Unified Balance and Bridge are USDC-only too. So EURC is best treated as a **same-chain Arc asset**, funded by faucet or acquired via in-app swap, not bridged.

**Arc has native USDC↔EURC Swap** (App Kit Swap; on Arc Testnet: USDC, EURC, cirBTC). This is the unlock — a USDC holder can get EURC in-app to trade a euro market.

**The decisive advantage — Presto is already collateral-agnostic.**
- `PrestoMarket`'s constructor takes `collateral_` (any IERC20); only the *factory* pins one collateral (`immutable collateral`).
- The Circle sample, by contrast, is **hardcoded to ARCT** and not collateral-agnostic.
- => **EURC markets require ZERO new contracts.** Deploy `PrestoMarketFactory(EURC)` +
  `PrestoMultiOutcomeMarketFactory(EURC)` and Presto's existing multi-factory reader picks them up.

## Recommendation: EURC as a distinct, euro-denominated market collateral

Keep USDC primary. Add EURC as a **clearly-labeled separate collateral**, never mixed into the
same pool (matches the earlier #33–37 guidance). A market is either a USDC market or a EURC
market; its volume, odds, payout, and settlement are all in that currency.

### Phase 1 — Foundations (no contracts, low risk)
- Read EURC balance on Arc (extend `walletBalance`/`StableSymbol` to include EURC, addr above).
- Add EURC faucet link in the Add-USDC drawer ("Get test EURC").
- A `collateral` field already flows through market metadata? If not, add `collateral: 'USDC' | 'EURC'`
  to market metadata so the UI can label and format. Format helper: € vs $ by collateral.

### Phase 2 — EURC markets (one deploy, no new contract code)
- Deploy `PrestoMarketFactory(EURC)` + `PrestoMultiOutcomeMarketFactory(EURC)` (same bytecode,
  EURC collateral). Add their addresses to env; the existing multi-factory reader lists their
  markets automatically.
- Tag markets from the EURC factories as EURC collateral (by factory address → collateral map).
- Market page + cards: a "EURC" badge and €-denominated amounts. Trade panel spends EURC;
  `buildFixedShareQuote` is currency-agnostic already (1 token = 1 share).
- Create-market UI: collateral selector (USDC default, EURC option) shown on creation only.

### Phase 3 — In-app FX (the Arc-native differentiator)
- In the funding drawer / trade panel: when a user holds USDC but wants to trade a EURC market,
  offer "Swap USDC → EURC" via Arc App Kit Swap (sub-second, on-chain, transparent rate +
  configurable slippage). This is the "trade in your currency" UX no other chain makes this easy.

### Phase 4 — Agent localization
- The agent creates EURC-denominated markets for euro-relevant topics: ECB rate decisions,
  EUR/USD, European elections, Euro-zone CPI, European football priced in EUR. A localization
  play that uses the euro rails meaningfully rather than as a gimmick.

## Risks / guardrails
- **Don't auto-convert** USDC↔EURC silently; swap is always an explicit user action (#37).
- **Don't pair native-USDC against ERC-20-USDC** in any pool (Arc: same asset) — irrelevant here
  since EURC is a distinct token, but keep collateral strictly one token per market.
- Gas is always USDC on Arc even for EURC markets (USDC is the gas token) — users need a little
  USDC for gas regardless. Surface that in the EURC funding note.
- EURC cross-chain is limited (no Gateway/CCTP) — fund EURC via faucet or in-app swap, not bridge.

## Bottom line
EURC is a **low-cost, high-differentiation** addition because Presto's contracts are already
collateral-agnostic: euro markets are a factory deploy + UI labeling, and Arc's native USDC↔EURC
swap turns it into a genuine multi-currency prediction market. Recommended order: Phase 1 (now,
safe) → Phase 2 (one deploy) → Phase 3 (swap) → Phase 4 (agent).
