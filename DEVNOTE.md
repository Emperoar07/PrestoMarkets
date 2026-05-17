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
* Always use Circle MCP before making Circle wallet, paymaster, bridge, gateway, or USDC rail decisions.
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
* Live Arc factory reads and writes
* Live market actions for approval, buy, resolve, claim, and refund

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

Use Arc MCP for every Arc-specific design or implementation decision before making code changes. Use Circle MCP for every Circle-specific wallet, paymaster, bridge, gateway, or USDC rail decision before making code changes.

MCP server:

```text
https://docs.arc.io/mcp
```

Circle MCP server:

```text
https://api.circle.com/v1/codegen/mcp
```

Setup guide:

```text
https://docs.arc.io/ai/mcp
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

VS Code MCP config is also checked into `.vscode/mcp.json`.

Use MCP before implementing anything that depends on Arc App Kit, Paymaster, Gateway, Wallets, CCTP, Bridge Kit, Arc account abstraction, Arc chain behavior, Circle User-Controlled Wallets, Circle Paymaster, Circle Gateway, Circle Bridge Kit, Circle CCTP, or Arc AI agent standards.

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
* UI copy based on Arc prediction market positioning
* Roadmap and rail planning pages
* Live Arc factory reads for deployed market discovery
* Live Arc factory writes for market creation
* Live market transactions for USDC approval, buy, resolve, claim, and refund flows
* Market filters for prediction, opinion, opportunity, open, closing soon, resolved, canceled, draft, and onchain markets
* Circle User-Controlled Wallet endpoint scaffolding for user sessions, email/social device tokens, initialization challenges, and wallet listing
* Branded Circle wallet onboarding panel with official Circle email OTP flow and external wallet fallback
* Google social login hook through Circle Web SDK when the OAuth Web Client ID is configured in Circle Console and public env vars
* Circle Web SDK challenge execution for user initialization
* External EOA wallet fallback while Circle credentials and onboarding settings are configured
* Connected-account share reads for portfolio positions
* Claim and refund availability reads per connected account
* Recent account activity from Arc market logs
* Resolver-aware UI that locks resolve and cancel actions to the configured resolver wallet

Next work:

* Configure the production Google OAuth Web Client ID in deployment env vars if Google sign-in should be live
* Expand recent event reads into a persistent indexed account history
* Expand production hardening notes into reviewed audit findings and approved dispute or bond design

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

* Review `docs/PRODUCTION_HARDENING.md` before real value
* Turn the dispute and bond placeholder into a concrete protocol design before real-value launch

Latest Arc Testnet deployment:

* `PrestoMarketFactory`: `0xB5FA65ae7c76b2DeecA1906848e8805df6dCF807`
* USDC collateral: `0x3600000000000000000000000000000000000000`
* Deployer: same local Presto deployer used by `C:\Users\bolaj\tempo-mini-dex`
* Deployment record: `data/arc-testnet.json`

## Recommended Next Scope

The safest next scope is account-aware live app depth.

Order:

1. Configure Circle social provider settings in Circle Console and deployment env vars if Google sign-in should be enabled.
2. Expand recent event reads into a persistent indexed account history.
3. Review the production hardening gate and turn dispute or bond placeholders into a concrete protocol design before real value beyond testnet.

Circle User-Controlled Wallet note:

* Circle's official User-Controlled Wallet model does not expose raw private-key export. The app should support user-owned signing, wallet recovery, copy address, and disconnect instead of promising seed phrase or private-key export.

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

Partially wired:

* Wallets
* Circle App Kit API key is stored as `CIRCLE_APP_KIT_API_KEY` for future Circle App Kit rail work

Planned:

* Paymaster
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
We are in C:\Users\bolaj\presto-markets. Read DEVNOTE.md and README.md first. Continue Presto Markets from Phase 2 and Phase 3. Use Arc MCP for Arc specific decisions and Circle MCP for Circle wallet or rail decisions. Keep live contract wiring honest and do not add AMM, AI resolution, USYC, or later rails without MCP-backed design.
```
