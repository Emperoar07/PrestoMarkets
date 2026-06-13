import { formatUnits, isAddress, type Address } from 'viem';
import { getArcConfig } from './arcConfig';
import { ARC_USDC_DECIMALS, createArcReadClient } from './arcClient';
import { erc20Abi } from './contracts';

// Presto is USDC-only. StableSymbol is kept as a (single-member) type so the
// pay-with plumbing stays typed and easy to extend later if another stable is added.
export type StableSymbol = 'USDC';

function formatAmount(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

// Stale-while-revalidate cache so the header shows the last known balance instantly on reload
// instead of flashing "--" while the RPC round-trips.
const BALANCE_CACHE_PREFIX = 'presto:usdc:';

export function readCachedUsdcBalance(address: string): string | null {
  if (typeof window === 'undefined' || !address) return null;
  try {
    return window.localStorage.getItem(BALANCE_CACHE_PREFIX + address.toLowerCase());
  } catch {
    return null;
  }
}

function writeCachedUsdcBalance(address: string, value: string) {
  if (typeof window === 'undefined' || !address) return;
  try {
    window.localStorage.setItem(BALANCE_CACHE_PREFIX + address.toLowerCase(), value);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

async function fetchErc20Balance(address: string, token: Address): Promise<string | null> {
  const config = getArcConfig();
  if (!config.rpcUrl || !isAddress(address) || !isAddress(token)) return null;

  const client = createArcReadClient();
  if (!client) return null;

  const balance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Address],
  });
  return formatUnits(balance, ARC_USDC_DECIMALS);
}

export async function fetchArcUsdcBalance(address: string): Promise<string | null> {
  const config = getArcConfig();
  if (!config.usdcAddress) return null;
  const raw = await fetchErc20Balance(address, config.usdcAddress as Address);
  if (raw === null) return null;
  const formatted = formatAmount(Number(raw));
  writeCachedUsdcBalance(address, formatted);
  return formatted;
}

export async function fetchArcStableBalances(address: string): Promise<Record<StableSymbol, string | null>> {
  return { USDC: await fetchArcUsdcBalance(address) };
}
