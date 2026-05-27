# About Presto Markets

## Vision

Presto Markets exists because prediction markets are a fundamental tool for collective intelligence, but they've never felt native to the web3 stack. The traditional approach ships derivatives on top of disconnected infrastructure: centralized oracles, wrapped stablecoins, fragmented liquidity. Presto asks a different question: what if prediction markets were built first-class on a stablecoin-native chain where every contract is transparent, every settlement is auditable, and the platform's own market creation logic runs as a visible, verifiable agent?

Arc and Circle's stablecoin-native design gave us the technical foundation to try. USDC as native gas means prediction markets become a native financial primitive on the chain, not an afterthought. Every market is its own Solidity contract that anyone can read. Every trade is a visible onchain transaction. Every settlement carries evidence URIs that live forever on the chain.

We layered an autonomous agent on top because markets work best when they're populated with high-signal questions. The agent reads trend signals from dozens of sources, applies the same editorial judgment the platform uses, and creates a few markets per day that cross the bar for momentum and confidence. What the agent sees, the user sees.

## How We Got Here

The project started as a simple question: can we make prediction markets feel like a consumer financial product without losing the transparency that makes them powerful? Not a DeFi protocol. Not a retail casino. A calm, intentional tool for thinking through uncertainty together.

The first version was single-outcome binary markets. Traders could create markets, add liquidity, trade shares, and settle manually. That worked, but it left most of the hard part untouched: how do you keep a market book populated with good questions?

The agent system emerged from that friction. If the platform has opinions about what makes a good market (the timeline, the categories, the resolver), why not encode those opinions and automate market creation? Not to remove editorial judgment, but to make it repeatable and verifiable.

## What's Here Now

The current testnet implementation includes:

- A five-phase agent orchestration system that perceives trends, analyzes them against platform type guidance, plans market drafts, validates safety, executes onchain, and verifies settlement.
- A durable request queue with checkpoint persistence so long-running operations can pause and resume without losing state.
- A provider pool with circuit breaker logic so a single LLM provider outage doesn't silence the agent.
- Two market types: prediction markets (external resolution) and opinion markets (community vote).
- Autonomous agent execution every 10 minutes via Vercel cron, processing pending market creation requests.
- Comprehensive observability: health checks, queue metrics, provider status, failure recovery procedures.

All of this is documented in the testnet operations guides. The agent has its own ERC-8004 identity on Arc so its track record is verifiable. Traders can see what the agent saw, when it saw it, and why it made each decision.

## Design Philosophy

We made specific choices to keep the system understandable and the chain interaction transparent:

**Stablecoin-native primitives.** USDC is the unit of account. Settlement is in USDC. No wrapped assets, no complex swaps at settlement time. Gas is paid in USDC too, which means users think in stablecoin terms from onboarding through resolution.

**Transparency by default.** Every market is its own contract. Every agent decision comes with audit evidence. Session tokens auto-refresh but the app makes it clear when a session is being renewed and why. When something goes wrong, we show it, log it, and provide recovery paths.

**Fault tolerance.** The agent pipeline runs through six stages, any of which can fail. Provider failures trigger fallbacks. Blockchain failures land requests in a dead letter queue for manual review and retry. Queue processing runs continuously but never blocks on a single request.

**Minimal abstractions.** viem calls Arc directly instead of going through a wrapper. Circle wallets use their native session model instead of a custom one. The agent context is a simple prompt block, not a proprietary DSL. This makes the system easier to understand and debug.

## Testing and Deployment

We're on Arc Testnet right now. The agent creates markets daily. Traders can buy shares, add liquidity, and resolve markets. All the infrastructure for autonomous operation is in place: the cron job, the queue, the monitoring, the failure recovery.

Before any mainnet deployment, we need:

- Testnet load testing at realistic scale.
- Resolver quality metrics across different market types.
- Agent market performance (how often do agent markets trade? settle correctly?).
- Security audit of the contract code and agent logic.

That work is ahead. Right now, we're focused on getting testnet stable and finding the edges of the system so we can harden it.

## Contributing

If you want to help, the best entry points are:

- **Agent enhancements.** The trend ingestion and LLM pipeline are well isolated. New data sources, better market drafting, improved safety checks all live here.
- **UI and UX.** The trading flow and market creation form are Next.js components. Feedback on usability is valuable.
- **Testing and monitoring.** Testnet needs stress testing, edge case discovery, monitoring dashboard improvements.
- **Documentation.** Writing clearer guides for operations, resolution, and integration helps the whole platform.

The codebase is organized so each system lives in an obvious place. The Arc integration is in `src/lib` and `app/api/circle`. The agent is in `src/lib/agents`. The trading UI is in `src/components`. Start with the system that interests you and dig in.

## Questions?

The docs in `/docs` cover testnet operations, monitoring, deployment, and troubleshooting. The code has inline comments on the tricky bits. If something is unclear, that's a signal that either the code or the documentation needs improvement. Open an issue or send a message.

---

**Built on Arc Testnet. Live prediction markets with USDC settlement. Autonomous agent creation. Fully transparent, fully auditable.**
