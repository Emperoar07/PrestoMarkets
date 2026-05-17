'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { marketTemplates } from './marketTemplates';
import { markets as seededMarkets, type Market, type MarketStatus, type MarketType, type ResolutionMode } from './markets';
import { fetchOnchainMarkets } from './onchainMarkets';
import { mockActivity, mockPositions, type PortfolioActivity, type Position } from './portfolio';

type OutcomeLabel = 'YES' | 'NO';

export type AppMarket = Market & {
  source: 'seed' | 'created' | 'onchain';
  closeDate?: string;
  createdAt: string;
  seedLiquidityValue: number;
};

type TradeRecord = {
  id: string;
  marketId: string;
  marketTitle: string;
  outcome: OutcomeLabel;
  amount: number;
  price: number;
  shares: number;
  time: string;
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
  seedLiquidity: number;
  status?: MarketStatus;
};

type AppStateValue = {
  markets: AppMarket[];
  positions: Position[];
  activity: PortfolioActivity[];
  createMarket: (input: CreateMarketInput) => string;
  placeTrade: (input: { marketId: string; outcome: OutcomeLabel; amount: number }) => { ok: boolean; message: string };
  updateMarketStatus: (marketId: string, status: MarketStatus) => void;
  getMarket: (id: string) => AppMarket | undefined;
};

type StoredAppState = {
  markets: AppMarket[];
  trades: TradeRecord[];
};

const STORAGE_KEY = 'presto-markets-app-state';

const appStateContext = createContext<AppStateValue | null>(null);

function parseCompactUsd(value: string) {
  const normalized = value.trim().toUpperCase();

  if (!normalized.startsWith('$')) {
    return Number(normalized) || 0;
  }

  const raw = normalized.slice(1);

  if (raw.endsWith('K')) {
    return Number(raw.slice(0, -1)) * 1_000;
  }

  if (raw.endsWith('M')) {
    return Number(raw.slice(0, -1)) * 1_000_000;
  }

  return Number(raw.replace(/,/g, '')) || 0;
}

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

function getCloseLabel(closeDate?: string) {
  if (!closeDate) {
    return 'Open';
  }

  const close = new Date(closeDate).getTime();
  const now = Date.now();
  const diff = close - now;

  if (Number.isNaN(close) || diff <= 0) {
    return 'Closing soon';
  }

  const days = Math.ceil(diff / 86_400_000);

  if (days < 1) {
    const hours = Math.max(1, Math.ceil(diff / 3_600_000));
    return `${hours} hr${hours === 1 ? '' : 's'}`;
  }

  return `${days} day${days === 1 ? '' : 's'}`;
}

function getStatus(closeDate?: string): MarketStatus {
  if (!closeDate) {
    return 'Open';
  }

  const close = new Date(closeDate).getTime();
  const diff = close - Date.now();

  if (Number.isNaN(close) || diff <= 3 * 86_400_000) {
    return 'Closing soon';
  }

  return 'Open';
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function seededMarketCloseDate(index: number) {
  const offsets = [22, 9, 14];
  const days = offsets[index] ?? 7;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function buildInitialMarkets(): AppMarket[] {
  return seededMarkets.map((market, index) => ({
    ...market,
    source: 'seed',
    createdAt: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
    closeDate: seededMarketCloseDate(index),
    seedLiquidityValue: parseCompactUsd(market.liquidity),
  }));
}

function readStoredState() {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const stored = JSON.parse(raw) as StoredAppState;

    return {
      ...stored,
      markets: stored.markets.map((market) => ({
        ...market,
        status: String(market.status) === 'Active' ? 'Open' : market.status,
      })) as AppMarket[],
    };
  } catch {
    return null;
  }
}

function writeStoredState(value: StoredAppState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function updateOutcomeOdds(market: AppMarket, outcome: OutcomeLabel, amount: number) {
  const yesOutcome = market.outcomes.find((item) => item.label === 'YES') ?? market.outcomes[0];
  const noOutcome = market.outcomes.find((item) => item.label === 'NO') ?? market.outcomes[1] ?? yesOutcome;
  const move = Math.max(1, Math.min(8, Math.round(amount / 75)));
  const nextYes = outcome === 'YES'
    ? Math.min(92, yesOutcome.odds + move)
    : Math.max(8, yesOutcome.odds - move);

  return market.outcomes.map((item) => {
    if (item.label === 'YES') {
      return {
        ...item,
        odds: nextYes,
        liquidity: item.label === outcome ? formatCompactUsd(parseCompactUsd(item.liquidity) + amount) : item.liquidity,
      };
    }

    return {
      ...item,
      odds: 100 - nextYes,
      liquidity: item.label === outcome ? formatCompactUsd(parseCompactUsd(item.liquidity) + amount) : item.liquidity,
    };
  });
}

function buildPositionFromTrade(trade: TradeRecord, market?: AppMarket): Position {
  const currentOutcome = market?.outcomes.find((item) => item.label === trade.outcome);
  const currentPrice = currentOutcome ? currentOutcome.odds / 100 : trade.price;
  const value = trade.shares * currentPrice;

  return {
    marketId: trade.marketId,
    title: trade.marketTitle,
    outcome: trade.outcome,
    shares: trade.shares.toFixed(2),
    averagePrice: formatUsd(trade.price),
    currentPrice: formatUsd(currentPrice),
    value: formatUsd(value),
    status: 'Open',
  };
}

function buildActivityFromTrade(trade: TradeRecord): PortfolioActivity {
  return {
    label: `Bought ${trade.outcome}`,
    market: trade.marketTitle,
    detail: `${formatUsd(trade.amount)} at ${(trade.price * 100).toFixed(0)}%`,
    status: 'Confirmed',
    time: trade.time,
  };
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [localMarkets, setLocalMarkets] = useState<AppMarket[]>(buildInitialMarkets);
  const [onchainMarkets, setOnchainMarkets] = useState<AppMarket[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const markets = [
    ...onchainMarkets,
    ...localMarkets.filter((market) => !onchainMarkets.some((onchainMarket) => onchainMarket.id === market.id)),
  ];

  useEffect(() => {
    const stored = readStoredState();

    if (stored) {
      setLocalMarkets(stored.markets);
      setTrades(stored.trades);
    }

    setIsHydrated(true);
  }, []);

  useEffect(() => {
    let isActive = true;

    fetchOnchainMarkets()
      .then((nextMarkets) => {
        if (isActive) {
          setOnchainMarkets(nextMarkets);
        }
      })
      .catch((error) => {
        console.warn('Unable to load onchain markets', error);
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !isHydrated) {
      return;
    }

    writeStoredState({ markets: localMarkets, trades });
  }, [isHydrated, localMarkets, trades]);

  function createMarket(input: CreateMarketInput) {
    const id = `${slugify(input.title)}-${Math.random().toString(36).slice(2, 8)}`;
    const template = marketTemplates.find((item) => item.type === input.type && item.category === input.category);
    const createdMarket: AppMarket = {
      id,
      type: input.type,
      title: input.title,
      description: input.description,
      category: input.category,
      volume: formatCompactUsd(input.seedLiquidity),
      liquidity: formatCompactUsd(input.seedLiquidity),
      closeLabel: getCloseLabel(input.closeDate),
      status: input.status ?? getStatus(input.closeDate),
      collateral: 'USDC',
      chain: 'Arc Testnet',
      resolver: input.resolver,
      resolutionMode: input.resolutionMode,
      sourceOfTruth: input.sourceOfTruth,
      rules: input.rules,
      createdBy: 'Local creator',
      feeMode: 'Protocol fee scaffolded for demo mode.',
      outcomes: [
        { label: 'YES', odds: 50, liquidity: formatCompactUsd(input.seedLiquidity / 2) },
        { label: 'NO', odds: 50, liquidity: formatCompactUsd(input.seedLiquidity / 2) },
      ],
      activity: [
        { label: 'Signals', value: '0' },
        { label: 'Participants', value: '0' },
        { label: '24h volume', value: '$0' },
      ],
      source: 'created',
      closeDate: input.closeDate,
      createdAt: new Date().toISOString(),
      seedLiquidityValue: input.seedLiquidity,
    };

    if (template && createdMarket.description.trim().length === 0) {
      createdMarket.description = `${template.title} market for ${template.category.toLowerCase()} signals on Arc.`;
    }

    setLocalMarkets((current) => [createdMarket, ...current]);

    return id;
  }

  function placeTrade(input: { marketId: string; outcome: OutcomeLabel; amount: number }) {
    const market = markets.find((item) => item.id === input.marketId);

    if (!market) {
      return { ok: false, message: 'Market not found.' };
    }

    if (market.status !== 'Open' && market.status !== 'Closing soon') {
      return { ok: false, message: `This market is ${market.status.toLowerCase()} and cannot accept new demo trades.` };
    }

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      return { ok: false, message: 'Enter a valid USDC amount.' };
    }

    const selectedOutcome = market.outcomes.find((item) => item.label === input.outcome);

    if (!selectedOutcome) {
      return { ok: false, message: 'Outcome not found.' };
    }

    const price = selectedOutcome.odds / 100;
    const shares = input.amount / price;
    const trade: TradeRecord = {
      id: Math.random().toString(36).slice(2, 10),
      marketId: market.id,
      marketTitle: market.title,
      outcome: input.outcome,
      amount: input.amount,
      price,
      shares,
      time: 'Just now',
    };

    setTrades((current) => [trade, ...current]);
    setLocalMarkets((current) => current.map((item) => {
      if (item.id !== market.id) {
        return item;
      }

      const nextVolume = parseCompactUsd(item.volume) + input.amount;
      const nextLiquidity = parseCompactUsd(item.liquidity) + input.amount;

      return {
        ...item,
        volume: formatCompactUsd(nextVolume),
        liquidity: formatCompactUsd(nextLiquidity),
        closeLabel: getCloseLabel(item.closeDate),
        status: getStatus(item.closeDate),
        outcomes: updateOutcomeOdds(item, input.outcome, input.amount),
        activity: item.activity.map((activityItem) => {
          if (activityItem.label === 'Trades' || activityItem.label === 'Votes traded' || activityItem.label === 'Signals') {
            return {
              ...activityItem,
              value: String((Number(activityItem.value.replace(/[^0-9.]/g, '')) || 0) + 1),
            };
          }

          if (activityItem.label === 'Holders' || activityItem.label === 'Participants' || activityItem.label === 'Builders') {
            return {
              ...activityItem,
              value: String((Number(activityItem.value.replace(/[^0-9.]/g, '')) || 0) + 1),
            };
          }

          if (activityItem.label === '24h volume') {
            return {
              ...activityItem,
              value: formatCompactUsd(parseCompactUsd(activityItem.value) + input.amount),
            };
          }

          return activityItem;
        }),
      };
    }));

    return { ok: true, message: `Bought ${input.outcome} with ${formatUsd(input.amount)} in demo mode.` };
  }

  function updateMarketStatus(marketId: string, status: MarketStatus) {
    setLocalMarkets((current) => current.map((market) => {
      if (market.id !== marketId) {
        return market;
      }

      return {
        ...market,
        status,
        closeLabel: status === 'Draft' ? 'Draft' : status === 'Resolved' ? 'Resolved' : status === 'Canceled' ? 'Canceled' : getCloseLabel(market.closeDate),
      };
    }));
  }

  const positions = [
    ...mockPositions,
    ...trades.map((trade) => buildPositionFromTrade(trade, markets.find((item) => item.id === trade.marketId))),
  ];

  const activity = [
    ...trades.map(buildActivityFromTrade),
    ...markets
      .filter((market) => market.source === 'created')
      .map((market) => ({
        label: 'Created market',
        market: market.title,
        detail: `Seeded ${formatUsd(market.seedLiquidityValue)}`,
        status: market.status === 'Draft' ? 'Pending' as const : 'Confirmed' as const,
        time: 'Just now',
      })),
    ...mockActivity,
  ].slice(0, 12);

  function getMarket(id: string) {
    return markets.find((market) => market.id === id);
  }

  return (
    <appStateContext.Provider value={{ markets, positions, activity, createMarket, placeTrade, updateMarketStatus, getMarket }}>
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
