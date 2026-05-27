# Presto Markets

Presto Markets is a prediction market app built for Arc, Circle's stablecoin native L1. People come here to spin up public markets in a couple of clicks, trade USDC-settled outcome shares with optional EURC-to-USDC payments, and follow the same signal data the platform itself reads from. Every market is its own onchain contract, every settlement is published with evidence, and every agent-created market carries a visible audit trail so traders always know what they are looking at.

The idea is simple. Prediction markets work best when the rails feel native, when stablecoins are the default unit of account, and when the path from "interesting question" to "live, tradable market" takes less than a minute. Arc gives us that foundation. Presto layers a calm, editorial interface on top of it, backed by an autonomous agent that watches global trends and creates markets on a daily cadence.

## What you can do

**Create markets in three flavors.** Prediction markets resolve from an external source of truth. Opinion markets resolve from community vote. Opportunity markets resolve from ecosystem signal like builder activity or capital flow. Each one accepts a close date, up to four categories, a description, an image, optional multi-outcome poll options, and a resolver of your choosing.

**Trade with stablecoins.** Buy YES or NO shares with USDC. EURC payments route through the Circle App Kit swap so users holding euros never need to think about preswapping. Market orders execute against the live share contract. Limit orders are coming soon.

**Add balanced liquidity.** Liquidity providers split a single deposit into balanced YES and NO depth, which gives every fresh market clean starting odds and a readable signal.

**Settle with confidence.** Resolvers post evidence URIs that the contract stores forever. Agent-assisted markets can settle automatically after close when evidence from their declared sources reaches the confidence threshold. Uncertain markets remain pending review.

**Watch the agent at work.** The Presto Markets agent runs on a daily cadence, reads live trend signals from a dozen sources, ranks them by cross-outlet momentum, and creates the few markets that clear a composite signal threshold. The agent has its own ERC-8004 identity, its own wallet, and its own activity feed on the app.

## How it is built

Presto Markets sits on a small set of well-chosen rails. The goal was to pick tools that map cleanly to the product story and to avoid abstractions that hide what the chain is actually doing.

**Arc Testnet, USDC native gas.** Every market is its own contract deployed by the Presto factory. Settlement is in USDC. EURC bought through Circle App Kit auto-swaps into USDC at signing time. The multi-outcome factory handles poll markets with three to twelve outcomes.

**Next.js 16 App Router.** Server components do the data fetching for trend feeds, news summaries, and onchain reads. Client components own the trading flow, wallet state, and live odds. Tailwind handles the visual system.

**Wallet rails through Circle and viem.** Circle User Controlled Wallets give first-time users an email plus PIN onboarding experience that feels closer to a consumer app than a web3 wallet. External EVM wallets connect through the same surface for users who already carry MetaMask or similar. Session tokens auto-refresh so the trading flow does not interrupt a working trader.

**Autonomous agent orchestration.** The agent runs on a five-phase orchestration system: perceive (read trends), analyze (classify by market type), plan (draft market with LLM), authorize (safety checks), execute (deploy onchain), and verify (confirm settlement). The orchestrator manages this pipeline with checkpoint persistence so long-running operations can pause and resume. A durable request queue handles async processing, deduplication, and failure recovery. Dead letter queues preserve failed requests for inspection and retry.

**Agent pipeline with LLM fallback chains.** The agent pipeline reads trends, classifies each one against the platform's market type guidance, drafts a market with the right close date for the topic horizon, runs a safety check, and only deploys if the composite of momentum and safety crosses the bar. Every prompt receives the same shared platform context so the agent stays aware of new app features as the codebase evolves. The model rotation runs Anthropic Claude first, then Groq, OpenRouter, Cerebras, and Together as fallbacks so a single provider hiccup never silences the agent.

**Trend ingestion.** The agent reads Cointelegraph, Decrypt, The Block, CoinDesk, BBC, TechCrunch, Hacker News, Google News, ESPN, TheSportsDB football fixtures, LiveScore, X via Grok live search, and live CoinGecko prices for BTC, ETH, SOL, and ARC. News stories get clustered by fuzzy title fingerprint so a single event covered by five outlets ranks higher than five separate stories.

**Agent resolution oracle.** For agent-resolved testnet markets, the configured resolver can submit a high-confidence outcome supported by declared-source evidence. Missing or inconclusive evidence leaves a market pending review and never automatically cancels it. Interactive resolver tools retain a controlled evidence-review workflow before a signed Arc transaction.

**Observability and monitoring.** Activity page, market news tie-ins, agent identity card, and per-market audit trails are driven by the same data the agent itself reads from. What the agent sees, the user sees. The testnet operations suite includes health checks, queue metrics, provider status monitoring, and failure recovery procedures documented in TESTNET_OPERATIONS.md and TESTNET_MONITORING.md.

## Build rails

The day-to-day stack:

1. **Next.js 16 + TypeScript + Tailwind** for the app shell.
2. **viem + Arc Testnet RPC** for every onchain read and write.
3. **Circle App Kit** for user-controlled wallets, swaps, and tx receipts.
4. **Anthropic, Groq, OpenRouter, Cerebras, Together** as the LLM fallback chain.
5. **Grok, Serper, CoinGecko, TheSportsDB, ESPN** as the trend ingestion mesh.
6. **Vercel cron jobs** for autonomous agent operations and queue processing.
7. **ERC-8004 agent identity** registered onchain so the agent's track record is verifiable.

The repo is organized so each rail lives in one obvious place:

- `src/lib/agentOrchestrator.ts` owns the five-phase orchestration system.
- `src/lib/agentGraph.ts` owns checkpoint persistence and state machine routing.
- `src/lib/agentQueue.ts` owns async request processing and failure recovery.
- `src/lib/agentPipeline.ts` owns the perceive-analyze-plan-authorize-execute-verify stages.
- `src/lib/providers/pool.ts` owns LLM provider abstraction and circuit breaker logic.
- `src/lib/agentContext.ts` owns the shared platform context.
- `src/lib/circleActions.ts` owns the Circle wallet path.
- `src/lib/liveActions.ts` owns the external wallet path.
- `app/api/agents/*` owns the orchestrator, graph, and queue API endpoints.
- `app/api/cron/*` owns the autonomous agent execution trigger.
- `app/api/news/*` owns the feed and trend endpoints.

## Roadmap

Where Presto Markets is going during testnet:

**Testnet stability and scale.** Hardening the agent orchestrator for high-volume testing. Improving queue throughput for concurrent market creation. Adding comprehensive monitoring dashboards. Stress testing with synthetic trends.

**Cross-market liquidity rebalancer.** A scheduled rebalance pass that watches volume drift across the agent's market book and gently moves depth toward the busiest contracts so live markets always have responsive odds.

**Agent publication and discovery.** The agent posts its market creation rationale to the app and to X automatically, with the trend link, the momentum and safety scores, and a quick read of why the topic cleared the bar. Same audit trail, broader reach.

**Resolver quality metrics.** Tracking resolver accuracy and speed across different market types. Building resolution leaderboards and reputation scoring.

**Order book contract phase.** The current Limit toggle in the trade panel is the UX placeholder for a true onchain order book. The next contract revision lands the matching engine and turns that toggle live.

**Cross-market opinion baskets.** Bundled positions across linked opinion markets so users can express a thesis like "the next L2 narrative" with a single signed transaction.

**Resolution court.** A dispute window after every resolver signs so high-stakes markets can be flagged, re-evaluated by a second resolver, and corrected before claims open.

## Running locally

```bash
npm install
cp .env.local.example .env.local   # fill in the keys you have
npm run dev
```

Testnet USDC is available from https://faucet.circle.com. The `.env.local.example` file lists every key the app reads. The agent pipeline gracefully no-ops on missing trend providers so you can boot the app with a minimal env and add keys as you wire each rail.

To test the agent orchestrator locally:

```bash
npm run agent-cli      # Interactive CLI for trend fetching, market drafting, and creation
npm run dev            # Start the app in another terminal
```

For comprehensive testnet documentation, see:

- `docs/TESTNET_OPERATIONS.md` for daily operations and common tasks.
- `docs/TESTNET_MONITORING.md` for metrics, alerts, and failure recovery.
- `docs/TESTNET_DEPLOYMENT.md` for full environment setup and verification procedures.

## Project layout

```
app/
  api/
    agents/             Agent orchestrator, graph, queue, and MCP API routes
    cron/               Autonomous agent execution triggers
    circle/             Circle wallet integration endpoints
    news/               Trend feed and news ingestion endpoints
    swap/               Market trading and resolution endpoints
  
src/
  components/           Client and server components
  lib/
    agents/             Agent orchestrator, graph orchestration, pipeline stages
    providers/          LLM provider abstraction and circuit breaker
    agentQueue.ts       Durable request queue with failure recovery
    agentContext.ts     Shared platform context for agent prompts
    circleActions.ts    Circle wallet integration
    liveActions.ts      External wallet integration
    agentMcp.ts         MCP tool and resource definitions

contracts/              Solidity sources for Presto markets and factories
scripts/
  agent-cli.ts          CLI tool for testing agent locally
  deploy/               Contract deployment scripts

docs/                   Comprehensive testnet documentation
data/                   Network configuration snapshots
```

## License

MIT.
