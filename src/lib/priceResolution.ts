/**
 * Deterministic price resolution for crypto price-range and conviction
 * (price-target) markets. These markets declare a CoinGecko source and a numeric
 * target/ranges, so they can be settled by reading the price directly — no LLM,
 * no web search. This is cheaper, faster, and more accurate than the evidence
 * pipeline, and lets resolution run frequently (e.g. an external cron) so short
 * conviction windows can settle promptly.
 *
 * Safety: every function is conservative. If the market can't be parsed with full
 * confidence (unknown asset, non-CoinGecko source, ambiguous labels, price
 * unavailable), it returns null and the caller falls back to the LLM evidence
 * flow. It never guesses.
 */
import { logger } from './logger';

export type ResolvableMarket = {
  title: string;
  category?: string;
  sourceOfTruth: string;
  outcomes: Array<{ label: string }>;
};

export type DeterministicResolution = {
  /** Winning outcome label, matched verbatim against market.outcomes[].label. */
  label: string;
  summary: string;
  sourceUrl: string;
  price: number;
};

const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';

const ASSETS: Array<{ id: string; symbol: string; match: RegExp }> = [
  { id: 'bitcoin', symbol: 'BTC', match: /\b(bitcoin|btc)\b/i },
  { id: 'ethereum', symbol: 'ETH', match: /\b(ethereum|eth)\b/i },
  { id: 'solana', symbol: 'SOL', match: /\b(solana|sol)\b/i },
];

/** Identify the crypto asset a market is about, or null if not one of ours. */
export function identifyAsset(market: ResolvableMarket): { id: string; symbol: string } | null {
  const haystack = `${market.title} ${market.category ?? ''} ${market.sourceOfTruth}`;
  for (const asset of ASSETS) {
    if (asset.match.test(haystack)) return { id: asset.id, symbol: asset.symbol };
  }
  return null;
}

/** Parse every "$1,234.5" style USD amount from text, largest-context first. */
export function parseUsdAmounts(text: string): number[] {
  return Array.from(text.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g))
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Resolve a price-RANGE market. Outcome labels look like:
 *   "Below $69,000" | "$69,000 to under $74,000" | "$74,000 or above"
 * Returns the single label whose band contains `price`, or null if exactly one
 * match can't be determined.
 */
export function resolveRangeOutcome(labels: string[], price: number): string | null {
  const matches = labels.filter((label) => {
    const amounts = parseUsdAmounts(label);
    const lower = /\b(below|under|less than|or below|or lower)\b/i.test(label);
    const upper = /\b(above|or above|over|greater|or higher)\b/i.test(label);
    const between = amounts.length >= 2 && /\bto\b/i.test(label);

    if (between) return price >= amounts[0] && price < amounts[1];
    if (amounts.length === 1 && lower) return price < amounts[0];
    if (amounts.length === 1 && upper) return price >= amounts[0];
    return false;
  });

  return matches.length === 1 ? matches[0] : null;
}

/**
 * Resolve a binary conviction (price-target) market from its title, e.g.
 *   "Will Bitcoin reach $74,000 by Jun 5, 2026?"  (YES if price >= target)
 *   "Will Solana fall to $120 by ...?"            (YES if price <= target)
 * Requires exactly YES/NO outcomes, one parseable target, and a clear direction.
 */
export function resolveBinaryTargetOutcome(
  title: string,
  labels: string[],
  price: number,
): string | null {
  const normalized = labels.map((l) => l.trim().toUpperCase());
  if (normalized.length !== 2 || !normalized.includes('YES') || !normalized.includes('NO')) {
    return null;
  }
  const targets = parseUsdAmounts(title);
  if (targets.length !== 1) return null;
  const target = targets[0];

  const up = /\b(reach|above|exceed|hit|over|surpass|cross|break)\b/i.test(title);
  const down = /\b(fall|drop|below|under|dip|decline|lose)\b/i.test(title);
  if (up === down) return null; // ambiguous or neither

  const yes = up ? price >= target : price <= target;
  const winner = yes ? 'YES' : 'NO';
  // Return the label using the market's original casing.
  return labels.find((l) => l.trim().toUpperCase() === winner) ?? winner;
}

export async function fetchAssetUsdPrice(assetId: string): Promise<number | null> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: HeadersInit = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${COINGECKO_PRICE_URL}?ids=${assetId}&vs_currencies=usd`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const price = data[assetId]?.usd;
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
  } catch (error) {
    logger.warn('price-resolution', `CoinGecko price fetch failed for ${assetId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Historical USD price of an asset at (approximately) a given time — used to snapshot the price at
 * a price market's close so the settlement view shows the value that decided the outcome rather
 * than a drifting live price. Pulls a ±2h window from CoinGecko and returns the closest reading.
 */
export async function fetchAssetUsdPriceAt(assetId: string, atMs: number): Promise<number | null> {
  const apiKey = process.env.COINGECKO_API_KEY;
  const headers: HeadersInit = apiKey ? { 'x-cg-demo-api-key': apiKey } : {};
  const atSec = Math.floor(atMs / 1000);
  const from = atSec - 2 * 3600;
  const to = atSec + 2 * 3600;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${assetId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`,
      { headers, signal: controller.signal },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { prices?: Array<[number, number]> };
    const prices = data.prices ?? [];
    if (prices.length === 0) return null;
    let best = prices[0];
    for (const point of prices) {
      if (Math.abs(point[0] - atMs) < Math.abs(best[0] - atMs)) best = point;
    }
    const price = best[1];
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
  } catch (error) {
    logger.warn('price-resolution', `CoinGecko historical price fetch failed for ${assetId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Try to settle a crypto price market deterministically. Returns the winning
 * outcome or null (caller falls back to the LLM evidence pipeline).
 */
export async function tryDeterministicPriceResolution(
  market: ResolvableMarket,
): Promise<DeterministicResolution | null> {
  // Gate 1: only markets that declared a CoinGecko source.
  if (!/coingecko/i.test(market.sourceOfTruth)) return null;

  // Gate 2: must be one of our supported assets.
  const asset = identifyAsset(market);
  if (!asset) return null;

  const labels = market.outcomes.map((o) => o.label).filter(Boolean);
  if (labels.length < 2) return null;

  const price = await fetchAssetUsdPrice(asset.id);
  if (price == null) return null;

  const isBinary = labels.length === 2
    && labels.map((l) => l.trim().toUpperCase()).every((l) => l === 'YES' || l === 'NO');

  const winner = isBinary
    ? resolveBinaryTargetOutcome(market.title, labels, price)
    : resolveRangeOutcome(labels, price);

  if (!winner) return null;

  const priceStr = `$${price.toLocaleString(undefined, { maximumFractionDigits: price < 10 ? 2 : 0 })}`;
  return {
    label: winner,
    price,
    sourceUrl: market.sourceOfTruth.match(/https?:\/\/[^\s,)]+/i)?.[0] ?? COINGECKO_PRICE_URL,
    summary: `Deterministic settlement: ${asset.symbol} CoinGecko price at/after close was ${priceStr}, which resolves to "${winner}".`,
  };
}
