# Presto Markets

Presto Markets is a public prediction market application built on Arc, a Layer 1 blockchain purpose built for stablecoin native financial applications. Markets are created and settled entirely onchain, with USDC as the collateral and settlement asset throughout.

## What it does

Anyone can create a market, set the resolution rules, assign a resolver address, and publish it to the Arc factory. Other users can buy YES or NO shares with USDC. When the market closes, the resolver submits evidence and resolves the outcome. Winners claim their USDC. Canceled markets are fully refundable.

There are three types of markets:

**Prediction** markets cover objective future outcomes where a clear source of truth exists and a verifiable answer is expected after close. These follow the pattern made familiar by Polymarket.

**Opinion** markets capture community conviction on product decisions, governance questions, or directional sentiment where the signal itself is the value, not just the binary answer.

**Opportunity** markets surface where builders and capital should focus. They are intended for structured opportunity signals with milestone aware resolution.

Market contracts live on Arc Testnet (chain ID 5042002). USDC is the only collateral token. Smart contract interactions use viem. Wallet connection supports two paths: Circle User Controlled Wallets (email OTP, Google, and PIN) and any external EVM wallet through RainbowKit.

The factory contract holds the registry of all markets. Each market is a separate contract that stores shares, collateral, resolution state, and settlement records. All reads happen directly from the contracts with no indexer in V1.

## Getting started

Copy the environment template and fill in your keys:

```
cp .env.local.example .env.local
```

The required variables are:

```
NEXT_PUBLIC_ARC_RPC_URL                 Arc Testnet RPC endpoint
NEXT_PUBLIC_PRESTO_FACTORY_ADDRESS      Deployed factory contract address
CIRCLE_API_KEY                          Circle API key for the wallet backend
NEXT_PUBLIC_CIRCLE_APP_ID               Circle app ID for the browser SDK
NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED      Set to true to enable Circle wallets
```

Install dependencies and start the development server:

```
npm install
npm run dev
```

The app runs at http://localhost:3000 and redirects immediately to the markets explorer.

## Testnet USDC

Arc Testnet uses USDC as the gas token. You can get testnet USDC from the Circle faucet at faucet.circle.com. The faucet link is also in the app header once a wallet is connected.

## What is not in V1

Positions cannot be exited before resolution. There is no sell path and no automated market maker. Liquidity is fixed share settlement only. Activity history is read from a rolling 30 day log window rather than a persistent index. Dispute and bond mechanisms are designed for a later phase.

## Status

Presto Markets is a testnet application. It is not financial advice. Market assets have no guaranteed value on testnet. Do not use for real value transactions until audit findings, dispute paths, and production risk controls are complete and reviewed.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, Tailwind CSS, TypeScript |
| Blockchain | Arc Testnet, viem |
| Wallets | Circle User Controlled Wallets, RainbowKit, wagmi |
| Deployment | Vercel |

