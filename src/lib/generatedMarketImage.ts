type GeneratedMarketImageInput = {
  title: string;
  category?: string;
  source?: string;
};

const DEFAULT_APP_URL = 'https://presto-markets.vercel.app';

function cleanBaseUrl(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) return undefined;
  const withProtocol = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export function getGeneratedMarketImageBaseUrl() {
  return cleanBaseUrl(process.env.NEXT_PUBLIC_APP_URL)
    ?? cleanBaseUrl(process.env.VERCEL_URL)
    ?? DEFAULT_APP_URL;
}

export function buildGeneratedMarketImageUrl(input: GeneratedMarketImageInput): string {
  const url = new URL('/api/market-image', getGeneratedMarketImageBaseUrl());
  url.searchParams.set('title', input.title.trim().slice(0, 120));
  if (input.category?.trim()) url.searchParams.set('category', input.category.trim().slice(0, 40));
  if (input.source?.trim()) url.searchParams.set('source', input.source.trim().slice(0, 40));
  return url.toString();
}
