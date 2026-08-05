'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fetchOnchainMarkets, fetchOnchainMarket } from './onchainMarkets';
import {
  buyLiveShares,
  buyLmsrShares,
  addLiveLiquidity,
  cancelLiveMarket,
  claimAllLiveMarkets,
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
import { scheduleMarketSnapshotSync } from './marketSyncClient';

type OutcomeLabel = string;

// Refresh timing configuration
// Arc finalizes transactions in sub-second blocks, but public RPCs need time to surface state changes.
// These delays balance responsiveness with RPC propagation latency.
const POST_TX_REFRESH_DELAYS_MS = [2_500, 8_000]; // A couple of background follow-ups to catch RPC propagation
const MARKET_CACHE_KEY = 'presto:markets:v1';
const MARKET_CACHE_MAX_AGE_MS = 5 * 60_000;

type CachedMarketsPayload = {
  at: number;
  markets: AppMarket[];
};

export type AppMarket = Market & {
  source: 'onchain';
  closeDate?: string;
  createdAt: string;
  createdSortKey?: number;
  winningOutcomeLabel?: string;
  resolutionURI?: string;
  /** Collateral token the market settles in (USDC default; EURC for euro markets). */
  collateralAddress?: string;
  collateralSymbol?: 'USDC' | 'EURC';
  /** True for V3 LMSR markets: live AMM pricing, positions can be sold back any time. */
  amm?: boolean;
  /** Optimistic-resolution proposal state (V2 markets only; absent on V1 contracts). */
  proposal?: {
    outcome: number;
    outcomeLabel: string;
    proposer: string;
    proposedAtMs: number;
    /** Read from the deployed market contract when available. */
    disputeWindowMs?: number;
    disputed: boolean;
    evidenceURI?: string;
  };
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
  outcomeImages?: (string | undefined)[];
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
  refreshMarkets: (options?: { force?: boolean }) => Promise<AppMarket[]>;
  refreshMarket: (id: string, options?: { source?: 'chain' | 'snapshot' }) => Promise<void>;
  refreshAccountPortfolio: () => Promise<void>;
  createMarket: (input: CreateMarketInput) => Promise<LiveActionResult>;
  placeTrade: (input: { marketId: string; outcome: OutcomeLabel; outcomeIndex?: number; amount: number; shares?: number; payWith?: StableSymbol }) => Promise<LiveActionResult>;
  addLiquidity: (input: { marketId: string; amount: number; payWith?: StableSymbol }) => Promise<LiveActionResult>;
  resolveMarket: (input: { marketId: string; outcome: OutcomeLabel; outcomeIndex?: number; resolutionURI: string }) => Promise<LiveActionResult>;
  cancelMarket: (marketId: string) => Promise<LiveActionResult>;
  claimMarket: (marketId: string) => Promise<LiveActionResult>;
  claimAllMarkets: (items: Array<{ marketAddress: string; mode: 'claim' | 'refund' }>) => Promise<LiveActionResult>;
  refundMarket: (marketId: string) => Promise<LiveActionResult>;
  getMarket: (id: string) => AppMarket | undefined;
};

const appStateContext = createContext<AppStateValue | null>(null);

function readCachedMarkets(): AppMarket[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(MARKET_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedMarketsPayload;
    if (!Array.isArray(cached.markets) || Date.now() - cached.at > MARKET_CACHE_MAX_AGE_MS) return null;
    return cached.markets;
  } catch {
    return null;
  }
}

function writeCachedMarkets(markets: AppMarket[]) {
  if (typeof window === 'undefined' || markets.length === 0) return;
  try {
    window.localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({ at: Date.now(), markets }));
  } catch {
    // localStorage can be unavailable in private modes; the API snapshot remains the source.
  }
}

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

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<AppMarket[]>([]);
  const marketsRef = useRef<AppMarket[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [activity, setActivity] = useState<PortfolioActivity[]>([]);
  const [accountPreviews, setAccountPreviews] = useState<Record<string, AccountMarketPreview>>({});
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(true);
  const [isLoadingAccount, setIsLoadingAccount] = useState(false);

  const refreshMarkets = useCallback(async (options: { force?: boolean } = {}) => {
    // Stale-while-revalidate: only show loading if we have no markets yet
    if (marketsRef.current.length === 0) {
      const cached = readCachedMarkets();
      if (cached && cached.length > 0) {
        marketsRef.current = cached;
        setMarkets(cached);
        setIsLoadingMarkets(false);
      } else {
        setIsLoadingMarkets(true);
      }
    }

    try {
      // Normal loads pull the pre-computed list from the cached server endpoint. Browsers should
      // never run a full factory scan on page load: on Cloudflare that can pin the grid in skeleton
      // state while public RPCs are slow. `force` remains reserved for explicit post-create/admin
      // flows where an address may not be in the snapshot yet.
      let nextMarkets: AppMarket[] | null = null;
      if (!options.force) {
        try {
          const res = await fetch('/api/markets');
          if (res.ok) {
            const data = await res.json() as { markets?: AppMarket[] };
            if (Array.isArray(data.markets) && data.markets.length > 0) nextMarkets = data.markets;
          }
        } catch {
          // endpoint unavailable — keep the current snapshot/cache and let the next refresh retry
        }
      }
      // fetchOnchainMarkets already merges image overrides at the source, so markets are stable.
      if (!nextMarkets && options.force) nextMarkets = await fetchOnchainMarkets(options);
      if (!nextMarkets) return marketsRef.current;
      marketsRef.current = nextMarkets;
      setMarkets(nextMarkets);
      writeCachedMarkets(nextMarkets);
      return nextMarkets;
    } catch (error) {
      console.warn('Unable to load onchain markets', error);
      return marketsRef.current;
    } finally {
      setIsLoadingMarkets(false);
    }
  }, []);

  // Targeted refresh: re-read just one market from chain and patch it in place. Reading a single
  // market is sub-second (vs the ~13s full grid), so after a trade we update the traded card's odds
  // instantly while the full refresh catches positions/portfolio in the background. Ordering fields
  // (createdSortKey/createdAt) come from the single read without creationInfo, so we keep them from
  // the existing market to avoid the card jumping position after a trade.
  const refreshMarket = useCallback(async (id: string, options: { source?: 'chain' | 'snapshot' } = {}) => {
    const key = id.toLowerCase();
    const existing = marketsRef.current.find((m) => m.id.toLowerCase() === key);
    let fresh: AppMarket | null = null;
    if (options.source === 'snapshot') {
      try {
        const response = await fetch(`/api/markets/${id}`, { cache: 'no-store' });
        if (response.ok) {
          const payload = await response.json() as { market?: AppMarket };
          fresh = payload.market ?? null;
        }
      } catch {
        return;
      }
    } else {
      fresh = await fetchOnchainMarket(id, { isAmm: existing?.amm });
    }
    if (!fresh) return;
    const merged = existing
      ? { ...fresh, createdSortKey: existing.createdSortKey, createdAt: existing.createdAt || fresh.createdAt }
      : fresh;
    const next = marketsRef.current.some((m) => m.id.toLowerCase() === key)
      ? marketsRef.current.map((m) => (m.id.toLowerCase() === key ? merged : m))
      : [...marketsRef.current, merged];
    marketsRef.current = next;
    setMarkets(next);
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

  const schedulePostTransactionRefresh = useCallback((marketId?: string) => {
    // A confirmed market action needs one targeted chain read, not repeated full-factory scans.
    // Follow-ups consume the receipt-verified persisted snapshot while account reads update the
    // connected wallet. Creation still uses the full refresh path because its address is unknown.
    if (marketId) {
      void refreshMarket(marketId);
      void refreshAccountPortfolio();
      for (const delay of POST_TX_REFRESH_DELAYS_MS) {
        window.setTimeout(() => {
          void refreshMarket(marketId, { source: 'snapshot' });
          void refreshAccountPortfolio();
        }, delay);
      }
      window.dispatchEvent(new CustomEvent('presto:balances-refresh'));
      return;
    }

    void refreshAll({ force: true });
    for (const delay of POST_TX_REFRESH_DELAYS_MS) {
      window.setTimeout(() => {
        void refreshAll({ force: true });
      }, delay);
    }
  }, [refreshAll, refreshMarket, refreshAccountPortfolio]);

  const createMarket = useCallback(async (input: CreateMarketInput) => {
    const result = await createLiveMarket(input satisfies CreateLiveMarketInput);
    if (result.ok) {
      schedulePostTransactionRefresh();
    }
    return result;
  }, [schedulePostTransactionRefresh]);

  const placeTrade = useCallback(async (input: { marketId: string; outcome: OutcomeLabel; outcomeIndex?: number; amount: number; shares?: number; payWith?: StableSymbol }) => {
    const market = markets.find((item) => item.id === input.marketId);
    if (!market || (market.status !== 'Open' && market.status !== 'Closing soon')) {
      return { ok: false, message: 'This market is closed for trading.' };
    }
    if (market.paused || market.frozen) {
      return { ok: false, message: 'Trading is frozen on this market — its outcome is already decided and it will settle at close.' };
    }
    // V3 LMSR markets are share-priced. When the caller passes an explicit share count (QuickBuy's
    // shares mode), use it directly and let buyLmsrShares' fresh on-chain quote set the spend cap.
    // Otherwise convert the "$ amount" budget into shares at the live odds and cap the spend at the
    // entered budget (maxCost). The 0.95 factor leaves headroom for the 1% fee + a little price
    // impact so a budget buy stays under budget instead of reverting on slippage.
    if (market.amm) {
      const idx = input.outcomeIndex ?? Math.max(0, market.outcomes.findIndex((o) => o.label === input.outcome));
      const oddsPct = Number(market.outcomes[idx]?.odds) || 50;
      const price = Math.min(0.99, Math.max(0.01, oddsPct / 100));
      const explicitShares = Number.isFinite(input.shares) && (input.shares as number) > 0 ? (input.shares as number) : null;
      const shares = explicitShares ?? Math.max(0.000001, (input.amount / price) * 0.95);
      // For explicit shares the estimate can run low; buyLmsrShares takes max(quoted, fresh quote
      // + slippage) as the on-chain cap, so a low estimate never blocks or reverts the buy.
      const maxCost = explicitShares ? Math.max(0.01, explicitShares * price * 1.06) : input.amount;
      const lmsrResult = await buyLmsrShares({
        marketAddress: input.marketId,
        outcome: input.outcome,
        outcomeIndex: idx,
        shares,
        maxCost,
        payWith: input.payWith,
      });
      if (lmsrResult.ok && !lmsrResult.approvalOnly) {
        if (input.payWith) writePayWith(connectedWallet?.address, input.marketId, input.payWith);
        scheduleMarketSnapshotSync(input.marketId, lmsrResult.txHash);
        schedulePostTransactionRefresh(input.marketId);
      }
      return lmsrResult;
    }

    const result = await buyLiveShares({
      marketAddress: input.marketId,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      amount: input.amount,
      payWith: input.payWith,
    });
    if (result.ok && !result.approvalOnly && input.payWith) {
      // Persist the pay-with choice so claim/refund can swap the payout back to the same token.
      writePayWith(connectedWallet?.address, input.marketId, input.payWith);
    }
    if (result.ok && !result.approvalOnly) {
      scheduleMarketSnapshotSync(input.marketId, result.txHash);
      // The tx is already confirmed on-chain here (buyLiveShares waited for the receipt), so return
      // immediately — the toast flips to "Confirmed" without waiting on a market re-read. Markets and
      // the YOUR POSITION block refresh in the BACKGROUND so the UI never blocks on the heavy read.
      schedulePostTransactionRefresh(input.marketId);
    }
    return result;
  }, [markets, connectedWallet?.address, schedulePostTransactionRefresh]);

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
    if (result.ok && !result.approvalOnly && input.payWith) {
      writePayWith(connectedWallet?.address, input.marketId, input.payWith);
    }
    if (result.ok && !result.approvalOnly) {
      schedulePostTransactionRefresh();
    }
    return result;
  }, [markets, connectedWallet?.address, schedulePostTransactionRefresh]);

  const resolveMarket = useCallback(async (input: { marketId: string; outcome: OutcomeLabel; outcomeIndex?: number; resolutionURI: string }) => {
    const result = await resolveLiveMarket({
      marketAddress: input.marketId,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      resolutionURI: input.resolutionURI,
    });
    if (result.ok) {
      schedulePostTransactionRefresh();
    }
    return result;
  }, [refreshAll, schedulePostTransactionRefresh]);

  const cancelMarket = useCallback(async (marketId: string) => {
    const result = await cancelLiveMarket(marketId);
    if (result.ok) {
      schedulePostTransactionRefresh();
    }
    return result;
  }, [refreshAll, schedulePostTransactionRefresh]);

  const claimMarket = useCallback(async (marketId: string) => {
    const payWith = readPayWith(connectedWallet?.address, marketId) ?? undefined;
    const result = await claimLiveMarket(marketId, payWith);
    if (result.ok) {
      schedulePostTransactionRefresh();
    }
    return result;
  }, [connectedWallet?.address, refreshAll, schedulePostTransactionRefresh]);

  // Settle every claimable position with ONE wallet interaction (Multicall3From / batched userOp /
  // executeBatch depending on the wallet type).
  const claimAllMarkets = useCallback(async (items: Array<{ marketAddress: string; mode: 'claim' | 'refund' }>) => {
    const result = await claimAllLiveMarkets(items);
    if (result.ok) {
      schedulePostTransactionRefresh();
    }
    return result;
  }, [schedulePostTransactionRefresh]);

  const refundMarket = useCallback(async (marketId: string) => {
    const payWith = readPayWith(connectedWallet?.address, marketId) ?? undefined;
    const result = await refundLiveMarket(marketId, payWith);
    if (result.ok) {
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
    refreshMarket,
    refreshAccountPortfolio,
    createMarket,
    placeTrade,
    addLiquidity,
    resolveMarket,
    cancelMarket,
    claimMarket,
    claimAllMarkets,
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
    refreshMarket,
    refreshAccountPortfolio,
    createMarket,
    placeTrade,
    addLiquidity,
    resolveMarket,
    cancelMarket,
    claimMarket,
    claimAllMarkets,
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
