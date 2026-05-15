export type Position = {
  marketId: string;
  title: string;
  outcome: 'YES' | 'NO';
  shares: string;
  averagePrice: string;
  currentPrice: string;
  value: string;
  status: 'Open' | 'Claimable' | 'Watching';
};

export type PortfolioActivity = {
  label: string;
  market: string;
  detail: string;
  status: 'Pending' | 'Confirmed' | 'Failed';
  time: string;
};

export const mockPositions: Position[] = [
  {
    marketId: 'arc-stablecoin-volume',
    title: 'Arc stablecoin DEX volume',
    outcome: 'YES',
    shares: '120.00',
    averagePrice: '$0.58',
    currentPrice: '$0.62',
    value: '$74.40',
    status: 'Open',
  },
  {
    marketId: 'best-arc-builder-tool',
    title: 'Presto builder tool priority',
    outcome: 'NO',
    shares: '80.00',
    averagePrice: '$0.49',
    currentPrice: '$0.52',
    value: '$41.60',
    status: 'Open',
  },
];

export const mockActivity: PortfolioActivity[] = [
  {
    label: 'Bought YES',
    market: 'Arc stablecoin DEX volume',
    detail: '50 USDC at 62%',
    status: 'Confirmed',
    time: '8 min ago',
  },
  {
    label: 'Created market',
    market: 'Consumer payments opportunity',
    detail: 'Seeded 1000 USDC',
    status: 'Pending',
    time: '21 min ago',
  },
  {
    label: 'Claim failed',
    market: 'Builder tool priority',
    detail: 'Resolver evidence not final',
    status: 'Failed',
    time: '1 hr ago',
  },
];
