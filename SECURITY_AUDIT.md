# Presto Markets Security Audit

Date: 2026-05-22

> **Addendum (2026-06-10).** Several findings below are resolved since this audit was written. Fixed: the P1 Circle execution allowlist (policy now derives known markets from factory logs), SIWE hardening (Arc chain id 5042002, origin/URI/nonce binding, issued-at freshness), a DB-backed cron lease replacing overlapping schedulers, removal of the static demo-market fallback, comment reply parent integrity, public URL byte caps, and CI now running the unit test suite. Still open: raw `error.message` leakage in many 5xx responses, in-memory (non-durable) rate limiting, single-key resolver with no timeout escape, and single-model resolution confidence. Treat the findings below as historical context, not current state.

Scope: Next.js API routes, React transaction UI, Circle User-Controlled Wallet integration, Arc contract interactions, agent routes, and Solidity market contracts. Arc guidance was checked through the configured Arc MCP resource. Circle guidance was checked through the installed official Circle user-controlled wallet skill because the Circle MCP entry is configured but unsupported in this Codex runtime.

## Executive Summary

The app builds, contract tests pass, and the production high-severity npm audit gate currently passes. The strongest parts of the codebase are the conservative market contracts, Circle challenge execution flow, Arc native gas decimal handling, and basic agent/cron API-key gates.

The main remaining risks are trust-boundary issues around public backend proxies and autonomous routes. This pass fixed x402 requirement binding, moved the Circle Kit key to a server-only env var, and added app-wide production security headers. The most important remaining fix before real value is tightening Circle contract execution to factory-created markets only.

## Findings

### P1 - Circle contract execution allowlist accepts any contract with matching function signatures

Location: `app/api/circle/wallet/provider/route.ts:119`

Evidence: `isAllowedContractExecution` checks factory and USDC addresses, but otherwise returns true for any address that exposes one of `buy(uint8,uint256)`, `resolve(uint8,string)`, `cancel()`, `claim()`, or `refund()`.

Impact: A caller with a Circle user token can use the app backend and Circle API key as a relay to arbitrary contracts with matching signatures. The user still has to approve the Circle challenge, but the backend is no longer strictly scoped to Presto markets.

Fix: Verify that market action targets are factory-created Presto markets before allowing them. Options: read from the deployed factory `markets[]`, maintain an indexed allowlist, or require a successful onchain metadata/factory provenance check.

### P1 - x402 verification is not bound to the exact payment requirements

Location: `src/lib/circleAgents.ts:48`

Status: Fixed in the 2026-05-22 hardening pass.

Original evidence: `verifyX402Payment` checked envelope shape, expiry, and whether the facilitator returned `res.ok`, but did not locally enforce exact `payTo`, `asset`, `network`, `resource`, or `maxAmountRequired` against `buildX402PaymentRequired`.

Resolution: `verifyX402Payment` now validates exact Arc Testnet USDC amount, asset, network, recipient, optional resource metadata, temporal bounds, and Circle Gateway `isValid === true` against the server-built payment requirements.

Impact: If the facilitator only verifies signature validity, a payment intended for a different resource or amount could unlock `/api/v1/markets`. This matters because the API presents itself as paid market data.

Fix: Compare the decoded payment payload against the current payment requirements before accepting it, then call the facilitator with those same requirements if the facilitator supports requirement-bound verification.

### P1 - Circle Kit key is named and read as public configuration

Location: `app/api/swap/route.ts:54`, `app/api/swap/status/route.ts:34`

Status: Fixed in the 2026-05-22 hardening pass.

Original evidence: Both server routes read `process.env.NEXT_PUBLIC_CIRCLE_KIT_KEY`.

Resolution: Both swap proxy routes now read `process.env.CIRCLE_KIT_KEY` only.

Impact: `NEXT_PUBLIC_*` values are browser-visible by convention in Next.js. Even if this key is only used server-side today, the name invites accidental client exposure and makes secret review harder.

Fix: Rename to `CIRCLE_KIT_KEY` or `CIRCLE_APP_KIT_KEY`, keep it server-only, and optionally support the old name for one migration window without documenting it as the canonical env var.

### P2 - Public AI resolution route can burn API credits

Location: `app/api/agents/resolve/route.ts:30`

Evidence: The route only uses an in-memory IP rate limit before calling Anthropic. There is no `PRESTO_AGENT_API_KEY`, wallet ownership, resolver-only, or session gate.

Impact: Anyone can send market payloads to consume LLM credits and generate reports. It does not settle markets, but it is still an externally callable paid compute endpoint.

Fix: Require `PRESTO_AGENT_API_KEY` or a resolver-authenticated session. Keep the rate limit as defense-in-depth.

### P2 - App lacks visible production security headers

Location: `next.config.ts:3`

Status: Fixed in the 2026-05-22 hardening pass.

Original evidence: `next.config.ts` enabled `reactStrictMode` and webpack ignores, but no global headers were configured.

Resolution: `next.config.ts` now applies CSP, frame protection, nosniff, referrer policy, permissions policy, and popup-compatible COOP globally.

Impact: A single XSS or unsafe third-party script has a larger blast radius, especially because Circle user-controlled wallet sessions exist in browser memory and can request signing challenges.

Fix: Add a conservative `headers()` block in `next.config.ts`. Start with `Content-Security-Policy-Report-Only` if needed, then enforce.

### P2 - Circle PIN user sessions are created from userId alone

Location: `app/api/circle/wallet/provider/route.ts:208`

Evidence: The `session` action accepts a caller-supplied `userId` and returns a Circle `userToken`/`encryptionKey` pair.

Impact: Circle PIN auth still requires the user to approve challenges, but userId-only session minting is not identity proof. If user IDs are guessable, this can expose wallet metadata and create unwanted challenge spam.

Fix: Prefer email/social-authenticated sessions as the default. For PIN, bind the app-level userId to an authenticated app session or generate opaque non-guessable user IDs.

### P2 - Agent-created liquidity can target arbitrary market-shaped contracts

Location: `app/api/agents/liquidity/route.ts:80`

Evidence: The POST route validates amount but only checks that `marketAddress` exists in the body before `agentBuyShares` checks `isAddress`.

Impact: Anyone with `PRESTO_AGENT_API_KEY` can direct the agent wallet to approve and buy from any address that implements the expected market ABI. If that key leaks, funds can be drained into malicious contracts.

Fix: Verify `marketAddress` was emitted by the deployed factory before allowing agent liquidity.

### P3 - Agent wallet balance is exposed publicly

Location: `app/api/agents/liquidity/route.ts:5`

Evidence: GET returns agent wallet address, USDC balance, configured status, and strategy without auth.

Impact: This is mostly operational leakage on testnet, but for production it helps attackers profile balances and timing.

Fix: Remove balance from public response or require the agent API key for operational details.

### P3 - Market contract cannot resolve to an outcome with zero shares

Location: `contracts/PrestoMarket.sol:118`

Evidence: `resolve` reverts when `totalShares[outcome] == 0`.

Impact: If the correct outcome has no holders, the resolver must cancel instead of resolving truthfully. This creates a market-design edge case where losing-side holders can be refunded by forcing cancellation.

Fix: Decide product policy. If truth should win even with no winning holders, allow zero-share outcomes and define where leftover collateral goes.

## Verification Run

- `npm run build` passed.
- `npm run test:contracts` passed with 13 tests.
- `npm audit --omit=dev --audit-level=high` passed; remaining production findings are moderate and require upstream/breaking dependency changes.
- `git diff --check` passed.
