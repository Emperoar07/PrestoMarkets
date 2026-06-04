import { describe, expect, it } from 'vitest';
import type { Market } from '../markets';
import {
  filterAndPageMarkets,
  getPublicApiHeaders,
  parseMarketListQuery,
  serializePublicMarket,
} from '../publicApi';
import { getMarketProbabilityHistory } from '../marketHistoryStub';

const sampleMarkets: Market[] = [
  {
    id: '0x0000000000000000000000000000000000000001',
    type: 'Prediction',
    title: 'Will Arc volume pass $10M?',
    description: 'A test market.',
    category: 'Arc',
    categories: ['Arc', 'Finance'],
    volume: '$10',
    liquidity: '$4',
    closeLabel: '2 days',
    status: 'Open',
    collateral: 'USDC',
    chain: 'Arc Testnet',
    resolver: 'Presto',
    resolutionMode: 'Human resolver',
    sourceOfTruth: 'Public source',
    rules: 'YES if it happens.',
    createdBy: '0x1179...bB69',
    feeMode: 'none',
    outcomes: [
      { label: 'YES', odds: 60, liquidity: '$2' },
      { label: 'NO', odds: 40, liquidity: '$2' },
    ],
    activity: [],
  },
  {
    id: '0x0000000000000000000000000000000000000002',
    type: 'Opinion',
    title: 'Will a product ship?',
    description: 'A second test market.',
    category: 'Tech',
    volume: '$5',
    liquidity: '$2',
    closeLabel: 'Closed',
    status: 'Closed',
    collateral: 'USDC',
    chain: 'Arc Testnet',
    resolver: 'Presto',
    resolutionMode: 'Human resolver',
    sourceOfTruth: 'Public source',
    rules: 'YES if it happens.',
    createdBy: '0x1179...bB69',
    feeMode: 'none',
    outcomes: [
      { label: 'YES', odds: 50, liquidity: '$1' },
      { label: 'NO', odds: 50, liquidity: '$1' },
    ],
    activity: [],
  },
];

describe('publicApi', () => {
  it('parses list query filters with safe limits and cursors', () => {
    const parsed = parseMarketListQuery(new URL('https://presto.test/api/v1/markets?category=arc&status=open&limit=500&cursor=MTo='));

    expect(parsed).toEqual({ category: 'arc', status: 'open', limit: 100, offset: 1 });
  });

  it('filters and pages market lists with a stable next cursor', () => {
    const page = filterAndPageMarkets(sampleMarkets, { category: 'arc', status: 'open', limit: 1, offset: 0 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe(sampleMarkets[0].id);
    expect(page.nextCursor).toBeNull();
  });

  it('serializes a market without internal activity plumbing', () => {
    const serialized = serializePublicMarket(sampleMarkets[0]);

    expect(serialized).toMatchObject({
      id: sampleMarkets[0].id,
      title: sampleMarkets[0].title,
      category: 'Arc',
      status: 'Open',
      outcomes: [
        { label: 'YES', odds: 60, probability: 0.6 },
        { label: 'NO', odds: 40, probability: 0.4 },
      ],
    });
    expect(serialized).not.toHaveProperty('activity');
  });

  it('sets read-only CORS and cache headers', () => {
    const headers = getPublicApiHeaders(30);

    expect(headers['Access-Control-Allow-Origin']).toBe('*');
    expect(headers['Cache-Control']).toContain('s-maxage=30');
  });

  it('provides an empty probability history seam until Phase 2 lands', async () => {
    await expect(getMarketProbabilityHistory(sampleMarkets[0].id)).resolves.toEqual([]);
  });
});
