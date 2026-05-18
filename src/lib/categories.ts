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

export const createMarketCategories = [
  ...primaryMarketCategories.filter((category) => category !== 'More'),
  ...topicMarketCategories.filter((category) => category !== 'All'),
] as const;
