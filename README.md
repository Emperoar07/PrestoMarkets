# Presto Markets

A prediction market that puts trust first, built on Arc, Circle's stablecoin native Layer 1, and live on Arc Testnet. Open a market in a couple of clicks, trade outcome shares in USDC or EURC, and watch an onchain agent open fresh markets every day. Every market is its own contract and every settlement is published with evidence, so you always know what you are looking at.

## Features

- **Two market types.** Prediction markets resolve from an external source of truth. Opinion markets capture sentiment and settle through their named resolver. Each is binary YES or NO, or a poll of up to twelve options, with a close date, up to four categories, an image, and a resolver of your choosing.
- **Trade in USDC or EURC.** Buy any outcome against the live share contract. The panel shows your shares and a payout estimate before you sign. Euro markets settle in EURC, so dollar and euro questions sit side by side.
- **Sign in your way.** A device passkey, an app wallet PIN, email, or Google through Circle wallets, or an external EVM wallet through RainbowKit. Passkey and app wallet trades are gasless, sponsored through the Circle bundler.
- **Fund from any chain.** Move USDC to your Arc balance from Base, Ethereum, Arbitrum, or Avalanche through Circle Gateway, right inside the wallet panel.
- **Settle with evidence.** Resolvers post evidence the contract keeps for good. Crypto price markets settle from the live price, frozen at close. Optimistic markets propose an outcome, open a two hour public challenge window, then settle. Anything still uncertain past a grace window is canceled and refunded in full.
- **Live sports.** Fixture markets show both team flags, the kickoff time, and the live score once a match starts, from a keyless feed, held through settlement.
- **An onchain agent.** It reads live trends, opens every World Cup fixture, and keeps a varied book of crypto, macro, and culture markets. It has its own ERC-8004 identity, wallet, and activity feed. What the agent sees, you see.
- **Public API.** Read markets, the leaderboard, and the agent profile at `/api/v1`. The data endpoints can take a small USDC payment per call through x402, so other agents can pay to read the book.

## How it is built

- **Arc Testnet.** USDC is the unit of account and the gas. Deterministic finality under a second settles every trade for good.
- **Contracts.** Each market is its own contract from the Presto factory, in USDC or EURC. Create, buy, resolve, propose, dispute, claim, and refund, with an optimistic challenge window for trustworthy settlement.
- **Next.js 16 and viem.** The server reads the chain through a cached endpoint so pages stay fast. The client owns the trading flow, wallet state, and live odds.
- **Circle.** User controlled wallets for email, Google, and PIN. Modular Wallets for device passkeys, backed by a sponsored smart account on Arc. Gateway for cross chain funding.
- **The agent.** It reads trends, classifies each one, drafts a fitting close date, runs a safety pass, seeds every outcome so the market can always settle, and opens it onchain. Claude leads a seven provider fallback chain, so one outage never silences it. Registered with an ERC-8004 identity on Arc.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in the keys you have
npm run dev
```

Testnet USDC and EURC are available from the Circle faucet. The app boots with a minimal env, so you can add keys as you wire each rail.

## License

MIT.
