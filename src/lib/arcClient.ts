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
import { http } from 'viem';

/** Client-level batch config: aggregate contract reads via Multicall3. */
export const ARC_READ_BATCH = { multicall: true } as const;

/** HTTP transport that also batches JSON-RPC calls into a single request. */
export function arcReadTransport(rpcUrl?: string) {
  return rpcUrl ? http(rpcUrl, { batch: true }) : http(undefined, { batch: true });
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
