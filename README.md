# Presto Markets

Presto Markets is a public Arc Testnet market platform for predictions, opinions, and opportunity discovery.

Product line: > Your opinions. Your opportunities. Your predictions.

This repository is separate from Presto DEX. It keeps the same dark navy and cyan brand language, but the product is focused on markets 

## Arc Blueprint Positioning

Presto Markets follows the Arc prediction market blueprint. The goal is to make uncertainty tradable while keeping the experience grounded in USDC, predictable costs, fast settlement, and clear rules.

Core scope:

* USDC comes first as the market collateral.
* Markets should act as public signal infrastructure, not only betting flows.
* Small trades should feel practical because Arc uses stablecoin gas.
* Every market needs clear rules, a source of truth, resolver evidence, and an auditable result.
* EURC and other stable settlement paths can come later once the USDC version is safe.
* Higher trust civic, enterprise, and institutional markets should be possible later with stronger controls.

## Phase 0

* Separate Next.js app scaffold.
* Presto branded landing page.
* Explore markets page.
* Create market page.
* Market detail page.
* Portfolio placeholder.
* Arc environment placeholders.

## Phase 1

* Minimal binary USDC market contracts.
* Market factory contract.
* Fixed share accounting.
* Explicit resolver based settlement.
* Winner redemption and canceled market refunds.

Phase 1 is intentionally conservative. It does not include AMM pricing, autonomous AI resolution, disputes, or USYC yield accounting yet.

## Phase 2

* Richer market metadata for prediction, opinion, and opportunity markets.
* Public rule fields and source of truth fields.
* Market activity fields for the UI and future indexing.
* A create flow that separates current rails from planned rails.
* A roadmap page for product and protocol phases.
* Arc focused positioning around market signals and information discovery.
* Templates for macro, policy, governance, product, and builder opportunity markets.
* Shared client side app state for local market creation, demo trading, and portfolio review before wallet reads are connected.
* App phase readiness checks for Arc chain, USDC address, market factory address, demo wallet connection, and demo USDC allowance.
* Market filters for prediction, opinion, opportunity, open, closing soon, resolved, canceled, draft, and locally created markets.
* Draft market creation and local market status review controls.
* Read-only Arc Testnet factory integration for live market discovery.
* Mock portfolio positions and activity states for review before wallet reads are connected.

## Phase 3

* Market kind stored at contract creation.
* Protocol fee recipient and fee cap scaffolding.
* Resolution evidence URI on settlement.
* Resolved collateral snapshot for stable winner payouts.
* Claim and refund preview helpers.
* Factory owner controls for fee configuration.
* Settlement records that support auditability and higher trust market workflows.
* Hardhat contract test harness for market and factory behavior.

Phase 3 is still a scaffold. It prepares the repo for deployment planning, but the contracts still need tests and audit before live value.

## Later Scope

* EURC settled markets for European and FX sensitive outcomes.
* Multi currency market creation and settlement after V1 is stable.
* Paymaster support so users can pay participation costs in stablecoin terms.
* Bridge Kit and CCTP funding paths for users arriving from other supported chains.
* Wallet onboarding for less crypto native users.
* Agent assisted resolution after dispute, bond, and failure paths are designed.

## Arc App Kit

Arc App Kit is product infrastructure for movement and funding rails. It can help with USDC sends, bridge flows, swap or funding flows, and unified balance later.

It does not replace the custom market contracts.

## Circle Product Rails

Current integration scope:

* USDC
* Contracts

Planned integration scope:

* Paymaster for USDC gas flows.
* Wallets for smoother onboarding.
* Bridge Kit and CCTP for cross chain USDC funding.
* Gateway for unified USDC balance once the account model is ready.

These planned rails should only be marked live after wallet, funding, and settlement flows are tested end to end.

## Arc MCP

Use Arc MCP for major Arc specific design decisions.

MCP server:

```text
https://docs.arc.io/mcp
```

Cursor config:

```json
{
  "mcpServers": {
    "arc-docs": {
      "url": "https://docs.arc.io/mcp"
    }
  }
}
```

## Development

```bash
npm install
npm run dev
```

Contract tests:

```bash
npm run test:contracts
```

Deploy factory to Arc Testnet:

```bash
npm run deploy:arc
```

Copy `.env.example` to `.env.local` when deployment addresses are available.

Arc Testnet deployment:

```text
PrestoMarketFactory: 0xB5FA65ae7c76b2DeecA1906848e8805df6dCF807
USDC collateral: 0x3600000000000000000000000000000000000000
Deployment record: data/arc-testnet.json
```

## Safety Notes

* Keep V1 public only.
* Use USDC collateral first.
* Do not add USYC yield accounting until reward and redemption math is separately audited.
* Do not add autonomous AI resolution until resolver bonds, disputes, and failure paths are designed.
