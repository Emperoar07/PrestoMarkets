# Presto Markets Handoff

This note is for the next chat so we can continue quickly without rebuilding context from scratch.

## Crucial Memory

These are the things the next chat should not rediscover or change casually.

* Presto Markets is a separate product and repo. Do not merge it back into Presto DEX.
* Keep the Presto brand family: dark navy, cyan, rounded cards, strong typography, and clean plain copy.
* The product is public by default. Opportunity markets do not need privacy on Arc.
* Use USDC first. Do not introduce USYC yield until the accounting and redemption math is separately reviewed.
* The first real implementation path should be contract tests, Arc Testnet deployment, then live UI wiring.
* Do not replace market contracts with Arc App Kit. App Kit is a rail layer for funding, sending, bridging, wallets, and paymaster flows.
* Always use Arc MCP before making major Arc specific architecture decisions.
* Keep V1 simple: manual resolver, clear source of truth, evidence URI, public settlement, claim and refund flows.
* Do not add autonomous AI resolution until disputes, bonds, failed agent behavior, and override rules are designed.
* Do not add AMM pricing until fixed share markets work safely.
* Market creation should support prediction, opinion, and opportunity markets.
* The copy should stay humane, precise, and straightforward. Avoid hype and avoid unnecessary hyphens.
* GitHub repo is `https://github.com/Emperoar07/PrestoMarkets`.
* Local repo is `C:\Users\bolaj\presto-markets`.

## Current State

Presto Markets is a separate repo from Presto DEX.

GitHub repo:

```text
https://github.com/Emperoar07/PrestoMarkets
```

Local repo:

```text
C:\Users\bolaj\presto-markets
```

The app is a Next.js project with the Presto dark navy and cyan brand style. It already has:

* Landing page
* Markets list page
* Market create page
* Market detail page
* Portfolio placeholder
* Roadmap page
* Product rail notes for USDC, Paymaster, Wallets, Bridge Kit, CCTP, and Gateway
* Contract scaffold for a simple USDC binary market and market factory

The last confirmed build passed with:

```bash
npm run build
```

## Product Direction

Presto Markets should combine three product ideas:

* Prediction markets inspired by Polymarket
* Opinion markets inspired by Opinion Labs
* Opportunity markets inspired by builder opportunity markets

The phrase is:

```text
Your opinions. Your opportunities. Your predictions.
```

Arc is a strong fit because Presto Markets can use USDC first, stablecoin gas, fast finality, public settlement records, and later multi currency settlement.

Opportunity markets should be public on Arc. They do not need private execution.

## Arc MCP

Use Arc MCP for major Arc design work.

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

Use MCP before implementing anything that depends on Arc App Kit, Paymaster, Gateway, Wallets, CCTP, Bridge Kit, or Arc AI agent standards.

## What App Kit Means Here

Arc App Kit is not replacing the market contracts.

It can help later with:

* USDC movement
* Funding flows
* Bridge flows
* Wallet onboarding
* Stablecoin gas and paymaster UX
* Unified balance or account flows when ready

The core market logic should stay in Presto Markets contracts.

## Phase 0 Done

Phase 0 created the separate app and base product surface.

Completed:

* Repo scaffold
* Presto Markets branding
* Landing page
* Market explore route
* Create route
* Market detail route
* Portfolio route
* Roadmap route

## Phase 1 Done

Phase 1 added a conservative contract base.

Completed:

* `PrestoMarket.sol`
* `PrestoMarketFactory.sol`
* USDC collateral model
* YES and NO fixed share accounting
* Resolver based settlement
* Winner claims
* Canceled market refunds

Important:

Phase 1 does not include AMM pricing, order books, disputes, autonomous AI resolution, or USYC yield accounting.

## Phase 2 Started

Phase 2 is the product workflow phase.

Already started:

* Market kind support for prediction, opinion, and opportunity markets
* Public rules fields
* Source of truth fields
* Templates for macro, policy, governance, product, and builder opportunity markets
* UI copy based on Arc prediction market positioning
* Roadmap and rail planning pages
* Live Arc factory reads for deployed market discovery
* Live Arc factory writes for market creation
* Live market transactions for USDC approval, buy, resolve, claim, and refund flows
* Market filters for prediction, opinion, opportunity, open, closing soon, resolved, canceled, draft, and onchain markets
* App phase readiness checks for Arc chain, USDC address, and market factory address

Next work:

* Add connected-account share reads for the portfolio
* Add indexed activity history for account-level market actions
* Add resolver-only affordances once account ownership is read in the UI

## Phase 3 Started

Phase 3 is protocol hardening.

Already started:

* Market kind is stored in the contract
* Protocol fee recipient exists
* Fee cap exists
* Resolution evidence URI exists
* Resolved collateral snapshot exists
* Claim preview helpers exist
* Refund preview helpers exist
* Factory owner controls exist
* Hardhat test harness exists
* `PrestoMarket.sol` tests cover setup, buy YES and NO, buyFor, invalid buys, resolver-only resolution, claim math, protocol fees, cancellation, refunds, and constructor guards
* `PrestoMarketFactory.sol` tests cover setup, market creation, fee controls, ownership controls, and zero collateral guard
* Arc Testnet deploy script exists
* Arc Testnet factory deployment exists
* Arc Testnet factory and USDC addresses are in `.env.example`

Next work:

* Add contract audit notes before real value
* Wire create flow to call `createMarket(...)` on the deployed factory

Latest Arc Testnet deployment:

* `PrestoMarketFactory`: `0xB5FA65ae7c76b2DeecA1906848e8805df6dCF807`
* USDC collateral: `0x3600000000000000000000000000000000000000`
* Deployer: same local Presto deployer used by `C:\Users\bolaj\tempo-mini-dex`
* Deployment record: `data/arc-testnet.json`

## Recommended Next Scope

The safest next scope is to finish the contract test and deployment layer before building more UI.

Order:

1. Add Hardhat or Foundry setup.
2. Add tests for `PrestoMarket.sol`.
3. Add tests for `PrestoMarketFactory.sol`.
4. Deploy factory to Arc Testnet.
5. Add deployed addresses to environment variables.
6. Wire the create page to deploy real markets.
7. Wire the markets page to read markets from the factory.
8. Wire the detail page to buy shares, resolve, cancel, claim, and refund.

This keeps the UI honest because the app starts reading real contract state early.

## Design Rules

Keep the Presto DEX visual DNA:

* Dark navy background
* Cyan primary actions
* Rounded cards
* Strong typography
* Plain language
* No noisy glass style
* No over complicated dashboards before the contract flow works

Landing page can be different from Presto DEX, but it should still feel like the same family.

## Market Types

Prediction markets:

* Objective future outcome
* Example: Will a macro report come in above a threshold?
* Needs clear source of truth

Opinion markets:

* Sentiment and preference discovery
* Example: Which product direction should a community back?
* Needs clear voting or settlement rule

Opportunity markets:

* Public builder or ecosystem opportunity discovery
* Example: Which Arc app category should builders focus on next?
* Should be public and easy to create

## Circle Product Choices

Current:

* USDC
* Contracts

Planned:

* Paymaster
* Wallets
* Bridge Kit
* CCTP
* Gateway

Do not mark planned rails as live until they are actually wired and tested.

## Safety Notes

Keep V1 simple:

* USDC collateral first
* Public markets first
* Manual resolver first
* No USYC yield until math is reviewed separately
* No autonomous AI resolution until disputes and bonds are designed
* No private opportunity markets
* No complex AMM until fixed share markets work safely

## First Prompt For Next Chat

Use this:

```text
We are in C:\Users\bolaj\presto-markets. Read DEVNOTE.md and README.md first. Continue Presto Markets from Phase 2 and Phase 3. Use Arc MCP for Arc specific decisions. Start by adding contract tests and a safe Arc Testnet deployment path before wiring the UI to live contracts.
```
