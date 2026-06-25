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
  const alchemy = process.env.NEXT_PUBLIC_ARC_RPC_ALCHEMY?.trim();
  const drpc = process.env.NEXT_PUBLIC_ARC_RPC_DRPC?.trim();
  const quiknode = process.env.NEXT_PUBLIC_ARC_RPC_QUIKNODE?.trim();
  // Dedicated providers first (Alchemy leads — premium, high limit); the rate-limited public RPC is
  // the last-resort fallback so normal read/write load goes to high-limit endpoints and only
  // degrades to public if they all fail.
  const ordered = [alchemy, drpc, quiknode, override?.trim(), ARC_PUBLIC_RPC].filter(
    (url): url is string => Boolean(url),
  );
  return Array.from(new Set(ordered));
}

/**
 * Fallback HTTP transport across the ordered Arc RPCs. viem's `fallback` advances to the next
 * endpoint on error (so a throttled/down provider transparently fails over), and each leg batches
 * JSON-RPC calls into a single request via Multicall3-friendly batching.
 */
export function arcReadTransport(rpcUrl?: string) {
  const transports = arcRpcUrls(rpcUrl).map((url) => http(url, { batch: true }));
  return fallback(transports, { rank: false });
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
