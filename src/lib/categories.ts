export const primaryMarketCategories = [
  'Trending',
  'Breaking',
  'New',
  'Politics',
  'Sports',
  'Crypto',
  'Esports',
  'Iran',
  'Finance',
  'Geopolitics',
  'Tech',
  'Culture',
  'Economy',
  'Weather',
  'Mentions',
  'Elections',
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
