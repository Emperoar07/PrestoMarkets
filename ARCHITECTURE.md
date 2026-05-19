# Architecture

## Stack

- **Frontend** — Next.js 14 (App Router), TypeScript, Tailwind
- **Chain** — Arc Testnet (chain ID `5042002`), USDC as native gas
- **Reads** — viem `publicClient` against the Arc RPC, no indexer
- **Wallets** — Circle user-controlled (email/Google/PIN) or any EVM wallet via RainbowKit
- **Hosting** — Vercel (daily crons for the agent)

## Contracts

- `PrestoMarketFactory` — registry of all markets, emits `MarketCreated`
- `PrestoMarket` — one contract per market: shares, collateral, resolution state
- USDC + EURC ERC-20s for collateral
- `IdentityRegistry` (ERC-8004) — agent identity on Arc

## Transaction paths

There are three signing paths, chosen automatically by `connectedWallet.mode`:

| Mode | Signer | How |
|---|---|---|
| `external-eoa` | User's browser wallet | viem `walletClient.writeContract` direct to Arc RPC |
| `circle-user-controlled` | Circle MPC | `POST /v1/w3s/user/transactions/contractExecution` → user solves PIN challenge → Circle broadcasts |
| Autonomous agent | Server-held EOA | `AGENT_PRIVATE_KEY` on Vercel; gated by `PRESTO_AGENT_API_KEY` |

All three converge on the same Solidity functions (`createMarket`, `buy`, `resolve`, `cancel`, `claim`, `refund`).

## Key files

```
app/api/agents/*           Agent endpoints (identity, market create, liquidity, resolve)
app/api/circle/wallet/*    Circle user-wallet proxy (rate-limited, server-held API key)
app/api/cron/*             Daily agent jobs
src/lib/liveActions.ts     EOA path; branches to circleActions for Circle users
src/lib/circleActions.ts   Circle contract-execution flow + tx polling
src/lib/agentWallet.ts     Server-side agent EOA
src/lib/onchainMarkets.ts  Factory + market reads via viem
src/lib/costBasisIndexer.ts  Incremental localStorage indexer for portfolio P&L
```

## Data flow on trade

1. User clicks **Buy YES $10**
2. `placeTrade` in `appState` → `buyLiveShares` in `liveActions`
3. EOA path: viem signs USDC `approve` → market `buy`, both broadcast directly
4. Circle path: server creates two contract-execution challenges, user PIN-confirms each, Circle MPC signs and broadcasts; client polls Circle until `CONFIRMED`
5. On success, `refreshMarkets` + `refreshAccountPortfolio` re-read chain state

## Portfolio reads

Cost basis is computed from `SharesBought` logs. To avoid scanning from block 0 every load, `costBasisIndexer` keeps a per-`(chainId, account, market)` checkpoint in `localStorage` and only pages new blocks on subsequent loads.

## Agent

A single EOA (`AGENT_PRIVATE_KEY`) is registered on `IdentityRegistry` (agent ID `16339`). Daily Vercel cron hits `/api/cron/market-factory` to draft markets from trends, and `/api/cron/auto-resolve` to settle markets where the source-of-truth metadata can be verified. All agent writes go through `agentWallet.ts` with min-safety / min-momentum gates.
