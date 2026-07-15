import { describe, expect, it } from 'vitest';
import { refreshTimeDerivedStatus } from '../onchainMarkets';
import type { AppMarket } from '../appState';

const base = (overrides: Partial<AppMarket>): AppMarket => ({
  id: '0xmarket',
  title: 'Test market',
  status: 'Open',
  closeDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  closeLabel: '7 days',
  ...overrides,
} as AppMarket);

describe('refreshTimeDerivedStatus', () => {
  it('flips a stale Open market whose closeDate has passed to Closed', () => {
    const market = base({ status: 'Open', closeDate: new Date(Date.now() - 3_600_000).toISOString() });
    const fresh = refreshTimeDerivedStatus(market);
    expect(fresh.status).toBe('Closed');
    expect(fresh.closeLabel).toBe('Closed');
  });

  it('flips a stale Open market inside the closing-soon window', () => {
    const market = base({ status: 'Open', closeDate: new Date(Date.now() + 2 * 3_600_000).toISOString() });
    expect(refreshTimeDerivedStatus(market).status).toBe('Closing soon');
  });

  it('leaves genuinely open markets untouched (same object)', () => {
    const market = base({});
    expect(refreshTimeDerivedStatus(market)).toBe(market);
  });

  it('never rewrites chain-derived final states, even past closeDate', () => {
    for (const status of ['Resolved', 'Canceled'] as const) {
      const market = base({ status, closeDate: new Date(Date.now() - 86_400_000).toISOString() });
      expect(refreshTimeDerivedStatus(market).status).toBe(status);
    }
  });

  it('tolerates malformed closeDate', () => {
    const market = base({ closeDate: 'not-a-date' });
    expect(refreshTimeDerivedStatus(market)).toBe(market);
  });
});
