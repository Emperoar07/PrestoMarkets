# Presto Markets

Onchain prediction markets on [Arc Testnet](https://docs.arc.io). USDC is the only collateral. Every market is its own contract no indexer, no off-chain matching.

## What works today

- Create markets (Prediction, Opinion, Opportunity) from the browser
- Trade YES / NO with USDC; resolve, claim, refund
- Sign in with **Circle user-controlled wallets** (email, Google, PIN) — they sign live Arc tx via Circle's contract-execution challenge flow
- Sign in with any external EVM wallet (MetaMask, WalletConnect)
- Autonomous agent registered on ERC-8004 that drafts and posts markets from live trends

## Run it

```
cp .env.local.example .env.local
npm install
npm run dev

Testnet USDC: [faucet.circle.com](https://faucet.circle.com).

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Status

Testnet only. Positions can't be exited before settlement. No automated market maker, no dispute window yet. Not financial advice.
