# Presto Markets Handoff

This note is for the next chat so we can continue quickly without rebuilding context from scratch.

## Crucial Memory

These are the things the next chat should not rediscover or change casually.

* Presto Markets is a separate product and repo. Do not merge it back into Presto DEX.
* Keep the Presto brand family: dark navy, cyan, rounded cards, strong typography, and clean plain copy. No em-dashes or rhetorical hyphens in documentation.
* The product is public by default. Opportunity markets do not need privacy on Arc.
* Use USDC first. Do not introduce USYC yield until the accounting and redemption math is separately reviewed.
* The autonomous agent runs on Arc Testnet with a five-phase orchestration system. It is live and running.
* Do not replace market contracts with Arc App Kit. App Kit is a rail layer for funding, sending, bridging, wallets, and paymaster flows.
* Always use Arc MCP before making major Arc-specific architecture decisions.
* Always use Circle MCP before making Circle wallet, paymaster, bridge, gateway, or USDC rail decisions.
* Keep V1 simple. We are not planning mainnet yet. Focus on testnet stability and scale.
* Agent autonomous resolution is implemented and running. Markets settled by agent require declared-source evidence to meet confidence threshold.
* Do not add AMM pricing until fixed share markets work safely on testnet.
* Market creation supports prediction, opinion, and opportunity markets. Agent creates prediction markets autonomously daily.
* Documentation should be human tone, precise, straightforward. Avoid hype and unnecessary hyphens.
* GitHub repo is `https://github.com/Emperoar07/PrestoMarkets`.
* Local repo is `C:\Users\bolaj\presto-markets`.
* Comprehensive documentation exists in docs/ directory: TESTNET_DEPLOYMENT.md, TESTNET_MONITORING.md, TESTNET_OPERATIONS.md, ARCHITECTURE.md, ABOUT.md.

## Current State

Presto Markets is a separate repo from Presto DEX and is live on Arc Testnet.

GitHub repo:

```text
https://github.com/Emperoar07/PrestoMarkets
```

Local repo:

```text
C:\Users\bolaj\presto-markets
```

The app is a Next.js 16 project with the Presto dark navy and cyan brand style. Current features:

* Landing page
* Markets list page with filtering (prediction, opinion, opportunity)
* Market create page (manual creation)
* Market detail page with live trading
* Portfolio and My Shares page with cost basis tracking
* Autonomous agent market creation on daily cadence
* Live Circle User-Controlled Wallets (email OTP, social login, PIN)
* External EVM wallet support via MetaMask
* Live Arc factory reads and writes
* Live market actions: approval, buy, sell, resolve, claim, refund
* Agent orchestration system (perceive, analyze, plan, authorize, execute, verify)
* Durable request queue with checkpoint persistence
* LLM provider pool with circuit breaker fallback
* Health monitoring and observability endpoints
* Autonomous cron job (every 10 minutes)

The last confirmed build passed with:

```bash
npm run build
npm run typecheck
```

TypeScript compilation passes with zero errors.

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
* Docs and rail planning pages
* Live Arc factory reads for deployed market discovery
* Live Arc factory writes for market creation
* Live market transactions for USDC approval, buy, resolve, claim, and refund flows
* Market filters for prediction, opinion, opportunity, open, closing soon, resolved, canceled, draft, and onchain markets
* Circle User-Controlled Wallet endpoint scaffolding for user sessions, email/social device tokens, initialization challenges, and wallet listing
* Branded Circle wallet onboarding panel with official Circle email OTP, Google, and PIN flows plus external wallet fallback
* Google social login hook through Circle Web SDK with the OAuth Web Client ID configured locally and in Vercel envs
* RainbowKit external EVM wallet provider under the Circle onboarding modal
* Circle Web SDK challenge execution for user initialization
* External EOA wallet fallback while Circle credentials and onboarding settings are configured
* Connected-account share reads for portfolio positions
* Claim and refund availability reads per connected account
* Recent account activity from Arc market logs
* Resolver-aware UI that locks resolve and cancel actions to the configured resolver wallet

Next work:

* Verify Circle Email OTP settings in Circle Console
* Configure `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` if WalletConnect QR should be live in RainbowKit
* Expand recent event reads into a persistent indexed account history
* Expand production hardening notes into reviewed audit findings and approved dispute or bond design

## Phase 3 and Phase 4: Autonomous Agent and Orchestration

Agent implementation is complete and running on testnet.

Implemented and live:

* Agent orchestration system with five phases: perceive, analyze, plan, authorize, execute, verify.
* Graph-based state machine with checkpoint persistence for pause and resume.
* Durable request queue with idempotency, exponential backoff, and dead letter queue.
* LLM provider pool with circuit breaker failover across Anthropic, Groq, OpenRouter, Cerebras, Together.
* Six-stage pipeline: fetch trends, classify by market type, draft market with LLM, safety check, submit onchain, verify settlement.
* Trend ingestion from Cointelegraph, CoinDesk, ESPN, X, CoinGecko, and other sources.
* Autonomous cron job processing every 10 minutes via Vercel.
* Health check endpoints with provider status and queue metrics.
* Comprehensive monitoring and operations documentation.
* Integration test suite validating all phases working together.
* MCP interface for external agents to call Presto agent tools.
* Agent CLI for local testing of agent pipeline.
* Bearer token authentication on all privileged endpoints.

Latest Arc Testnet deployment:

* `PrestoMarketFactory`: `0xB5FA65ae7c76b2DeecA1906848e8805df6dCF807`
* `PrestoMultiOutcomeMarketFactory`: check data/arc-testnet.json
* USDC collateral: `0x3600000000000000000000000000000000000000`
* Agent EOA: registered with ERC-8004 identity registry
* Deployment record: `data/arc-testnet.json`

## Testnet Readiness

The app is ready for testnet operation. What's next:

* **Testnet stability and scale.** Load test agent orchestrator for high-volume requests. Optimize queue throughput. Monitor failure rates and recovery times.
* **Provider performance.** Track LLM latency and success rates. Identify slowest providers. Monitor circuit breaker trips.
* **Queue recovery.** Test dead letter queue inspection and resubmit workflows. Verify exponential backoff behaves correctly.
* **Resolver quality.** Track agent-resolved markets: success rate, settlement time, evidence quality.
* **Documentation iteration.** Collect operational feedback and update TESTNET_OPERATIONS.md based on real usage patterns.

We are not planning mainnet deployment yet. The focus is testnet stability and learning what breaks.

## MCP and External Agents

The agent publishes MCP tools and resources at `/api/mcp/agent`. External agents can call Presto agent tools:

* fetch_trends: fetch live trend signals
* classify_trend: classify as prediction/opinion/opportunity
* draft_market: draft market parameters with LLM
* validate_market: safety checks
* create_market: submit onchain
* resolve_market: settle market

Agents can also read agent status and see autonomous market creation activity.

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

## Safety Notes for Testnet

Current approach:

* USDC collateral only.
* Public markets by default.
* Manual resolver fallback for edge cases.
* Agent-assisted resolution requires declared-source evidence at confidence threshold.
* No USYC yield until math is reviewed separately.
* No private opportunity markets.
* No complex AMM until fixed share markets prove safe at scale.
* Focus on testnet stability, not mainnet preparation.

Before mainnet deployment, we need:

* Security audit by professional firm.
* Dispute and bond protocol design.
* Resolver reputation system.
* Market metadata durability (IPFS or onchain storage).
* Governance setup for protocol parameters.

## First Prompt For Next Chat

Use this:

```text
We are in C:\Users\bolaj\presto-markets. Read DEVNOTE.md, README.md, and ARCHITECTURE.md first. The autonomous agent is live on Arc Testnet with full orchestration (perceive, analyze, plan, authorize, execute, verify), queue processing every 10 minutes, and comprehensive monitoring. We are focused on testnet stability and scale. Use Arc MCP for Arc decisions and Circle MCP for Circle wallet decisions. Do not add mainnet planning, AMM pricing, USYC yield, or complex features without MCP-backed design. Keep documentation in human tone without em-dashes.
```
