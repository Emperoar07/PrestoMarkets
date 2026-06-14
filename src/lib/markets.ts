export type MarketType = 'Prediction' | 'Opinion';
export type MarketStatus = 'Open' | 'Closing soon' | 'Closed' | 'Resolved' | 'Canceled' | 'Draft';
export type ResolutionMode = 'Human resolver' | 'Community resolver' | 'Agent assisted';
export type MarketCreatedByType = 'user' | 'admin' | 'agent';
export type MarketDisplayType = 'binary' | 'multi_outcome' | 'date_ladder' | 'sports_live' | 'pulse_gauge';

export type MarketOutcome = {
  label: string;
  odds: number;
  liquidity: string;
  /** Optional per-outcome image (team flag/crest, candidate photo…). From metadata.outcomeImages. */
  image?: string;
};

export type MarketActivity = {
  label: string;
  value: string;
};

export type Market = {
  id: string;
  type: MarketType;
  title: string;
  description: string;
  imageURI?: string;
  /** Primary category (kept for backward compat). Use `categories` for the full list. */
  category: string;
  /** Up to 4 categories tagging this market. Always includes `category` as the first entry. */
  categories?: string[];
  volume: string;
  liquidity: string;
  closeLabel: string;
  status: MarketStatus;
  collateral: 'USDC';
  chain: 'Arc Testnet';
  resolver: string;
  resolverAddress?: string;
  resolutionMode: ResolutionMode;
  /**
   * True only when the on-chain `resolver` address equals the platform's trusted
   * oracle (NEXT_PUBLIC_MARKET_RESOLVER_ADDRESS). Derived from the on-chain address,
   * NOT from metadata — a creator can label any market "Agent assisted" in metadata
   * while naming themselves resolver, so this flag is the real trust signal.
   */
  resolverVerified?: boolean;
  sourceOfTruth: string;
  rules: string;
  rulesSchema?: {
    type: MarketType;
    outcomes: string[];
    sourceOfTruth: string;
    resolverMode: string;
    closeRule: string;
    settlementAsset: 'USDC';
  };
  createdBy: string;
  createdByType?: MarketCreatedByType;
  /** Agent-classified card layout. When unset, the UI derives it from market shape. */
  displayType?: MarketDisplayType;
  creatorAddress?: string;
  agentName?: string;
  agentSource?: string;
  agentModel?: string;
  agentReason?: string;
  agentConfidence?: string;
  trendSource?: string;
  trendUrl?: string;
  momentumScore?: number;
  safetyScore?: number;
  kickoffTime?: string;
  feeMode: string;
  pollOptions?: string[];
  outcomes: MarketOutcome[];
  activity: MarketActivity[];
};

export const markets: Market[] = [
  {
    id: 'arc-stablecoin-volume',
    type: 'Prediction',
    title: 'Will Arc stablecoin DEX volume pass $10M before June?',
    description: 'A binary market for forecasting Arc stablecoin activity across public DEX venues.',
    category: 'Arc',
    volume: '$18.4K',
    liquidity: '$9.2K',
    closeLabel: '22 days',
    status: 'Open',
    collateral: 'USDC',
    chain: 'Arc Testnet',
    resolver: 'Presto council',
    resolutionMode: 'Human resolver',
    sourceOfTruth: 'Public DEX dashboards, Arc explorers, and published protocol analytics.',
    rules: 'YES wins if verified Arc stablecoin DEX volume reaches or exceeds $10M before the listed close time. Otherwise NO wins.',
    createdBy: '0x1179...bB69',
    feeMode: 'Protocol fee scaffolded, disabled in UI until deployment.',
    outcomes: [
      { label: 'YES', odds: 62, liquidity: '$5.7K' },
      { label: 'NO', odds: 38, liquidity: '$3.5K' },
    ],
    activity: [
      { label: 'Trades', value: '128' },
      { label: 'Holders', value: '42' },
      { label: '24h volume', value: '$2.1K' },
    ],
  },
  {
    id: 'best-arc-builder-tool',
    type: 'Opinion',
    title: 'Which builder tool should Presto prioritize next?',
    description: 'Signal product conviction with USDC-backed outcome shares and transparent rules.',
    category: 'Product',
    volume: '$6.1K',
    liquidity: '$3.8K',
    closeLabel: '9 days',
    status: 'Open',
    collateral: 'USDC',
    chain: 'Arc Testnet',
    resolver: 'Community steward',
    resolutionMode: 'Community resolver',
    sourceOfTruth: 'Final public roadmap decision posted by the Presto team.',
    rules: 'YES represents prioritizing market creation tools. NO represents prioritizing analytics and portfolio tools first.',
    createdBy: '0x93c4...19f2',
    feeMode: 'Creator fee planned after V1 audit.',
    outcomes: [
      { label: 'YES', odds: 48, liquidity: '$1.8K' },
      { label: 'NO', odds: 52, liquidity: '$2.0K' },
    ],
    activity: [
      { label: 'Votes traded', value: '61' },
      { label: 'Participants', value: '19' },
      { label: 'Comments', value: '8' },
    ],
  },
  {
    id: 'arc-consumer-app-gap',
    type: 'Opinion',
    title: 'Should consumer payments be Arc builders top focus this quarter?',
    description: 'A public opinion market for surfacing where builders should focus next.',
    category: 'Ecosystem',
    volume: '$11.9K',
    liquidity: '$7.5K',
    closeLabel: '14 days',
    status: 'Closing soon',
    collateral: 'USDC',
    chain: 'Arc Testnet',
    resolver: 'Presto council',
    resolutionMode: 'Agent assisted',
    sourceOfTruth: 'Public Arc ecosystem submissions, builder activity, and confirmed launch announcements.',
    rules: 'YES wins if consumer payments receives the most verified ecosystem submissions and builder commitments by close.',
    createdBy: '0x2bc8...a714',
    feeMode: 'USDC funding only for V1.',
    outcomes: [
      { label: 'YES', odds: 71, liquidity: '$5.3K' },
      { label: 'NO', odds: 29, liquidity: '$2.2K' },
    ],
    activity: [
      { label: 'Signals', value: '204' },
      { label: 'Builders', value: '37' },
      { label: 'Open ideas', value: '16' },
    ],
  },
];

export function getMarket(id: string) {
  return markets.find((market) => market.id === id) ?? markets[0];
}
