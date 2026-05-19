'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchOnchainMarkets } from './onchainMarkets';
import {
  buyLiveShares,
  cancelLiveMarket,
  claimLiveMarket,
  createLiveMarket,
  refundLiveMarket,
  resolveLiveMarket,
  type CreateLiveMarketInput,
  type LiveActionResult,
} from './liveActions';
import { fetchAccountPortfolio, type AccountMarketPreview } from './accountPortfolio';
import {
  getStoredConnectedWallet,
  subscribeConnectedWallet,
  type ConnectedWallet,
} from './walletProvider';
import type { Market, MarketType, ResolutionMode } from './markets';
import type { PortfolioActivity, Position } from './portfolio';

type OutcomeLabel = 'YES' | 'NO';

export type AppMarket = Market & {
  source: 'onchain';
  closeDate?: string;
  createdAt: string;
  winningOutcomeLabel?: 'YES' | 'NO';
  resolutionURI?: string;
};

type CreateMarketInput = {
  type: MarketType;
  title: string;
  description: string;
  category: string;
  closeDate: string;
  rules: string;
  sourceOfTruth: string;
  resolver: string;
  resolutionMode: ResolutionMode;
  imageURI?: string;
  collateral?: 'USDC' | 'EURC';
};

type AppStateValue = {
  markets: AppMarket[];
  positions: Position[];
  activity: PortfolioActivity[];
  connectedWallet: ConnectedWallet | null;
  accountPreviews: Record<string, AccountMarketPreview>;
  isLoadingMarkets: boolean;
  isLoadingAccount: boolean;
  refreshMarkets: () => Promise<void>;
  refreshAccountPortfolio: () => Promise<void>;
  createMarket: (input: CreateMarketInput) => Promise<LiveActionResult>;
  placeTrade: (input: { marketId: string; outcome: OutcomeLabel; amount: number }) => Promise<LiveActionResult>;
  resolveMarket: (input: { marketId: string; outcome: OutcomeLabel; resolutionURI: string }) => Promise<LiveActionResult>;
  cancelMarket: (marketId: string) => Promise<LiveActionResult>;
  claimMarket: (marketId: string) => Promise<LiveActionResult>;
  refundMarket: (marketId: string) => Promise<LiveActionResult>;
  getMarket: (id: string) => AppMarket | undefined;
};

const appStateContext = createContext<AppStateValue | null>(null);

export function formatCompactUsd(value: number) {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }

  return `$${value.toFixed(0)}`;
}

export function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<AppMarket[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [activity, setActivity] = useState<PortfolioActivity[]>([]);
  const [accountPreviews, setAccountPreviews] = useState<Record<string, AccountMarketPreview>>({});
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(true);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);

  const refreshMarkets = useCallback(async () => {
    setIsLoadingMarkets(true);

    try {
      setMarkets(await fetchOnchainMarkets());
    } catch (error) {
      console.warn('Unable to load onchain markets', error);
      setMarkets([]);
    } finally {
      setIsLoadingMarkets(false);
    }
  }, []);

  useEffect(() => {
    void refreshMarkets();
  }, [refreshMarkets]);

  useEffect(() => {
    setConnectedWallet(getStoredConnectedWallet());
    return subscribeConnectedWallet(setConnectedWallet);
  }, []);

  const refreshAccountPortfolio = useCallback(async () => {
    setIsLoadingAccount(true);

    try {
      const snapshot = await fetchAccountPortfolio(markets, connectedWallet?.address);
      setPositions(snapshot.positions);
      setActivity(snapshot.activity);
      setAccountPreviews(snapshot.previews);
    } catch (error) {
      console.warn('Unable to load account portfolio', error);
      setPositions([]);
      setActivity([]);
      setAccountPreviews({});
    } finally {
      setIsLoadingAccount(false);
    }
  }, [markets, connectedWallet?.address]);

  useEffect(() => {
    void refreshAccountPortfolio();
  }, [refreshAccountPortfolio]);

  const createMarket = useCallback(async (input: CreateMarketInput) => {
    const result = await createLiveMarket(input satisfies CreateLiveMarketInput);
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
    }
    return result;
  }, [refreshMarkets, refreshAccountPortfolio]);

  const placeTrade = useCallback(async (input: { marketId: string; outcome: OutcomeLabel; amount: number }) => {
    const result = await buyLiveShares({
      marketAddress: input.marketId,
      outcome: input.outcome,
      amount: input.amount,
    });
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
    }
    return result;
  }, [refreshMarkets, refreshAccountPortfolio]);

  const resolveMarket = useCallback(async (input: { marketId: string; outcome: OutcomeLabel; resolutionURI: string }) => {
    const result = await resolveLiveMarket({
      marketAddress: input.marketId,
      outcome: input.outcome,
      resolutionURI: input.resolutionURI,
    });
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
    }
    return result;
  }, [refreshMarkets, refreshAccountPortfolio]);

  const cancelMarket = useCallback(async (marketId: string) => {
    const result = await cancelLiveMarket(marketId);
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
    }
    return result;
  }, [refreshMarkets, refreshAccountPortfolio]);

  const claimMarket = useCallback(async (marketId: string) => {
    const result = await claimLiveMarket(marketId);
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
    }
    return result;
  }, [refreshMarkets, refreshAccountPortfolio]);

  const refundMarket = useCallback(async (marketId: string) => {
    const result = await refundLiveMarket(marketId);
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
    }
    return result;
  }, [refreshMarkets, refreshAccountPortfolio]);

  const getMarket = useCallback((id: string) => markets.find((market) => market.id === id), [markets]);

  const value = useMemo<AppStateValue>(() => ({
    markets,
    positions,
    activity,
    connectedWallet,
    accountPreviews,
    isLoadingMarkets,
    isLoadingAccount,
    refreshMarkets,
    refreshAccountPortfolio,
    createMarket,
    placeTrade,
    resolveMarket,
    cancelMarket,
    claimMarket,
    refundMarket,
    getMarket,
  }), [
    markets,
    positions,
    activity,
    connectedWallet,
    accountPreviews,
    isLoadingMarkets,
    isLoadingAccount,
    refreshMarkets,
    refreshAccountPortfolio,
    createMarket,
    placeTrade,
    resolveMarket,
    cancelMarket,
    claimMarket,
    refundMarket,
    getMarket,
  ]);

  return (
    <appStateContext.Provider value={value}>
      {children}
    </appStateContext.Provider>
  );
}

export function useAppState() {
  const value = useContext(appStateContext);

  if (!value) {
    throw new Error('useAppState must be used within AppStateProvider');
  }

  return value;
}
