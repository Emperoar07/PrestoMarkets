import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchOnchainMarkets = vi.fn();

vi.mock('../onchainMarkets', () => ({
  fetchOnchainMarkets,
}));

describe('publicMarketSource', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    fetchOnchainMarkets.mockReset();
  });

  it('does not substitute static demo markets when Arc returns no live markets', async () => {
    fetchOnchainMarkets.mockResolvedValue([]);
    const { getPublicMarkets } = await import('../publicMarketSource');

    await expect(getPublicMarkets()).resolves.toEqual([]);
  });

  it('does not substitute static demo markets when Arc market reads fail', async () => {
    fetchOnchainMarkets.mockRejectedValue(new Error('RPC down'));
    const { getPublicMarkets } = await import('../publicMarketSource');

    await expect(getPublicMarkets()).resolves.toEqual([]);
  });
});
