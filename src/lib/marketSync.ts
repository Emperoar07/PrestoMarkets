import type { AppMarket } from './appState';

type ReceiptLike = {
  status: string;
  logs: Array<{ address: string }>;
};

export function receiptTouchesMarket(receipt: ReceiptLike, marketId: string): boolean {
  if (receipt.status !== 'success') return false;
  const target = marketId.toLowerCase();
  return receipt.logs.some((log) => log.address.toLowerCase() === target);
}

export function mergeSyncedMarket(markets: AppMarket[], fresh: AppMarket): AppMarket[] {
  const target = fresh.id.toLowerCase();
  const index = markets.findIndex((market) => market.id.toLowerCase() === target);
  if (index < 0) return [...markets, fresh];
  const next = [...markets];
  next[index] = fresh;
  return next;
}
