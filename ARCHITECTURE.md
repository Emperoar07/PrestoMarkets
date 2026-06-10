# Architecture

## Stack

- **Frontend.** Next.js 16 with App Router, TypeScript, Tailwind CSS.
- **Chain.** Arc Testnet (chain ID 5042002), USDC as native gas.
- **Chain Interaction.** viem publicClient for reads and walletClient for writes. No indexer; reads hit Arc RPC directly.
- **Wallets.** Circle user-controlled wallets (email/Google/PIN onboarding) or any EVM wallet via external connection.
- **Hosting.** Vercel for the app and API routes. The agent ticks every 2 hours via a GitHub Actions workflow (market factory, auto-resolve, liquidity seeding backfill, image backfill, leaderboard refresh), with a daily Vercel cron as a fallback heartbeat.
- **LLM Stack.** Anthropic Claude as primary, with Gemini, Groq, Mistral, OpenRouter, Cerebras, Together, and Hugging Face as fallbacks.

## Contracts

- `PrestoMarketFactory.` Registry of all markets, emits MarketCreated events.
- `PrestoMarket.` One contract per market for shares, collateral, and resolution state.
- `PrestoMultiOutcomeMarketFactory.` Factory for opinion poll markets with 3 to 12 outcomes.
- USDC and EURC ERC-20 contracts for collateral.
- `IdentityRegistry` (ERC-8004). Agent identity and track record registered onchain.

## Transaction Paths

Three signing flows handle all onchain writes:

| Path | Signer | Flow |
|---|---|---|
| External EOA | User's MetaMask/web3 wallet | viem walletClient.writeContract direct to Arc RPC |
| Circle UCW | Circle MPC keyshares | Server POST to Circle API, user PIN challenge, Circle broadcasts |
| Autonomous Agent | Server AGENT_PRIVATE_KEY | Vercel server signs and broadcasts, gated by PRESTO_AGENT_API_KEY |

All three converge on the same contract functions: createMarket, buy, resolve, cancel, claim, refund.

## Agent Orchestration Architecture

The autonomous agent runs a five-phase orchestration system:

```
Queue → Graph Orchestrator → Provider Pool → Pipeline Stages → Arc Testnet
```

1. **Perceive.** Fetch trends from Cointelegraph, CoinDesk, ESPN, X, CoinGecko, and other sources. Cluster related news by fuzzy title matching.

2. **Analyze.** Classify each trend as Prediction or Opinion market type. Score cross-outlet momentum using Serper API.

3. **Plan.** Draft market structure with LLM: outcome categories, resolution criteria, close date. LLM sees the trend, platform context, and market type guidance.

4. **Authorize.** Safety check with LLM: does the question meet minimum quality thresholds? Is it resolvable? Are the outcomes balanced? Is there regulatory risk?

5. **Execute.** Submit the market to Arc via agentWallet.ts. Agent private key signs the transaction. Receipt recorded.

6. **Verify.** Poll Arc until MarketCreated event appears. Record market address and agent track record.

If any stage fails, the request lands in a dead letter queue for inspection and manual retry.

## Durable Execution

The agent request queue handles async processing, deduplication, and failure recovery:

- **Idempotency keys** prevent duplicate market creation if a request is resubmitted.
- **State machine** tracks each request: pending → processing → completed or failed or retrying.
- **Exponential backoff** retries failed requests with increasing delays.
- **Dead letter queue** preserves failed requests permanently for inspection.
- **Checkpoint persistence** lets long-running operations pause and resume from the last successful stage.

## LLM Provider Pool

The system manages multiple LLM providers with circuit breaker resilience:

- **Primary.** Anthropic Claude 3.5 Sonnet.
- **Fallbacks.** Groq, OpenRouter, Cerebras, Together.
- **Circuit breaker.** If a provider fails 3 times in 5 minutes, mark it unavailable for 5 minutes. Only use fallbacks until recovery.
- **Per-provider metrics.** Track latency, error rate, availability so the operator can see health at a glance.

## Key Files

Agent orchestration:

```
src/lib/agentOrchestrator.ts      Unified orchestrator coordinating all phases
src/lib/agentGraph.ts             State machine with checkpoint persistence
src/lib/agentQueue.ts             Request queue, deduplication, failure recovery
src/lib/agentStages.ts            Six-stage pipeline: perceive, analyze, plan, authorize, execute, verify
src/lib/agentPipeline.ts          Trend fetching, classification, drafting, safety checks
src/lib/providers/base.ts         Abstract LLM provider interface
src/lib/providers/anthropic.ts    Anthropic provider implementation
src/lib/providers/pool.ts         Provider pool with circuit breaker
src/lib/agentMcp.ts               MCP tool and resource definitions
src/lib/agentContext.ts           Shared platform context for all agent prompts
```

API routes:

```
app/api/agents/orchestrate/       Market creation trigger and health checks
app/api/agents/graphs/            Graph execution and pause/resume
app/api/agents/queue/             Queue metrics, dead letter inspection, resubmit
app/api/cron/agent-queue/         Autonomous cron job (every 10 minutes)
app/api/mcp/agent/                MCP protocol endpoint for external agents
app/api/circle/wallet/*           Circle wallet proxy and transaction polling
app/api/v1/markets/               Market reads and listings
```

User interactions:

```
src/lib/liveActions.ts            EOA signing path; delegates to circleActions for Circle users
src/lib/circleActions.ts          Circle contract-execution flow and transaction polling
src/lib/agentWallet.ts            Server-side agent EOA for autonomous signing
src/lib/onchainMarkets.ts         Factory and market reads via viem
src/lib/costBasisIndexer.ts       Client-side incremental indexer for portfolio P&L
```

## Data Flow on Trade

1. User clicks "Buy YES" with amount.
2. `placeTrade` in appState routes to liveActions.
3. **External wallet path:** viem signs USDC approve and market buy, broadcasts both directly.
4. **Circle path:** Server creates two contract-execution challenges, user PIN-confirms, Circle MPC signs and broadcasts, client polls until confirmed.
5. On success, UI refreshes markets and portfolio by calling publicClient reads.

## Portfolio Tracking

Cost basis is computed from chain events. The `costBasisIndexer` maintains per-(account, market) checkpoints in localStorage and pages new blocks on subsequent loads. This avoids scanning from block 0 on every page load.

## Agent Autonomous Operation

The agent runs continuously via Vercel cron:

1. Every 10 minutes, the cron job hits `/api/cron/agent-queue`.
2. Verifies CRON_SECRET header (Bearer token, constant-time comparison).
3. Checks orchestrator health (provider status, queue depth).
4. Processes up to 3 pending requests from the queue.
5. Returns metrics and results.

If a request takes longer than 60 seconds (timeout), it lands in the dead letter queue for manual inspection.

The agent has its own ERC-8004 identity on Arc (`AGENT_ERC8004_ID`). All markets it creates record that identity as resolver. Traders can see the agent's track record: which markets it created, when, and what happened to them.

## Monitoring and Observability

Health check endpoint `/api/agents/orchestrate/health` returns:

- Orchestrator status: healthy, degraded, or error.
- Provider health: per-provider latency, success rate, circuit breaker state.
- Queue depth: pending, processing, retrying, completed, failed.
- Timestamp: when the health check ran.

Queue metrics endpoint `/api/agents/queue/metrics` returns counts and averages:

- Total requests, pending, processing, completed, failed, retrying.
- Average retries per request.
- Idempotency stats.

Comprehensive monitoring guides live in the docs directory:

- `docs/TESTNET_OPERATIONS.md` covers daily checks, common tasks, troubleshooting.
- `docs/TESTNET_MONITORING.md` covers metrics, alerts, failure recovery, performance baselines.
- `docs/TESTNET_DEPLOYMENT.md` covers environment setup, verification, and rollback.
