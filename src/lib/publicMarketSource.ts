import { fetchOnchainMarkets } from './onchainMarkets';
import type { Market } from './markets';

export async function getPublicMarkets(): Promise<Market[]> {
  return fetchOnchainMarkets().catch(() => []);
}

export async function getPublicMarket(id: string): Promise<Market | null> {
  const normalized = id.toLowerCase();
  const markets = await getPublicMarkets();
  return markets.find((market) => market.id.toLowerCase() === normalized) ?? null;
}
