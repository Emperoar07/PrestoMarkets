import { createPublicClient, formatUnits, http, isAddress, type Address } from 'viem';
import { getArcConfig, getArcChainId } from './arcConfig';
import { erc20Abi } from './contracts';

export type StableSymbol = 'USDC' | 'EURC';

function formatAmount(amount: number, symbol: StableSymbol): string {
  const prefix = symbol === 'EURC' ? '€' : '$';
  if (amount >= 1_000_000) return `${prefix}${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${prefix}${(amount / 1_000).toFixed(2)}K`;
  return `${prefix}${amount.toFixed(2)}`;
}

async function fetchErc20Balance(address: string, token: Address): Promise<string | null> {
  const config = getArcConfig();
  if (!config.rpcUrl || !isAddress(address) || !isAddress(token)) return null;

  const client = createPublicClient({
    chain: {
      id: getArcChainId(),
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    },
    transport: http(config.rpcUrl),
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
  return raw === null ? null : formatAmount(Number(raw), 'USDC');
}

export async function fetchArcEurcBalance(address: string): Promise<string | null> {
  const config = getArcConfig();
  if (!config.eurcAddress) return null;
  const raw = await fetchErc20Balance(address, config.eurcAddress as Address);
  return raw === null ? null : formatAmount(Number(raw), 'EURC');
}

export async function fetchArcStableBalances(address: string): Promise<Record<StableSymbol, string | null>> {
  const [usdc, eurc] = await Promise.all([
    fetchArcUsdcBalance(address).catch(() => null),
    fetchArcEurcBalance(address).catch(() => null),
  ]);
  return { USDC: usdc, EURC: eurc };
}
