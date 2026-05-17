export type Position = {
  marketId: string;
  title: string;
  outcome: 'YES' | 'NO';
  shares: string;
  averagePrice: string;
  currentPrice: string;
  value: string;
  costBasis: string;
  pnl: string;
  valuationLabel: string;
  status: 'Open' | 'Claimable' | 'Realized' | 'Watching';
};

export type PortfolioActivity = {
  label: string;
  market: string;
  detail: string;
  status: 'Pending' | 'Confirmed' | 'Failed';
  time: string;
};
