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
import type { StableSymbol } from './walletBalance';
import { readPayWith, writePayWith } from './payWithStore';

type OutcomeLabel = string;

// Refresh timing configuration
// Arc finalizes transactions in sub-second blocks, but public RPCs need time to surface state changes.
// These delays balance responsiveness with RPC propagation latency.
const REFRESH_DELAY_AFTER_TX_MS = 1_200; // Initial delay after transaction (Arc blocks finalize fast, RPC catches up in ~1.2s)
const POST_TX_REFRESH_DELAYS_MS = [4_000, 10_000, 20_000]; // Progressive refreshes to catch delayed RPC propagation

export type AppMarket = Market & {
  source: 'onchain';
  closeDate?: string;
  createdAt: string;
  createdSortKey?: number;
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
  agentResolverAddress?: string;
  resolutionMode: ResolutionMode;
  imageURI?: string;
  outcomeOptions?: string[];
  collateral?: 'USDC';
};

type AppStateValue = {
  markets: AppMarket[];
  positions: Position[];
  activity: PortfolioActivity[];
  connectedWallet: ConnectedWallet | null;
  accountPreviews: Record<string, AccountMarketPreview>;
  isLoadingMarkets: boolean;
  isLoadingAccount: boolean;
  refreshMarkets: (options?: { force?: boolean }) => Promise<AppMarket[]>;
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
  if (value > 0 && value < 0.01) {
    return '<$0.01';
  }

  if (value > 0 && value < 1) {
    return `$${value.toFixed(2)}`;
  }

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

// The grid is fetched client-side, where the DB-backed image override merge can't run. We keep
// the override map in a module cache and merge it SYNCHRONOUSLY when building markets, so cards
// render with their image in a single pass (no tile→image flash on every refresh).
let imageOverrideCache: Record<string, string> = {};
let imageOverridesPrimed = false;
let imageOverrideVersion = 0;

async function refreshImageOverrideCache(): Promise<void> {
  try {
    const res = await fetch('/api/market-images', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({ images: {} }));
    imageOverrideCache = data.images ?? {};
    imageOverridesPrimed = true;
    imageOverrideVersion += 1; // invalidate the merge memo
  } catch {
    /* best-effort */
  }
}

// Memoized by input ref + cache version so a cache hit yields the SAME output reference — this
// keeps the merge stable (no new array each call) and avoids a setMarkets→effect re-render loop.
let mergeInputRef: AppMarket[] | null = null;
let mergeOutputRef: AppMarket[] | null = null;
let mergeMemoVersion = -1;

function mergeImageOverrides(list: AppMarket[]): AppMarket[] {
  if (!imageOverridesPrimed) return list;
  if (list === mergeInputRef && mergeMemoVersion === imageOverrideVersion && mergeOutputRef) {
    return mergeOutputRef;
  }
  let changed = false;
  const out = list.map((market) => {
    const override = imageOverrideCache[market.id.toLowerCase()];
    if (override && !market.imageURI) {
      changed = true;
      return { ...market, imageURI: override };
    }
    return market;
  });
  mergeInputRef = list;
  mergeMemoVersion = imageOverrideVersion;
  mergeOutputRef = changed ? out : list;
  return mergeOutputRef;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<AppMarket[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [activity, setActivity] = useState<PortfolioActivity[]>([]);
  const [accountPreviews, setAccountPreviews] = useState<Record<string, AccountMarketPreview>>({});
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(true);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);

  const refreshMarkets = useCallback(async (options: { force?: boolean } = {}) => {
    // Stale-while-revalidate: only show loading if we have no markets yet
    if (markets.length === 0) {
      setIsLoadingMarkets(true);
    }

    try {
      // Synchronous merge from the module cache → cards render with their image in one pass.
      const nextMarkets = mergeImageOverrides(await fetchOnchainMarkets(options));
      setMarkets(nextMarkets);
      return nextMarkets;
    } catch (error) {
      console.warn('Unable to load onchain markets', error);
      if (markets.length === 0) setMarkets([]);
      return markets.length > 0 ? markets : [];
    } finally {
      setIsLoadingMarkets(false);
    }
  }, [markets]);

  useEffect(() => {
    // Prime the image-override cache once before the first render so markets paint with their
    // images in a single pass (no tile→image flash), then load markets.
    void (async () => {
      if (!imageOverridesPrimed) await refreshImageOverrideCache();
      await refreshMarkets();
    })();
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

  const refreshAll = useCallback(async (options: { force?: boolean } = {}) => {
    const nextMarkets = await refreshMarkets(options);
    if (connectedWallet?.address) {
      setIsLoadingAccount(true);
      try {
        const snapshot = await fetchAccountPortfolio(nextMarkets, connectedWallet.address, { includeActivity: false });
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
    } else {
      await refreshAccountPortfolio();
    }
    window.dispatchEvent(new CustomEvent('presto:balances-refresh'));
  }, [connectedWallet?.address, refreshMarkets, refreshAccountPortfolio]);

  const schedulePostTransactionRefresh = useCallback(() => {
    for (const delay of POST_TX_REFRESH_DELAYS_MS) {
      window.setTimeout(() => {
        void refreshAll({ force: true });
      }, delay);
    }
  }, [refreshAll]);

  const createMarket = useCallback(async (input: CreateMarketInput) => {
    const result = await createLiveMarket(input satisfies CreateLiveMarketInput);
    if (result.ok) {
      await refreshAll({ force: true });
      schedulePostTransactionRefresh();
    }
    return result;
  }, [refreshAll, schedulePostTransactionRefresh]);

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
      void refreshAll({ force: true });
      await new Promise((r) => setTimeout(r, REFRESH_DELAY_AFTER_TX_MS));
      await refreshAll({ force: true });
      schedulePostTransactionRefresh();
    }
    return result;
  }, [markets, connectedWallet?.address, refreshAll, schedulePostTransactionRefresh]);

  const addLiquidity = useCallback(async (input: { marketId: string; amount: number; payWith?: StableSymbol }) => {
    const market = markets.find((item) => item.id.toLowerCase() === input.marketId.toLowerCase());
    if (!market || (market.status !== 'Open' && market.status !== 'Closing soon')) {
      return { ok: false, message: 'This market is closed for liquidity.' };
    }

    const result = await addLiveLiquidity({
      marketAddress: input.marketId,
      amount: input.amount,
      outcomes: market.outcomes.map((outcome) => outcome.label),
      payWith: input.payWith,
    });
    if (result.ok && input.payWith) {
      writePayWith(connectedWallet?.address, input.marketId, input.payWith);
    }
    if (result.ok) {
      void refreshAll({ force: true });
      await new Promise((r) => setTimeout(r, REFRESH_DELAY_AFTER_TX_MS));
      await refreshAll({ force: true });
      schedulePostTransactionRefresh();
    }
    return result;
  }, [markets, connectedWallet?.address, refreshAll, schedulePostTransactionRefresh]);

  const resolveMarket = useCallback(async (input: { marketId: string; outcome: OutcomeLabel; outcomeIndex?: number; resolutionURI: string }) => {
    const result = await resolveLiveMarket({
      marketAddress: input.marketId,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      resolutionURI: input.resolutionURI,
    });
    if (result.ok) {
      await refreshAll({ force: true });
      schedulePostTransactionRefresh();
    }
    return result;
  }, [refreshAll, schedulePostTransactionRefresh]);

  const cancelMarket = useCallback(async (marketId: string) => {
    const result = await cancelLiveMarket(marketId);
    if (result.ok) {
      await refreshAll({ force: true });
      schedulePostTransactionRefresh();
    }
    return result;
  }, [refreshAll, schedulePostTransactionRefresh]);

  const claimMarket = useCallback(async (marketId: string) => {
    const payWith = readPayWith(connectedWallet?.address, marketId) ?? undefined;
    const result = await claimLiveMarket(marketId, payWith);
    if (result.ok) {
      await refreshAll({ force: true });
      schedulePostTransactionRefresh();
    }
    return result;
  }, [connectedWallet?.address, refreshAll, schedulePostTransactionRefresh]);

  const refundMarket = useCallback(async (marketId: string) => {
    const payWith = readPayWith(connectedWallet?.address, marketId) ?? undefined;
    const result = await refundLiveMarket(marketId, payWith);
    if (result.ok) {
      await refreshAll({ force: true });
      schedulePostTransactionRefresh();
    }
    return result;
  }, [connectedWallet?.address, refreshAll, schedulePostTransactionRefresh]);

  const getMarket = useCallback((id: string) => {
    const target = id.toLowerCase();
    return markets.find((market) => market.id.toLowerCase() === target);
  }, [markets]);

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
