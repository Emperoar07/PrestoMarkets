# Presto Markets

Presto Markets is a prediction market app built for Arc, Circle's stablecoin native L1. People come here to spin up public markets in a couple of clicks, trade YES or NO with USDC and EURC, and follow the same signal data the platform itself reads from. Every market is its own onchain contract, every settlement is published with evidence, and every agent created market carries a visible audit trail so traders always know what they are looking at.

The idea is simple. Prediction markets work best when the rails feel native, when stablecoins are the default unit of account, and when the path from "interesting question" to "live, tradable market" takes less than a minute. Arc gives us that foundation. Presto layers a calm, editorial interface on top of it.

## What you can do

**Create markets in three flavors.** Prediction markets resolve from an external source of truth, Opinion markets resolve from community vote, and Opportunity markets resolve from ecosystem signal like builder activity or capital flow. Each one accepts a close date, up to four categories, a description, an image, optional multi outcome poll options, and a resolver of your choosing.

**Trade with stablecoins.** Buy YES or NO shares with USDC. EURC payments route through the Circle App Kit swap so users holding euros never need to think about pre swapping. Limit orders sit ready for the order book phase and market orders execute against the live share contract.

**Add balanced liquidity.** Liquidity providers split a single deposit into balanced YES and NO depth, which gives every fresh market clean starting odds and a readable signal.

**Settle with confidence.** Resolvers post evidence URIs that the contract stores forever. Agent assisted resolution lets the resolver use a built in research oracle to gather sources before signing the final transaction.

**Watch the agent at work.** The Presto Markets agent runs on a daily cadence, reads live trend signals from a dozen sources, ranks them by cross outlet momentum, and creates the few markets that clear a composite signal threshold. The agent has its own ERC-8004 identity, its own wallet, and its own activity feed on the app.

## How it is built

Presto Markets sits on a small set of well chosen rails. The goal was to pick tools that map cleanly to the product story and to avoid abstractions that hide what the chain is actually doing.

**Arc Testnet, USDC native gas.** Every market is its own contract, deployed by the Presto factory. Settlement is in USDC. EURC bought through Circle App Kit auto swaps into USDC at signing time. The multi outcome factory handles poll markets with three to twelve outcomes.

**Next.js 14 App Router.** Server components do the data fetching for trend feeds, news summaries, and onchain reads. Client components own the trading flow, wallet state, and live odds. Tailwind handles the visual system.

**Wallet rails through Circle and viem.** Circle User Controlled Wallets give first time users an email plus PIN onboarding experience that feels closer to a consumer app than a web3 wallet. External EVM wallets connect through the same surface for users who already carry MetaMask or similar. Session tokens auto refresh so the trading flow does not interrupt a working trader.

**Agent pipeline with LLM fallback chains.** The agent pipeline reads trends, classifies each one against the platform's market type guidance, drafts a market with the right close date for the topic horizon, runs a safety check, and only deploys if the composite of momentum and safety crosses the bar. Every prompt receives the same shared platform context so the agent stays aware of new app features as the codebase evolves. The model rotation runs Anthropic Claude first, then Groq, OpenRouter, Cerebras, and Together as fallbacks so a single provider hiccup never silences the agent.

**Trend ingestion.** The agent reads Cointelegraph, Decrypt, The Block, CoinDesk, BBC, TechCrunch, Hacker News, Google News, ESPN, TheSportsDB football fixtures, LiveScore, X via Grok live search, and live CoinGecko prices for BTC, ETH, SOL, and ARC. News stories get clustered by fuzzy title fingerprint so a single event covered by five outlets ranks higher than five separate stories.

**Agent resolution oracle.** When a market needs settling and the resolver picks Agent assisted, the resolver can invoke an Anthropic powered research oracle that gathers sources, summarizes evidence, suggests a winning outcome, and posts a confidence score. The resolver still signs the final Arc transaction so accountability stays in the right place.

**Observability.** Activity page, news page, agent identity card, market detail news tie ins, and per market audit trails are all driven by the same data the agent itself reads from. What the agent sees, the user sees.

## Build rails

The day to day stack:

1. **Next.js 14 + TypeScript + Tailwind** for the app shell.
2. **viem + Arc Testnet RPC** for every onchain read and write.
3. **Circle App Kit** for user controlled wallets, swaps, and tx receipts.
4. **Anthropic, Groq, OpenRouter, Cerebras, Together** as the LLM fallback chain.
5. **Grok, Serper, CoinGecko, TheSportsDB, ESPN** as the trend ingestion mesh.
6. **Vercel cron** for the daily agent tick and the news cache refresh.
7. **ERC-8004 agent identity** registered onchain so the agent's track record is verifiable.

The repo is organized so each rail lives in one obvious place. `src/lib/agentPipeline.ts` owns the classify-draft-safety pipeline. `src/lib/agentContext.ts` owns the shared platform context. `src/lib/circleActions.ts` owns the Circle wallet path. `src/lib/liveActions.ts` owns the external wallet path. `app/api/agents/*` and `app/api/news/*` own the cron and feed endpoints.

## Roadmap

Where Presto is going next:

**Cross market liquidity rebalancer.** A scheduled rebalance pass that watches volume drift across the agent's market book and gently moves depth toward the busiest contracts so live markets always have responsive odds.

**Paid agent endpoints.** An x402 wrapped `/api/agents/resolve` endpoint so other agents and platforms can pay USDC to query the Presto resolution oracle as a service.

**Order book contract phase.** The current Limit toggle in the trade panel is the UX placeholder for a true onchain order book. The next contract revision lands the matching engine and turns that toggle live.

**Native multi chain expansion.** Arc Mainnet ships, then a clean parity port to one additional Circle stablecoin chain so the same market contracts run wherever USDC is native.

**Agent tweet rationale.** The agent posts its market creation rationale to X automatically, with the trend link, the momentum and safety scores, and a quick read of why the topic cleared the bar. Same audit trail, broader reach.

**Cross market opinion baskets.** Bundled positions across linked opinion markets so users can express a thesis ("the next L2 narrative") with a single signed transaction.

**Resolution court.** A dispute window after every resolver signs so high stakes markets can be flagged, re evaluated by a second resolver, and corrected before claims open.

## Running locally

```bash
npm install
cp .env.local.example .env.local   # fill in the keys you have
npm run dev
```

Testnet USDC is available from `https://faucet.circle.com`. The `.env.local.example` file lists every key the app reads. The agent pipeline gracefully no-ops on missing trend providers so you can boot the app with a minimal env and add keys as you wire each rail.

## Project layout

```
app/                    Next.js routes (pages + API routes for cron + feeds)
src/components/         Client and server components
src/lib/                Onchain reads, wallet actions, agent pipeline, trend ingestion
src/lib/agentContext.ts Shared "what the agent knows about the app" prompt block
contracts/              Solidity sources for the Presto market and factory
scripts/                Deploy and migration scripts
data/                   Network configuration snapshots
```

## License

MIT.
