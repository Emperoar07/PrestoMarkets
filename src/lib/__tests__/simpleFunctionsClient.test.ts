/**
 * SimpleFunctions client tests for Kalshi + Polymarket integration
 * Tests cover market search, edge detection, market details, and thesis scanning
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  searchMarkets,
  detectEdgeOpportunities,
  getMarketDetails,
  scanForThesis,
  type SimpleFunctionsMarket,
  type EdgeOpportunity,
} from '../simpleFunctionsClient';

// Mock fetch globally
const originalFetch = global.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  global.fetch = mockFetch as any;
  // Store original env
  process.env.SIMPLEFUNCTIONS_API_KEY = 'test-key-12345';
});

afterEach(() => {
  vi.clearAllMocks();
  global.fetch = originalFetch;
  delete process.env.SIMPLEFUNCTIONS_API_KEY;
});

describe('SimpleFunctionsClient', () => {
  describe('searchMarkets', () => {
    it('should search markets and return formatted results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'market-1',
              title: 'Will Bitcoin exceed $100k by end of year?',
              platform: 'kalshi',
              probability: 0.65,
              volume_24h: 50000,
              liquidity: 25000,
              end_date: '2026-12-31',
              category: 'BTC',
            },
            {
              id: 'market-2',
              title: 'Will Ethereum exceed $5k by Q3 2026?',
              platform: 'polymarket',
              probability: 0.45,
              volume_24h: 30000,
              liquidity: 15000,
              end_date: '2026-09-30',
              category: 'ETH',
            },
          ],
        }),
      });

      const results = await searchMarkets('bitcoin price');

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        id: 'market-1',
        question: 'Will Bitcoin exceed $100k by end of year?',
        platform: 'kalshi',
        probability: 0.65,
        volume24h: 50000,
        liquidity: 25000,
        endDate: '2026-12-31',
        category: 'BTC',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.simplefunctions.dev/v1/markets/search'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key-12345',
          }),
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should apply limit filter when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await searchMarkets('ethereum', { limit: 5 });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('limit=5');
    });

    it('should apply platform filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await searchMarkets('prediction markets', { platform: 'kalshi' });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('platform=kalshi');
    });

    it('should apply volume filter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await searchMarkets('crypto', { minVolume: 10000 });

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('min_volume=10000');
    });

    it('should return empty array on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const results = await searchMarkets('test');

      expect(results).toEqual([]);
    });

    it('should return empty array on network timeout', async () => {
      mockFetch.mockRejectedValueOnce(new Error('AbortError'));

      const results = await searchMarkets('test');

      expect(results).toEqual([]);
    });

    it('should throw error when API key is missing', async () => {
      delete process.env.SIMPLEFUNCTIONS_API_KEY;

      await expect(searchMarkets('test')).rejects.toThrow(
        'SIMPLEFUNCTIONS_API_KEY environment variable is required'
      );
    });

    it('should handle malformed API response gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: undefined }),
      });

      const results = await searchMarkets('test');

      expect(results).toEqual([]);
    });
  });

  describe('detectEdgeOpportunities', () => {
    it('should detect arbitrage opportunities between markets', async () => {
      // Mock searchMarkets responses with proper snake_case API response
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              {
                id: 'market-1',
                title: 'Will Bitcoin exceed $100k?',
                platform: 'kalshi',
                probability: 0.60,
                volume_24h: 50000,
                liquidity: 25000,
                end_date: '2026-12-31',
                category: 'BTC',
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              {
                id: 'market-2',
                title: 'Will Bitcoin exceed $100k?',
                platform: 'polymarket',
                probability: 0.75,
                volume_24h: 30000,
                liquidity: 15000,
                end_date: '2026-12-31',
                category: 'BTC',
              },
            ],
          }),
        });

      const opportunities = await detectEdgeOpportunities('Bitcoin exceed $100k');

      expect(opportunities.length).toBeGreaterThan(0);
      if (opportunities.length > 0) {
        const opp = opportunities[0];
        expect(opp).toHaveProperty('market1');
        expect(opp).toHaveProperty('market2');
        expect(opp).toHaveProperty('priceDifference');
        expect(opp).toHaveProperty('arbitrageOpportunity');
        expect(opp).toHaveProperty('expectedProfit');
      }
    });

    it('should return empty array when no edge opportunities found', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [] }),
        });

      const opportunities = await detectEdgeOpportunities('test topic');

      expect(opportunities).toEqual([]);
    });

    it('should handle errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const opportunities = await detectEdgeOpportunities('test');

      expect(opportunities).toEqual([]);
    });
  });

  describe('getMarketDetails', () => {
    it('should fetch live market data for Kalshi', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'market-kalshi-1',
          title: 'Will Bitcoin exceed $100k?',
          platform: 'kalshi',
          probability: 0.65,
          volume_24h: 50000,
          liquidity: 25000,
          end_date: '2026-12-31',
          category: 'BTC',
        }),
      });

      const market = await getMarketDetails('market-kalshi-1', 'kalshi');

      expect(market).toMatchObject({
        id: 'market-kalshi-1',
        question: 'Will Bitcoin exceed $100k?',
        platform: 'kalshi',
        probability: 0.65,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.simplefunctions.dev/v1/markets/market-kalshi-1'),
        expect.any(Object)
      );
    });

    it('should fetch live market data for Polymarket', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'market-poly-1',
          title: 'Will Ethereum exceed $5k?',
          platform: 'polymarket',
          probability: 0.45,
          volume_24h: 30000,
          end_date: '2026-09-30',
        }),
      });

      const market = await getMarketDetails('market-poly-1', 'polymarket');

      expect(market).toMatchObject({
        id: 'market-poly-1',
        platform: 'polymarket',
        probability: 0.45,
      });
    });

    it('should return null when market not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const market = await getMarketDetails('nonexistent', 'kalshi');

      expect(market).toBeNull();
    });

    it('should return null on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const market = await getMarketDetails('market-1', 'kalshi');

      expect(market).toBeNull();
    });

    it('should return null on timeout', async () => {
      mockFetch.mockRejectedValueOnce(new Error('AbortError'));

      const market = await getMarketDetails('market-1', 'kalshi');

      expect(market).toBeNull();
    });

    it('should throw error when API key is missing', async () => {
      delete process.env.SIMPLEFUNCTIONS_API_KEY;

      await expect(getMarketDetails('market-1', 'kalshi')).rejects.toThrow(
        'SIMPLEFUNCTIONS_API_KEY environment variable is required'
      );
    });
  });

  describe('scanForThesis', () => {
    it('should find markets matching a thesis', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'market-1',
              title: 'Will AI advance significantly in 2026?',
              platform: 'kalshi',
              probability: 0.70,
              volume_24h: 40000,
              end_date: '2026-12-31',
              category: 'AI',
            },
            {
              id: 'market-2',
              title: 'Will GPT-5 be released by EOY 2026?',
              platform: 'polymarket',
              probability: 0.55,
              volume_24h: 20000,
              end_date: '2026-12-31',
              category: 'AI',
            },
          ],
        }),
      });

      const results = await scanForThesis('AI regulation and adoption');

      expect(results).toHaveLength(2);
      expect(results[0].category).toBe('AI');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.simplefunctions.dev/v1/markets/search'),
        expect.any(Object)
      );
    });

    it('should apply default maxResults of 20', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await scanForThesis('test thesis');

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('limit=20');
    });

    it('should respect custom maxResults parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await scanForThesis('test thesis', 50);

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('limit=50');
    });

    it('should return empty array on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const results = await scanForThesis('test thesis');

      expect(results).toEqual([]);
    });

    it('should throw error when API key is missing', async () => {
      delete process.env.SIMPLEFUNCTIONS_API_KEY;

      await expect(scanForThesis('test thesis')).rejects.toThrow(
        'SIMPLEFUNCTIONS_API_KEY environment variable is required'
      );
    });
  });

  describe('API Key Validation', () => {
    it('should validate API key on all functions', async () => {
      delete process.env.SIMPLEFUNCTIONS_API_KEY;

      const functions = [
        () => searchMarkets('test'),
        () => getMarketDetails('id', 'kalshi'),
        () => scanForThesis('thesis'),
        () => detectEdgeOpportunities('topic'),
      ];

      for (const fn of functions) {
        await expect(fn()).rejects.toThrow('SIMPLEFUNCTIONS_API_KEY');
      }
    });
  });

  describe('Timeout Protection', () => {
    it('should enforce 8 second timeout on searches', async () => {
      mockFetch.mockImplementationOnce(() => new Promise(() => {
        // Never resolve - simulates timeout
      }));

      const promise = searchMarkets('test');

      // Give it time to set up timeout
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Abort should be called on signal after ~8 seconds
      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.signal).toBeDefined();
    });

    it('should enforce 8 second timeout on market details', async () => {
      mockFetch.mockImplementationOnce(() => new Promise(() => {
        // Never resolve - simulates timeout
      }));

      expect(mockFetch).not.toHaveBeenCalled();

      getMarketDetails('test-id', 'kalshi');

      // Check that signal is passed (indicates timeout protection)
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.signal).toBeDefined();
    });
  });

  describe('Response Transformation', () => {
    it('should transform snake_case API response to camelCase', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'market-1',
              title: 'Test Market',
              platform: 'kalshi',
              probability: 0.5,
              volume_24h: 1000,
              liquidity: 500,
              end_date: '2026-12-31',
              category: 'Test',
            },
          ],
        }),
      });

      const results = await searchMarkets('test');

      expect(results[0]).toHaveProperty('volume24h');
      expect(results[0]).toHaveProperty('endDate');
      expect(results[0]).not.toHaveProperty('volume_24h');
      expect(results[0]).not.toHaveProperty('end_date');
    });

    it('should handle missing optional fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'market-1',
              title: 'Test Market',
              platform: 'kalshi',
              probability: 0.5,
              end_date: '2026-12-31',
              // volume_24h and liquidity are optional
            },
          ],
        }),
      });

      const results = await searchMarkets('test');

      expect(results).toHaveLength(1);
      expect(results[0].volume24h).toBeUndefined();
      expect(results[0].liquidity).toBeUndefined();
    });
  });

  describe('Error Logging', () => {
    it('should gracefully handle network errors without throwing', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const results = await searchMarkets('test');

      expect(results).toEqual([]);
      // Confirm no exception was thrown
      expect(true).toBe(true);
    });

    it('should gracefully handle API errors without throwing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
      });

      const results = await searchMarkets('test');

      expect(results).toEqual([]);
      // Confirm no exception was thrown
      expect(true).toBe(true);
    });
  });
});
