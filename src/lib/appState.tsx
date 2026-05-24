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
  addLiveLiquidity,
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
import type { StableSymbol } from './swap';
import { readPayWith, writePayWith } from './payWithStore';

type OutcomeLabel = string;

export type AppMarket = Market & {
  source: 'onchain';
  closeDate?: string;
  createdAt: string;
  winningOutcomeLabel?: string;
  resolutionURI?: string;
};

type CreateMarketInput = {
  type: MarketType;
  title: string;
  description: string;
  category: string;
  categories?: string[];
  closeDate: string;
  rules: string;
  sourceOfTruth: string;
  resolver: string;
  resolutionMode: ResolutionMode;
  imageURI?: string;
  outcomeOptions?: string[];
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
  placeTrade: (input: { marketId: string; outcome: OutcomeLabel; outcomeIndex?: number; amount: number; payWith?: StableSymbol }) => Promise<LiveActionResult>;
  addLiquidity: (input: { marketId: string; amount: number; payWith?: StableSymbol }) => Promise<LiveActionResult>;
  resolveMarket: (input: { marketId: string; outcome: OutcomeLabel; outcomeIndex?: number; resolutionURI: string }) => Promise<LiveActionResult>;
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
      const snapshot = await fetchAccountPortfolio(markets, connectedWallet?.address, { includeActivity: false });
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

  const schedulePostTransactionRefresh = useCallback(() => {
    for (const delay of [4_000, 10_000, 20_000]) {
      window.setTimeout(() => {
        void refreshMarkets();
        void refreshAccountPortfolio();
      }, delay);
    }
  }, [refreshMarkets, refreshAccountPortfolio]);

  const createMarket = useCallback(async (input: CreateMarketInput) => {
    const result = await createLiveMarket(input satisfies CreateLiveMarketInput);
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
      schedulePostTransactionRefresh();
    }
    return result;
  }, [refreshMarkets, refreshAccountPortfolio, schedulePostTransactionRefresh]);

  const placeTrade = useCallback(async (input: { marketId: string; outcome: OutcomeLabel; outcomeIndex?: number; amount: number; payWith?: StableSymbol }) => {
    const market = markets.find((item) => item.id === input.marketId);
    if (!market || (market.status !== 'Open' && market.status !== 'Closing soon')) {
      return { ok: false, message: 'This market is closed for trading.' };
    }

    const result = await buyLiveShares({
      marketAddress: input.marketId,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      amount: input.amount,
      payWith: input.payWith,
    });
    if (result.ok && input.payWith) {
      // Persist the pay-with choice so claim/refund can swap the payout back to the same token.
      writePayWith(connectedWallet?.address, input.marketId, input.payWith);
    }
    if (result.ok) {
      // Arc finalizes in sub-second blocks but public RPC takes ~1-2s to surface the new
      // sharesOf state. Refresh once immediately, then once more after a short delay so the
      // YOUR POSITION block updates without a manual reload.
      void refreshMarkets();
      void refreshAccountPortfolio();
      await new Promise((r) => setTimeout(r, 1_800));
      await refreshMarkets();
      await refreshAccountPortfolio();
      schedulePostTransactionRefresh();
    }
    return result;
  }, [markets, connectedWallet?.address, refreshMarkets, refreshAccountPortfolio, schedulePostTransactionRefresh]);

  const addLiquidity = useCallback(async (input: { marketId: string; amount: number; payWith?: StableSymbol }) => {
    const market = markets.find((item) => item.id === input.marketId);
    if (!market || (market.status !== 'Open' && market.status !== 'Closing soon')) {
      return { ok: false, message: 'This market is closed for liquidity.' };
    }

    const result = await addLiveLiquidity({
      marketAddress: input.marketId,
      amount: input.amount,
      payWith: input.payWith,
    });
    if (result.ok && input.payWith) {
      writePayWith(connectedWallet?.address, input.marketId, input.payWith);
    }
    if (result.ok) {
      void refreshMarkets();
      void refreshAccountPortfolio();
      await new Promise((r) => setTimeout(r, 1_800));
      await refreshMarkets();
      await refreshAccountPortfolio();
      schedulePostTransactionRefresh();
    }
    return result;
  }, [markets, connectedWallet?.address, refreshMarkets, refreshAccountPortfolio, schedulePostTransactionRefresh]);

  const resolveMarket = useCallback(async (input: { marketId: string; outcome: OutcomeLabel; outcomeIndex?: number; resolutionURI: string }) => {
    const result = await resolveLiveMarket({
      marketAddress: input.marketId,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      resolutionURI: input.resolutionURI,
    });
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
      schedulePostTransactionRefresh();
    }
    return result;
  }, [refreshMarkets, refreshAccountPortfolio, schedulePostTransactionRefresh]);

  const cancelMarket = useCallback(async (marketId: string) => {
    const result = await cancelLiveMarket(marketId);
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
      schedulePostTransactionRefresh();
    }
    return result;
  }, [refreshMarkets, refreshAccountPortfolio, schedulePostTransactionRefresh]);

  const claimMarket = useCallback(async (marketId: string) => {
    const payWith = readPayWith(connectedWallet?.address, marketId) ?? undefined;
    const result = await claimLiveMarket(marketId, payWith);
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
      schedulePostTransactionRefresh();
    }
    return result;
  }, [connectedWallet?.address, refreshMarkets, refreshAccountPortfolio, schedulePostTransactionRefresh]);

  const refundMarket = useCallback(async (marketId: string) => {
    const payWith = readPayWith(connectedWallet?.address, marketId) ?? undefined;
    const result = await refundLiveMarket(marketId, payWith);
    if (result.ok) {
      await refreshMarkets();
      await refreshAccountPortfolio();
      schedulePostTransactionRefresh();
    }
    return result;
  }, [connectedWallet?.address, refreshMarkets, refreshAccountPortfolio, schedulePostTransactionRefresh]);

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
    addLiquidity,
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
    addLiquidity,
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
