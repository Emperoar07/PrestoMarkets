import { createPublicClient, formatUnits, http, isAddress, type Address } from 'viem';
import { getArcConfig, getArcChainId } from './arcConfig';
import { erc20Abi } from './contracts';

export async function fetchArcUsdcBalance(address: string) {
  const config = getArcConfig();

  if (!config.rpcUrl || !config.usdcAddress || !isAddress(address) || !isAddress(config.usdcAddress)) {
    return null;
  }

  const client = createPublicClient({
    chain: {
      id: getArcChainId(),
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
      rpcUrls: {
        default: { http: [config.rpcUrl] },
      },
    },
    transport: http(config.rpcUrl),
  });

  const balance = await client.readContract({
    address: config.usdcAddress as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address as Address],
  });
  const amount = Number(formatUnits(balance, 6));

  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;

  return `$${amount.toFixed(2)}`;
}
