import { createPublicClient, formatUnits, isAddress, type Address } from 'viem';
import { getArcConfig, getArcChainId } from './arcConfig';
import { ARC_READ_BATCH, arcReadTransport } from './arcClient';
import { erc20Abi } from './contracts';

// Presto is USDC-only. StableSymbol is kept as a (single-member) type so the
// pay-with plumbing stays typed and easy to extend later if another stable is added.
export type StableSymbol = 'USDC';

function formatAmount(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

async function fetchErc20Balance(address: string, token: Address): Promise<string | null> {
  const config = getArcConfig();
  if (!config.rpcUrl || !isAddress(address) || !isAddress(token)) return null;

  const client = createPublicClient({
    chain: {
      id: getArcChainId(),
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    },
    transport: arcReadTransport(config.rpcUrl),
    batch: ARC_READ_BATCH,
  });

  const balance = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Address],
  });
  return formatUnits(balance, 6);
}

export async function fetchArcUsdcBalance(address: string): Promise<string | null> {
  const config = getArcConfig();
  if (!config.usdcAddress) return null;
  const raw = await fetchErc20Balance(address, config.usdcAddress as Address);
  return raw === null ? null : formatAmount(Number(raw));
}

export async function fetchArcStableBalances(address: string): Promise<Record<StableSymbol, string | null>> {
  return { USDC: await fetchArcUsdcBalance(address) };
}
