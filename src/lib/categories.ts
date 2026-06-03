export const primaryViewCategories = ['Trending', 'New'] as const;

export const topicNavCategories = [
  'Politics',
  'Sports',
  'Crypto',
  'Esports',
  'Finance',
  'Geopolitics',
  'Tech',
  'Culture',
  'Economy',
  'Weather',
  'Elections',
] as const;

export const primaryMarketCategories = [
  ...primaryViewCategories,
  ...topicNavCategories,
  'More',
] as const;

export const topicMarketCategories = [
  'All',
  'BTC',
  'ETH',
  'SOL',
  'POL',
  'Football',
  'Basketball',
  'Tennis',
  'Trump',
  'Iran',
  'Trump-Xi Summit',
  'Iceman',
  'Starmer',
  'Hantavirus',
  'Cuba',
  'Gemini',
  'Strait of Hormuz',
  '2026 NBA Playoffs',
  '2026 NHL Playoffs',
  'GTA VI',
  'Music',
] as const;

// Clean topical categories for market creation. Excludes view filters (Trending/Breaking/New)
// and short-lived trend tags (those belong to the hot-topics surface, not creation taxonomy).
export const createMarketCategories = [
  ...topicNavCategories,
  'BTC',
  'ETH',
  'SOL',
  'POL',
  'Football',
  'Basketball',
  'Tennis',
] as const;

// Labels that are view modes or UI/junk, never real topic categories.
const EXCLUDED_NAV_LABELS = new Set(['trending', 'new', 'breaking', 'all', 'more', 'primary', 'secondary']);

type CategoryBearing = { category?: string | null; categories?: string[] | null };

/**
 * Categories actually present in the given markets, ranked by frequency (then alphabetically).
 * View-mode and junk labels are excluded. Pure and decoupled from the market type.
 */
export function extractMarketCategories(markets: CategoryBearing[]): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const market of markets) {
    const cats = market.categories?.length ? market.categories : market.category ? [market.category] : [];
    for (const raw of cats) {
      const label = (raw ?? '').trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (EXCLUDED_NAV_LABELS.has(key)) continue;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { label, count: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((entry) => entry.label);
}

/**
 * The curated base nav categories first (so the nav is never empty and ordering is stable),
 * then any newly discovered categories appended. Deduped case-insensitively; junk excluded.
 */
export function mergeTopicNavCategories(dynamic: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (EXCLUDED_NAV_LABELS.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  };
  for (const category of topicNavCategories) push(category);
  for (const category of dynamic) push(category);
  return out;
}
