# UBK / Available-USDC Spike — Verdict: GO

Date: 2026-06-12. Sources: Circle docs MCP (developers.circle.com/gateway), npm registry.
Scope: can Presto give users one "Available USDC" balance and let them fund Arc trades from
USDC held on other chains (list items #17–25)?

## Findings (verified, not assumed)

**1. The SDK is real and current.**
- `@circle-fin/unified-balance-kit` v1.1.3 — "SDK for cross-chain USDC deposits, spending, and
  balance queries" (~6k weekly downloads).
- `@circle-fin/provider-gateway-v1` — Gateway provider for instant crosschain USDC with unified
  balance management.
- `@circle-fin/app-kit` — higher-level alternative; Arc App Kit "Bridge" is the low-setup option
  (we already carry a `NEXT_PUBLIC_CIRCLE_BRIDGE_KIT_ENABLED` flag).

**2. Gateway supports Arc Testnet natively.** Verified testnet matrix:

| Chain | Domain | USDC |
|---|---|---|
| **Arc Testnet** | **26** | `0x3600…0000` (the gas USDC we already use) |
| Ethereum Sepolia | 0 | `0x1c7D…7238` |
| Base Sepolia | 6 | `0x036C…CF7e` |
| Avalanche Fuji | 1 | `0x5425…bc65` |
| Hyperliquid / Sei / Sonic / Worldchain / Solana Devnet | 19/16/13/14/5 | … |

Gateway contracts (same address across EVM testnets):
- GatewayWallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`
- GatewayMinter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`

**3. The flow is permissionless.** Deposit = `USDC.approve(GatewayWallet)` →
`GatewayWallet.deposit(usdc, amount)` on any source chain; after chain finality the unified
balance is the sum of finalized deposits across chains. Transfers out (e.g. → Arc) go through
the Gateway Minter / Forwarding Service (their how-to literally demos Arc Testnet → Base
Sepolia). No API key required for the core deposit/balance path.

**4. The one sharp edge:** a plain ERC-20 `transfer` to the GatewayWallet **permanently loses
the USDC** — deposits MUST use `deposit()`. Our UI must never surface a raw address to send to.

## Integration plan for Presto (phased)

**Phase 1 — read-only "Available USDC" (low risk, ships fast)**
- `npm i @circle-fin/unified-balance-kit`
- New `src/lib/unifiedBalance.ts`: query (a) Arc wallet USDC (existing), (b) Gateway unified
  balance for the connected address, (c) per-chain wallet USDC on Base Sepolia/Sepolia/Fuji via
  public RPCs. "Available USDC" = a + b; expandable detail rows per chain (+ pending finality).
- Header pill switches from Arc-only to Available USDC (#19, #20). Cache like the USDC balance.

**Phase 2 — funding flow in the Add-USDC drawer (#21–24)**
- EOA wallets first (wagmi already speaks the source chains): drawer shows per-chain balances →
  "Move to Arc" runs deposit (source chain) → Gateway transfer → Arc mint, with explicit states:
  approving → depositing → awaiting finality (per-chain confirmations) → transferring → done /
  failed (#23, #25). Trade panel CTA flips to "Add USDC" when Arc balance < amount but Available
  USDC covers it (#21).
- Circle UCW + passkey wallets: needs Circle-signed source-chain txs — phase 2b after EOA proves
  the rails (UCW users can still fund via the existing faucet/bridge links meanwhile).

**Phase 3 — agent treasury (optional)**
- The agent can hold its seed/ops float as a unified balance and pull to Arc on demand —
  pairs with `ensureAgentFunded()` as a second funding source besides the (403'd) faucet.

## Risks / notes
- Finality wait on source chains (minutes on Sepolia-class chains) → the pending state in the
  drawer is mandatory UX, not polish.
- Solana path exists but is out of scope for Presto.
- Keep the deposit affordance button-only (never display the GatewayWallet address) per the
  sharp edge above.
