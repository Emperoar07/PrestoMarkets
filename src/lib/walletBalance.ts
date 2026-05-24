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
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
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
  const config = getArcConfig();
  if (!config.rpcUrl || !isAddress(address)) return { USDC: null, EURC: null };

  const client = createPublicClient({
    chain: {
      id: getArcChainId(),
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    },
    transport: http(config.rpcUrl),
  });

  const wallet = address as Address;
  const [usdcRaw, eurcRaw] = await Promise.all([
    config.usdcAddress && isAddress(config.usdcAddress)
      ? client.readContract({ address: config.usdcAddress as Address, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }).catch(() => null)
      : Promise.resolve(null),
    config.eurcAddress && isAddress(config.eurcAddress)
      ? client.readContract({ address: config.eurcAddress as Address, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return {
    USDC: usdcRaw === null ? null : formatAmount(Number(formatUnits(usdcRaw, 6)), 'USDC'),
    EURC: eurcRaw === null ? null : formatAmount(Number(formatUnits(eurcRaw, 6)), 'EURC'),
  };
}
