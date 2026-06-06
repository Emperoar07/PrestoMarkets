import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGeneratedMarketImageUrl, getGeneratedMarketImageBaseUrl } from '../generatedMarketImage';

describe('generatedMarketImage', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
  });

  it('builds a first-party fallback image URL for agent markets without source images', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://presto.example');

    const url = buildGeneratedMarketImageUrl({
      title: 'Will SoftBank begin construction on its French AI data center by Dec 31, 2026?',
      category: 'Tech',
      source: 'agent',
    });

    expect(url).toContain('https://presto.example/api/market-image?');
    expect(url).toContain('title=Will+SoftBank+begin+construction');
    expect(url).toContain('category=Tech');
    expect(url).toContain('source=agent');
  });

  it('falls back to the production app URL when no deployment URL is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('VERCEL_URL', '');

    expect(getGeneratedMarketImageBaseUrl()).toBe('https://presto-markets.vercel.app');
  });
});
