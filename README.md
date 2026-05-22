# Presto Markets

Presto Markets is a fast prediction market app built for Arc. It lets people create public markets, trade stablecoin backed outcomes, follow transparent signals, and settle results from clear rules and resolver evidence.

Arc gives the app a simple foundation for this kind of product. Stablecoins sit at the center of the experience, transaction costs are easier to reason about, and market actions can settle quickly onchain.

## What The App Does

Users can create Prediction, Opinion, and Opportunity markets from the browser. Each market includes a close date, category, source of truth, resolver, image, and public rules.

Traders can buy YES or NO shares with USDC, and the interface shows the expected share count before the wallet signs. EURC routing is also available where the connected wallet path supports it.

Circle User Controlled Wallets power app native onboarding with email, Google, and PIN flows. External EVM wallets are available through the same sign in surface for users who prefer their existing wallet.

The agent system watches live signals, drafts market ideas, and can create labeled agent markets. Human creators can still create markets directly, and resolvers can use evidence tools when settling outcomes.

Portfolio, activity, charts, categories, and market detail pages are designed around readable public signal data rather than hidden execution assumptions.

## Run Locally

```bash
cp .env.local.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

Required environment variables are listed in `.env.local.example`.

Testnet USDC is available from `https://faucet.circle.com`.

## Main Pages

`/` is the Presto landing page.

`/markets` is the live market explorer.

`/markets/create` creates a new market.

`/markets/[id]` opens a market detail page for trading, liquidity, charting, and settlement.

`/portfolio` shows wallet positions.

`/activity` shows recent account activity.

`/docs` explains the product, legal notes, privacy policy, cookie policy, and terms of use.

`/roadmap` and `/build-rails` show the product direction and current Circle and Arc rails.

## Architecture

See `ARCHITECTURE.md` for the deeper technical map.
