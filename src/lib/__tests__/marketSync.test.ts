import { describe, expect, it } from 'vitest';
import { mergeSyncedMarket, receiptTouchesMarket } from '../marketSync';
import type { AppMarket } from '../appState';

const MARKET = '0x1111111111111111111111111111111111111111';

function market(id: string, volume: string): AppMarket {
  return {
    id,
    source: 'onchain',
    createdAt: '',
    type: 'Prediction',
    title: 'Test market',
    description: '',
    category: 'Test',
    volume,
    liquidity: volume,
    closeLabel: 'Open',
    status: 'Open',
    collateral: 'USDC',
    chain: 'Arc Testnet',
    resolver: '',
    resolutionMode: 'Human resolver',
    sourceOfTruth: '',
    rules: '',
    feeMode: '',
    createdBy: '0x0000...0000',
    outcomes: [
      { label: 'YES', odds: 50, liquidity: '$0' },
      { label: 'NO', odds: 50, liquidity: '$0' },
    ],
    activity: [],
  };
}

describe('receiptTouchesMarket', () => {
  it('accepts a successful receipt containing an event emitted by the market', () => {
    expect(receiptTouchesMarket({
      status: 'success',
      logs: [{ address: MARKET.toUpperCase() }],
    }, MARKET)).toBe(true);
  });

  it('rejects reverted receipts and receipts for another market', () => {
    expect(receiptTouchesMarket({ status: 'reverted', logs: [{ address: MARKET }] }, MARKET)).toBe(false);
    expect(receiptTouchesMarket({
      status: 'success',
      logs: [{ address: '0x2222222222222222222222222222222222222222' }],
    }, MARKET)).toBe(false);
  });
});

describe('mergeSyncedMarket', () => {
  it('replaces only the matching market and preserves list order', () => {
    const first = market(MARKET, '$1');
    const second = market('0x2222222222222222222222222222222222222222', '$2');
    const fresh = { ...first, volume: '$9', liquidity: '$9' };

    const merged = mergeSyncedMarket([first, second], fresh);

    expect(merged).toEqual([fresh, second]);
    expect(merged).not.toBe(first);
  });
});
