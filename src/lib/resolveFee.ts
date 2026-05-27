/**
 * Agent-assisted resolution fee.
 *
 * When a market creator picks "Agent assisted" resolution, the agent wallet will run
 * auto-resolve and pay Arc gas to settle. To keep the agent funded, the creation flow
 * charges a flat USDC fee and forwards it to the agent wallet after the market exists.
 *
 * The fee is tunable via env: NEXT_PUBLIC_PRESTO_AGENT_RESOLVE_FEE_USDC (default 0.50).
 * 0.50 USDC is generous on Arc (gas is sub-cent) but leaves headroom for repeat tries.
 *
 * Trust model: the user transfers USDC directly to the agent address after creation.
 * There is no escrow contract; the agent holds the balance until it resolves the
 * market. Acceptable for testnet; mainnet would want a real escrow.
 */

export const RESOLVE_FEE_USDC_DEFAULT = '0.50';

export function getResolveFeeUsdc(): string {
  const env = (process.env.NEXT_PUBLIC_PRESTO_AGENT_RESOLVE_FEE_USDC ?? '').trim();
  if (!env) return RESOLVE_FEE_USDC_DEFAULT;
  const n = Number(env);
  if (!Number.isFinite(n) || n < 0) return RESOLVE_FEE_USDC_DEFAULT;
  return env;
}

export function isAgentResolutionMode(mode: string | undefined | null): boolean {
  return mode === 'Agent assisted';
}

export function getAgentResolverSelectionError(input: {
  resolutionMode: string | undefined | null;
  resolver: string;
  agentResolverAddress?: string;
}): string | null {
  if (!isAgentResolutionMode(input.resolutionMode)) return null;
  if (!input.agentResolverAddress) {
    return 'Agent assisted resolution is unavailable because the Presto agent wallet is not configured.';
  }
  if (input.resolver.toLowerCase() !== input.agentResolverAddress.toLowerCase()) {
    return 'Agent assisted markets must use the configured Presto agent resolver.';
  }
  return null;
}

/** Server-side helper to read the agent's onchain wallet address. */
export async function fetchAgentAddress(origin: string): Promise<string | null> {
  try {
    const res = await fetch(`${origin}/api/agents/identity`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json() as { agent?: { address?: string } };
    return data.agent?.address ?? null;
  } catch {
    return null;
  }
}
