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
