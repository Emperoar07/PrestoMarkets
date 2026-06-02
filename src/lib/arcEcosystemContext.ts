type TrendLike = {
  topic: string;
  query?: string;
  source?: string;
  url?: string;
};

export const ARC_HOUSE_PREDICTION_MARKETS_URL =
  'https://community.arc.io/public/externals/build-institutional-grade-prediction-markets-on-arc-or-arc-blueprints-2026-05-15';

export const ARC_HOUSE_AGENTIC_ECONOMY_URL =
  'https://community.arc.io/public/clubs/agentic-economy-dofua/overview';

export const ARC_HOUSE_GOLDSKY_URL =
  'https://community.arc.io/en/public/blogs/goldsky-arc-builders-fund-real-time-data-infrastructure-for-onchain-finance-2026-05-26';

export const ARC_ECOSYSTEM_CONTEXT_SUMMARY = [
  'Arc House and Arc Blueprints are read-only ecosystem context for Presto market selection.',
  'Arc explicitly frames prediction markets, agentic systems, real-time data, and institutional workflows as strong Arc use cases.',
  'Use this context to prioritize macro, policy, FX, stablecoin, onchain data, agentic commerce, and operational-risk markets when they have primary evidence.',
  'Never use Arc House community posts as the final source of truth for settlement; resolve against official data, price providers, league sources, regulators, company disclosures, or reputable primary news.',
].join(' ');

const ARC_COMMUNITY_HOSTS = new Set(['community.arc.io', 'community.arc.network']);

const ARC_INSTITUTIONAL_THEME_TERMS = [
  'cpi',
  'inflation',
  'fed',
  'interest rate',
  'jobs report',
  'unemployment',
  'gdp',
  'fx',
  'foreign exchange',
  'stablecoin',
  'usdc',
  'eurc',
  'agentic',
  'ai agent',
  'onchain economy',
  'payments',
  'settlement',
  'tokenization',
  'private credit',
  'perpetuals',
  'market data',
  'risk monitoring',
  'geopolitical',
  'operational risk',
  'central bank',
  'regulator',
  'policy decision',
];

function hostOf(value?: string) {
  if (!value) return '';
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isArcCommunityContextUrl(value?: string) {
  return ARC_COMMUNITY_HOSTS.has(hostOf(value));
}

export function isArcInstitutionalMarketTheme(trend: TrendLike) {
  const haystack = `${trend.source ?? ''} ${trend.topic} ${trend.query ?? ''}`.toLowerCase();
  return ARC_INSTITUTIONAL_THEME_TERMS.some((term) => haystack.includes(term));
}

export function getArcEcosystemPriorityBoost(trend: TrendLike) {
  if (isArcCommunityContextUrl(trend.url)) return 0;
  return isArcInstitutionalMarketTheme(trend) ? 6 : 0;
}
