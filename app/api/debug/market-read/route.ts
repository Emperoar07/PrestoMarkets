import { NextResponse } from 'next/server';
import { createPublicClient, fallback, http, type Address } from 'viem';
import { arcTestnet } from 'viem/chains';
import { getArcChainId, getArcConfig } from '@/lib/arcConfig';
import { prestoMarketFactoryAbi, prestoMultiOutcomeMarketFactoryAbi } from '@/lib/contracts';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = getArcConfig();
  const chainId = getArcChainId();
  const client = createPublicClient({
    chain: {
      ...arcTestnet,
      id: chainId,
      rpcUrls: {
        ...arcTestnet.rpcUrls,
        default: { http: config.rpcUrls },
      },
    },
    transport: fallback(config.rpcUrls.map((url) => http(url))),
  });

  const factories = [
    config.factoryAddress ? { label: 'binary', address: config.factoryAddress as Address, abi: prestoMarketFactoryAbi } : null,
    config.multiOutcomeFactoryAddress ? { label: 'multi', address: config.multiOutcomeFactoryAddress as Address, abi: prestoMultiOutcomeMarketFactoryAbi } : null,
    ...config.legacyFactoryAddresses.map((address) => ({ label: 'legacy-binary', address: address as Address, abi: prestoMarketFactoryAbi })),
    ...config.legacyMultiOutcomeFactoryAddresses.map((address) => ({ label: 'legacy-multi', address: address as Address, abi: prestoMultiOutcomeMarketFactoryAbi })),
  ].filter(Boolean) as Array<{
    label: string;
    address: Address;
    abi: typeof prestoMarketFactoryAbi | typeof prestoMultiOutcomeMarketFactoryAbi;
  }>;

  const counts = await Promise.all(factories.map(async (factory) => {
    try {
      const count = await client.readContract({
        address: factory.address,
        abi: factory.abi,
        functionName: 'marketCount',
      });
      return { label: factory.label, address: factory.address, count: Number(count), ok: true };
    } catch (error) {
      return {
        label: factory.label,
        address: factory.address,
        count: null,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  let marketRead: { ok: true; count: number; first?: string } | { ok: false; error: string };
  try {
    const markets = await fetchOnchainMarkets({ force: true });
    marketRead = { ok: true, count: markets.length, first: markets[0]?.title };
  } catch (error) {
    marketRead = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  return NextResponse.json({
    ok: true,
    chainId,
    hasRpc: Boolean(config.rpcUrl),
    rpcHosts: config.rpcUrls.map((url) => new URL(url).host),
    factoryCount: factories.length,
    counts,
    marketRead,
  });
}
