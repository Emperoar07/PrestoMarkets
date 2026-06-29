/**
 * Shared Arc read-client configuration.
 *
 * Arc's public RPC (rpc.testnet.arc.network) is rate-limited and returns HTTP
 * 429 under load — the trade panel's balance/allowance reads were getting
 * throttled. Two mitigations live here:
 *
 *  1. Request batching. Multicall3 is deployed at the standard address on Arc
 *     (confirmed via Arc docs), so `batch.multicall` collapses many contract
 *     reads into a single aggregated eth_call, and the http `batch` option
 *     coalesces multiple JSON-RPC calls into one HTTP request. Both cut the
 *     number of requests that can trip the rate limiter.
 *
 *  2. 429-aware retry. `isRpcRateLimited` lets callers back off longer when the
 *     RPC throttles, instead of hammering it with the default short retry.
 *
 * Point NEXT_PUBLIC_ARC_RPC_URL at a dedicated node provider (dRPC, QuickNode,
 * Blockdaemon — see Arc node-providers docs) to remove the public-endpoint
 * limit entirely.
 */
import { createPublicClient, fallback, http } from 'viem';
import { getArcChainId, getArcConfig } from './arcConfig';

/** Client-level batch config: aggregate contract reads via Multicall3. */
export const ARC_READ_BATCH = { multicall: true } as const;

/** Arc's ERC-20 USDC interface uses standard USDC precision for app balances. */
export const ARC_USDC_DECIMALS = 6;

/** Arc's native gas accounting uses EVM-native 18-decimal precision. */
export const ARC_NATIVE_USDC_DECIMALS = 18;

/** Arc public RPC — always the last-resort fallback (rate-limited, but always available). */
const ARC_PUBLIC_RPC = 'https://rpc.testnet.arc.network';

/**
 * Ordered Arc RPC endpoints: dedicated providers first (dRPC, then QuikNode), the public RPC
 * last. Provider URLs carry API keys, so they live in env (NEXT_PUBLIC_* — these run client-side
 * and are visible in the browser regardless) rather than committed source. An explicit override
 * jumps to the front when provided.
 */
export function arcRpcUrls(override?: string): string[] {
  // Named dedicated providers (kept for back-compat). Alchemy leads — premium, high limit.
  const alchemy = process.env.NEXT_PUBLIC_ARC_RPC_ALCHEMY;
  const drpc = process.env.NEXT_PUBLIC_ARC_RPC_DRPC;
  const quiknode = process.env.NEXT_PUBLIC_ARC_RPC_QUIKNODE;

  // Generic numbered slots — fill ANY of these with ANY endpoint (e.g. several Alchemy keys) in any
  // order; empty ones are skipped. They all join the fallback chain and are tried one-by-one. An
  // exhausted endpoint stays in the chain: arcShouldThrow advances past its quota/rate-limit error,
  // and it starts serving again the moment you top it up — so you can refill whichever you like.
  // NOTE: each must be referenced STATICALLY here — Next.js only inlines NEXT_PUBLIC_* vars into the
  // browser bundle when accessed by literal name, so a dynamic process.env[...] would be undefined.
  const numbered = [
    process.env.NEXT_PUBLIC_ARC_RPC_1,
    process.env.NEXT_PUBLIC_ARC_RPC_2,
    process.env.NEXT_PUBLIC_ARC_RPC_3,
    process.env.NEXT_PUBLIC_ARC_RPC_4,
    process.env.NEXT_PUBLIC_ARC_RPC_5,
    process.env.NEXT_PUBLIC_ARC_RPC_6,
    process.env.NEXT_PUBLIC_ARC_RPC_7,
    process.env.NEXT_PUBLIC_ARC_RPC_8,
    process.env.NEXT_PUBLIC_ARC_RPC_9,
    process.env.NEXT_PUBLIC_ARC_RPC_10,
  ];

  // Named premium first, then the numbered slots, then any explicit override; the rate-limited
  // public RPC is always the last-resort tail so load only degrades to it if every other leg fails.
  const ordered = [alchemy, drpc, quiknode, ...numbered, override, ARC_PUBLIC_RPC]
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url));
  return Array.from(new Set(ordered));
}

/**
 * Per-endpoint request timeout. viem's `fallback` only advances to the next RPC once the current
 * one ERRORS — a provider that is "out" but hangs (e.g. Alchemy past its quota holding the socket
 * open, or a slow 429 with Retry-After) would otherwise stall every call for viem's 10s default
 * before failing over, which looks like the pipeline is frozen / "not falling back". A tight cap
 * makes a dead OR slow leg fail over quickly while still comfortably covering a healthy light read
 * (balances/allowance return in well under 2s; a provider that needs >4.5s is "not working well"
 * and we'd rather advance to the next than wait on it). A quota/rate-limit error already fails over
 * instantly via arcShouldThrow — this cap is for the slow-hang case.
 */
const ARC_RPC_TIMEOUT_MS = 4_500;

/**
 * Decide whether a fallback should STOP failing over (throw) vs advance to the next RPC.
 *
 * viem's default `shouldThrow` short-circuits on a handful of "deterministic" RPC error codes —
 * crucially -32003 (`TransactionRejectedRpcError`, surfaced as "Transaction creation failed."),
 * which is exactly what QuikNode / Alchemy return when they hit a DAILY or RATE limit. Those are
 * provider-specific, so stopping there strands every read on the dead endpoint instead of moving on
 * to a healthy one — the "out for Alchemy/QuikNode and not falling back" symptom, and why the whole
 * grid read returned empty. We override it: only stop for a genuine on-chain execution revert (the
 * one error that is identical on every node, so retrying elsewhere is pointless); fail over on
 * everything else — rate limits, daily quotas, timeouts, internal errors.
 */
export function arcShouldThrow(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('execution reverted');
}

/**
 * Fallback HTTP transport across the ordered Arc RPCs. viem's `fallback` advances to the next
 * endpoint on error (so a throttled/down provider transparently fails over), each leg batches
 * JSON-RPC calls into a single request, and a per-endpoint timeout makes a hanging provider fail
 * over fast instead of stalling on the default 10s.
 */
export function arcReadTransport(rpcUrl?: string) {
  const transports = arcRpcUrls(rpcUrl).map((url) => http(url, { batch: true, timeout: ARC_RPC_TIMEOUT_MS }));
  return fallback(transports, { rank: false, shouldThrow: arcShouldThrow });
}

export function createArcChain(rpcUrls?: string[]) {
  return {
    id: getArcChainId(),
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: ARC_NATIVE_USDC_DECIMALS },
    rpcUrls: { default: { http: rpcUrls && rpcUrls.length > 0 ? rpcUrls : arcRpcUrls() } },
  } as const;
}

export function createArcReadClient() {
  const config = getArcConfig();
  if (!config.rpcUrl) return null;
  const rpcUrls = config.rpcUrls.length > 0 ? config.rpcUrls : arcRpcUrls(config.rpcUrl);

  return createPublicClient({
    chain: createArcChain(rpcUrls),
    transport: arcReadTransport(config.rpcUrl),
    batch: ARC_READ_BATCH,
  });
}

/** True when an error looks like an RPC rate-limit (HTTP 429 / "too many requests"). */
export function isRpcRateLimited(error: unknown): boolean {
  if (!error) return false;
  const status = (error as { status?: number }).status;
  if (status === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes('429') || lower.includes('too many requests') || lower.includes('rate limit');
}

/**
 * Retry with exponential backoff, waiting longer when the RPC is rate-limiting.
 * Defaults to 3 retries: ~0.4s/0.8s/1.6s normally, ~1s/2s/4s on 429.
 */
export async function withRpcRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) throw error;
      const base = isRpcRateLimited(error) ? 1000 : 400;
      const delay = base * 2 ** attempt;
      await new Promise<void>((resolve) => { setTimeout(resolve, delay); });
    }
  }
  throw new Error('unreachable');
}
