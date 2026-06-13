# Build guides — interleaved small items

Six independent tasks you can pick up in any order while UBK Phase 2 is in flight. Each is
self-contained, low-risk, and shippable in one sitting. Ordered easiest → meatiest.

---

## 1. Durable rate limiting (Upstash Redis) — ~half day

**Why:** today's limiter is `checkFixedWindowRateLimit` over an in-memory `Map` (see
`src/lib/requestGuards.ts`), so it resets on every serverless cold start and isn't shared across
Vercel instances. One real fix covers every write route at once.

**How:**
1. `npm i @upstash/ratelimit @upstash/redis`. Create an Upstash Redis DB (free tier), add
   `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` to Vercel env + `.env.local`.
2. New `src/lib/rateLimitRedis.ts`: export `async function checkRateLimit(key, { limit, windowSec })`
   using `Ratelimit.slidingWindow`. **Fall back** to the existing in-memory limiter when the env
   vars are absent (so local/dev still works and nothing hard-fails).
3. Swap the call in the hottest write routes first: `app/api/comments`, `app/api/profiles/*`,
   `app/api/watchlist`, `app/api/notifications/read`. Keep the same 429 shape.
4. Verify: hammer an endpoint past the limit locally with the env unset (memory path) and set
   (redis path); both should 429.

**Gotcha:** Upstash calls are async + network; don't block the request on a Redis error — wrap in
try/catch and fail **open** (allow) so a Redis outage never takes down writes.

---

## 2. Account recovery / help states (#31) — ~half day, pure UI

**Why:** Circle UCW users who lose their PIN / device currently hit dead ends.

**How:**
1. In `SignInModal.tsx` and the wallet dropdown (`WalletConnectButton.tsx`), add a small
   "Trouble signing in?" link → a new `RecoveryHelpModal` (copy the portal pattern from
   `SignInModal`).
2. Modal content, three branches: **Circle wallet** (link to Circle's PIN-recovery flow + email
   support), **External wallet** (reconnect / switch-network steps), **Lost everything** (what is
   and isn't recoverable on testnet — be honest: testnet funds aren't insured).
3. No backend. Keep copy short and human (matches existing modal tone).

**Gotcha:** don't promise recovery you can't deliver — testnet is testnet.

---

## 3. Versioned public JSON shapes (#65) — ~half day

**Why:** external agents/widgets will consume `/api/v1/*`; lock the shape so you can evolve without
breaking them.

**How:**
1. New `src/lib/apiContracts.ts`: declare the response types (`MarketV1`, `MarketListV1`, etc.) and
   a `toMarketV1(market: AppMarket): MarketV1` mapper that **whitelists** fields (never spread the
   internal object — that's how internal fields leak).
2. Wrap every `/api/v1/*` body as `{ apiVersion: 1, data: ... }`. Route the existing handlers
   through the mapper.
3. Add `docs/API_V1.md` documenting each shape. Add a vitest snapshot test on `toMarketV1` so an
   accidental field change fails CI.

**Gotcha:** once published, treating a field as stable is a promise. Additive changes only under
`apiVersion: 1`; breaking changes → `/api/v2`.

---

## 4. Creator reputation (#63) — ~1 day

**Why:** the agent already has on-chain ERC-8004 reputation; users have none. Surfacing per-creator
stats builds trust + competition.

**How:**
1. Data already exists: `accountPortfolio` + market `creatorAddress` + resolved outcomes. Add
   `src/lib/creatorReputation.ts` computing, per address: markets created, resolved %, volume
   driven, win-rate of their *traded* positions (Brier-style, reuse `leaderboard` math).
2. New `app/api/profiles/[address]/reputation/route.ts` (cache `s-maxage=60`).
3. Surface on the profile page: a compact stat row + a "Creator" badge tier (Bronze/Silver/Gold by
   resolved count). Reuse the leaderboard's number formatting.

**Gotcha:** only count **resolved** markets toward accuracy; pending/canceled must not inflate it.

---

## 5. Webhooks for resolved markets (#67) — ~1 day

**Why:** lets partners/bots react to settlements without polling.

**How:**
1. Schema: `webhook_subscriptions` (id, url, secret, event_types[], active, created_at). Migration
   via the idempotent `.cjs` pattern in `drizzle/` (apply with `MIGRATE_URL` inline, never commit
   the secret).
2. `src/lib/webhooks.ts`: `dispatchWebhook(event, payload)` — POST JSON with an
   `X-Presto-Signature` HMAC-SHA256 of the body using the sub's secret; 5s timeout; **best-effort**
   with a 3-try backoff, log failures, never block the cron.
3. Fire it from `app/api/cron/auto-resolve` right where watchers are notified, for
   `market_resolved` / `market_canceled` / `resolution_proposed`.
4. Management: a minimal authenticated `app/api/webhooks` (POST to subscribe, DELETE to remove).
   Validate the target URL with the existing SSRF guard (`isSafeHttpUrl`) — **critical**, a webhook
   URL is attacker-controlled.

**Gotcha:** SSRF — never POST to an unvalidated URL from the server. Reuse `fetchPublicHttpUrl`'s
host checks.

---

## 6. Batch approve + buy (#28) — ~1–2 days, trickiest

**Why:** today a first-time buyer signs `approve` then `buy` — two prompts. Circle Smart Accounts
support batching into one user-op.

**How:**
1. EOA path can't truly batch (two txs) — leave it, but you can skip the approve when allowance is
   already sufficient (check `allowance()` first; the code may already do this — verify in
   `liveActions.buyLiveShares`).
2. Circle UCW path: `runContractExecution` (in `circleActions.ts`) submits one call today. Circle's
   SCA supports a `contractExecution` batch / multi-call — check the Circle MCP
   (`mcp__circle__*`, product `modular-wallets` or `user-controlled-wallets`) for the batch API,
   then build approve+buy as a single user-op.
3. Gate behind a flag; fall back to sequential on any batch error.

**Gotcha:** this touches the money path. Build it behind a flag, test on testnet with small amounts,
and keep the sequential path as the guaranteed fallback. Don't rush this one.

---

### Suggested order
1 (durable RL — protects everything) → 3 (versioned shapes — cheap, unblocks widgets) →
2 (recovery — pure UI) → 4 (creator rep) → 5 (webhooks) → 6 (batch buy, last & careful).

All six are independent of UBK Phase 2 — no merge conflicts expected (different files).
