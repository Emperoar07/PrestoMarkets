# Presto Markets

Presto Markets is a trust first prediction market built on Arc, Circle's stablecoin native Layer 1, currently live on Arc Testnet. You can open a public market in a couple of clicks, trade outcome shares settled in USDC, and follow the same signals the platform itself reads from. Every market is its own onchain contract, every settlement is published with evidence, and every market the agent opens carries a visible trail, so you always know what you are looking at.

The idea is simple. Prediction markets work best when the rails feel native, when stablecoins are the unit of account, and when the path from an interesting question to a live, tradable market takes under a minute. They get most useful as they move past entertainment into financial and operational workflows, where people need a live read on how outcomes are being priced. Arc gives us that foundation, with USDC as both the unit of account and the gas, and deterministic finality under a second that settles every trade for good. Presto adds a calm, readable surface on top, with an agent that watches global trends and opens fresh markets every day.

## What you can do

**Open a market in two flavors.** Prediction markets resolve from an external source of truth. Opinion markets capture sentiment and settle through their named resolver (community vote settlement is on the roadmap, not live yet). Each one takes a close date, up to four categories, a description, an image, optional poll options, and a resolver of your choosing.

**Trade in USDC or EURC.** Buy YES or NO on a binary market, or any option on a poll. Orders execute against the live share contract, and the panel shows your shares and a payout estimate before you sign. Euro markets settle in EURC, so dollar and euro questions sit side by side. Sports markets add a live header with both team flags, the kickoff time, and the score once the match starts.

**Fund in a tap.** Sign in with a device passkey or an app wallet and trade gas free, sponsored through the Circle bundler. Already hold USDC on another chain? Move it to your Arc balance from Base, Ethereum, Arbitrum, or Avalanche through Circle Gateway, right inside the wallet panel.

**Settle with confidence.** Resolvers post evidence that the contract keeps for good. Crypto price markets settle straight from the live price, frozen at close. Other markets settle from their declared sources once the evidence is clear. A two hour challenge window lets anyone dispute a proposed outcome before it lands, and anything that stays uncertain past a grace window is canceled and every participant is refunded in full.

**Watch the agent work.** The Presto agent reads live trends from a dozen sources, ranks them by how many outlets are covering the same story, and opens the few that clear its bar. It has its own onchain identity, its own wallet, and its own activity feed in the app. What the agent sees, you see.

**Cover institutional workflows.** Beyond consumer questions, the agent favors event driven and operational markets: macro releases like CPI, central bank rate decisions, GDP and labor data, plus geopolitical and operational risk. Each one is bound to an official or measurable source, never a marketing post, so the question stays settleable.

## How it is built

**Arc Testnet, USDC as gas.** Every market is its own contract from the Presto factory. Trades and payouts settle in USDC, or in EURC for euro markets.

**Next.js 16 and viem.** Server components do the reading. Client components own the trading flow, wallet state, and live odds.

**Circle wallets.** New users onboard with a device passkey, an app wallet PIN, email, or Google. Anyone already holding an EVM wallet connects through the same surface. Passkey and app wallet transactions are sponsored, so trading stays gas free, and sessions refresh on their own so a working trader is never interrupted.

**A public agent API.** Read markets, the leaderboard, and the agent profile at /api/v1. The data endpoints can accept tiny USDC payments through x402, so other agents can pay per call.

**An autonomous agent.** It reads trends, classifies each one, drafts a market with a close date that fits the event, runs a safety pass, seeds every outcome so the market can always settle, and opens it onchain. The model rotation runs Claude first with a seven provider fallback chain (Gemini, Groq, Mistral, OpenRouter, Cerebras, Together, Hugging Face), so one provider hiccup never silences it.

**Verifiable identity.** The agent is registered with an ERC-8004 identity on Arc, so its track record can be checked onchain.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the keys you have
npm run dev
```

Testnet USDC is available from the Circle faucet. The app boots with a minimal env, and you can add keys as you wire each rail.

## License

MIT.
