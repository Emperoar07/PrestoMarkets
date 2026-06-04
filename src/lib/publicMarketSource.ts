import { markets as staticMarkets } from './markets';
import { fetchOnchainMarkets } from './onchainMarkets';
import type { Market } from './markets';

export async function getPublicMarkets(): Promise<Market[]> {
  const liveMarkets = await fetchOnchainMarkets().catch(() => []);
  return liveMarkets.length > 0 ? liveMarkets : staticMarkets;
}

export async function getPublicMarket(id: string): Promise<Market | null> {
  const normalized = id.toLowerCase();
  const markets = await getPublicMarkets();
  return markets.find((market) => market.id.toLowerCase() === normalized) ?? null;
}
