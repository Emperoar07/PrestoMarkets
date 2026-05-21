import type { StableSymbol } from './swap';

const KEY_PREFIX = 'presto:payWith:v1:';

function key(account: string, marketId: string): string {
  return `${KEY_PREFIX}${account.toLowerCase()}:${marketId.toLowerCase()}`;
}

export function readPayWith(account: string | undefined, marketId: string): StableSymbol | null {
  if (typeof window === 'undefined' || !account) return null;
  try {
    const raw = window.localStorage.getItem(key(account, marketId));
    if (raw === 'USDC' || raw === 'EURC') return raw;
    return null;
  } catch {
    return null;
  }
}

export function writePayWith(account: string | undefined, marketId: string, symbol: StableSymbol): void {
  if (typeof window === 'undefined' || !account) return;
  try {
    window.localStorage.setItem(key(account, marketId), symbol);
  } catch {
    // ignore quota / disabled storage
  }
}
