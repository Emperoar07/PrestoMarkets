export const primaryViewCategories = ['Trending', 'Breaking', 'New'] as const;

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
