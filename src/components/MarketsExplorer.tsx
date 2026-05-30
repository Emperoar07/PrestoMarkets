'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MarketCard } from './MarketCard';
import { MarketSignalChart } from './MarketSignalChart';
import { SkeletonCard } from './SkeletonCard';
import { useAppState } from '@/lib/appState';
import type { AppMarket } from '@/lib/appState';
import { parseVolume, formatVolume } from '@/lib/marketUtils';

type SortKey = 'volume' | 'ending' | 'newest';
type PeriodFilter = 'all' | 'daily' | 'weekly' | 'monthly';

const sortLabels: Record<SortKey, string> = {
  newest: 'Newest',
  volume: 'Volume',
  ending: 'Ending',
};

const periodLabels: Record<PeriodFilter, string> = {
  all: 'All time',
  daily: 'Today',
  weekly: 'This week',
  monthly: 'This month',
};

function sortMarkets(list: AppMarket[], sort: SortKey): AppMarket[] {
  const copy = [...list];
  const newestKey = (market: AppMarket) => {
    const parsed = market.createdAt ? new Date(market.createdAt).getTime() : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : market.createdSortKey ?? 0;
  };
  if (sort === 'newest') return copy.sort((a, b) => newestKey(b) - newestKey(a));

  const open = copy.filter((m) => m.status === 'Open' || m.status === 'Closing soon');
  const closed = copy.filter((m) => m.status !== 'Open' && m.status !== 'Closing soon');

  const sortGroup = (group: AppMarket[]): AppMarket[] => {
    if (sort === 'volume') return group.sort((a, b) => parseVolume(b.volume) - parseVolume(a.volume));
    if (sort === 'ending') {
      return group.sort((a, b) => {
        const at = a.closeDate ? new Date(a.closeDate).getTime() : Infinity;
        const bt = b.closeDate ? new Date(b.closeDate).getTime() : Infinity;
        return at - bt;
      });
    }
    return group.sort((a, b) => newestKey(b) - newestKey(a));
  };

  return [...sortGroup(open), ...sortGroup(closed)];
}

function isWithinPeriod(market: AppMarket, period: PeriodFilter): boolean {
  if (period === 'all') return true;
  const created = market.createdAt ? new Date(market.createdAt).getTime() : 0;
  if (!Number.isFinite(created) || created <= 0) return false;

  const age = Date.now() - created;
  if (period === 'daily') return age <= 24 * 60 * 60 * 1000;
  if (period === 'weekly') return age <= 7 * 24 * 60 * 60 * 1000;
  return age <= 30 * 24 * 60 * 60 * 1000;
}

// Derive topic pills dynamically from actual market data — no static list
const TOPIC_STOP = new Set([
  'will', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'in', 'on', 'at', 'by', 'for', 'of', 'and', 'or', 'but',
  'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'would', 'should',
  'may', 'might', 'this', 'that', 'these', 'those', 'it', 'its', 'with', 'from',
  'not', 'no', 'yes', 'if', 'than', 'more', 'most', 'up', 'out', 'about',
  'what', 'which', 'who', 'when', 'where', 'how', 'why', 'after', 'before',
  'into', 'over', 'under', 'between', 'through', 'during', 'without', 'new',
  'big', 'first', 'next', 'last', 'ever', 'still', 'just', 'both', 'each',
  'hit', 'see', 'say', 'get', 'go', 'take', 'make', 'set', 'end', 'top',
]);

// Freshness: 1.0 at creation, decays to 0 over 72 hours.
// When fresh, momentum score lifts the topic. Older = pure volume.
const MOMENTUM_DECAY_MS = 72 * 60 * 60 * 1000;

function topicFreshness(market: AppMarket): number {
  const created = market.createdAt ? new Date(market.createdAt).getTime() : 0;
  if (!created) return 0;
  const age = Date.now() - created;
  return Math.max(0, 1 - age / MOMENTUM_DECAY_MS);
}

function deriveTopics(markets: AppMarket[]): string[] {
  if (markets.length === 0) return [];
  const score = new Map<string, { blended: number; count: number }>();

  const bump = (key: string, vol: number, freshness: number, momentum: number) => {
    // Blend: volume dominates always; momentum lifts only while fresh
    const momentumBoost = freshness * (momentum / 100) * vol;
    const blended = vol + momentumBoost;
    const prev = score.get(key) ?? { blended: 0, count: 0 };
    score.set(key, { blended: prev.blended + blended, count: prev.count + 1 });
  };

  for (const market of markets) {
    const vol = parseVolume(market.volume);
    const freshness = topicFreshness(market);
    const momentum = market.momentumScore ?? 0;

    // Category is always a stable topic signal
    const cat = market.category?.trim();
    if (cat && !['Trending', 'Breaking', 'New'].includes(cat)) {
      bump(cat, vol, freshness, momentum);
    }

    // Extract proper-noun phrases from title (skip index 0 — sentence-case)
    const words = market.title.replace(/[?!,.'";:]/g, '').split(/\s+/).filter(Boolean);
    let i = 1;
    while (i < words.length) {
      const w = words[i];
      if (!w || TOPIC_STOP.has(w.toLowerCase()) || !/^[A-Z0-9]/.test(w) || w.length < 3) {
        i++;
        continue;
      }
      const w2 = words[i + 1];
      const w3 = words[i + 2];
      if (
        w2 && w3 &&
        /^[A-Z0-9]/.test(w2) && /^[A-Z0-9]/.test(w3) &&
        !TOPIC_STOP.has(w2.toLowerCase()) && !TOPIC_STOP.has(w3.toLowerCase())
      ) {
        bump(`${w} ${w2} ${w3}`, vol, freshness, momentum);
        i += 3;
      } else if (w2 && /^[A-Z0-9]/.test(w2) && !TOPIC_STOP.has(w2.toLowerCase())) {
        bump(`${w} ${w2}`, vol, freshness, momentum);
        i += 2;
      } else {
        bump(w, vol, freshness, momentum);
        i++;
      }
    }
  }

  return Array.from(score.entries())
    .sort((a, b) => b[1].blended - a[1].blended || b[1].count - a[1].count)
    .slice(0, 14)
    .map(([topic]) => topic);
}

function getCatFromUrl() {
  if (typeof window === 'undefined') return 'Trending';
  return new URLSearchParams(window.location.search).get('cat') ?? 'Trending';
}

// ─── Main explorer ────────────────────────────────────────────────────────────
export function MarketsExplorer() {
  const { markets, isLoadingMarkets } = useAppState();

  const [activeCategory, setActiveCategory] = useState(getCatFromUrl);
  const [activeHotTopic, setActiveHotTopic] = useState('All');

  const dynamicTopics = useMemo(() => deriveTopics(markets), [markets]);

  // Reset pill selection if the derived topic no longer exists in updated data
  useEffect(() => {
    if (activeHotTopic !== 'All' && !dynamicTopics.includes(activeHotTopic)) {
      setActiveHotTopic('All');
    }
  }, [dynamicTopics, activeHotTopic]);
  const [searchValue, setSearchValue] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'resolved'>('all');
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    function syncFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get('cat') ?? 'Trending';
      setActiveCategory(cat);
      setSearchValue('');
      setSortKey('newest');
      setPeriodFilter('all');
    }

    function onCategoryChange(event: Event) {
      const cat = (event as CustomEvent<string>).detail ?? 'Trending';
      setActiveCategory(cat);
      setActiveHotTopic('All');
      setSearchValue('');
      setSortKey('newest');
      setPeriodFilter('all');
    }

    function onSearchChange(event: Event) {
      setSearchValue((event as CustomEvent<string>).detail ?? '');
    }

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    window.addEventListener('presto:category-change', onCategoryChange);
    window.addEventListener('presto:market-search', onSearchChange);
    return () => {
      window.removeEventListener('popstate', syncFromUrl);
      window.removeEventListener('presto:category-change', onCategoryChange);
      window.removeEventListener('presto:market-search', onSearchChange);
    };
  }, []);

  const filtered = markets.filter((market) => {
    // Status filter
    if (statusFilter === 'active' && (market.status === 'Closed' || market.status === 'Resolved' || market.status === 'Canceled')) {
      return false;
    }
    if (statusFilter === 'resolved' && market.status !== 'Resolved') {
      return false;
    }
    if (!isWithinPeriod(market, periodFilter)) return false;

    // Category filter - hide selected categories
    const cats = market.categories ?? (market.category ? [market.category] : []);
    if (hiddenCategories.size > 0 && cats.some((cat) => hiddenCategories.has(cat))) {
      return false;
    }

    const search = searchValue.trim().toLowerCase();
    const catBlob = cats.join(' ').toLowerCase();
    const matchesKeyword = (needle: string) =>
      market.title.toLowerCase().includes(needle) ||
    const cats = market.categories ?? (market.category ? [market.category] : []);
    if (hiddenCategories.size > 0 && cats.some((cat) => hiddenCategories.has(cat))) {
      return false;
    }

    const search = searchValue.trim().toLowerCase();
    const catBlob = cats.join(' ').toLowerCase();
    const matchesKeyword = (needle: string) =>
      market.title.toLowerCase().includes(needle) ||
      market.description.toLowerCase().includes(needle) ||
      catBlob.includes(needle);

    if (search.length > 0 && !matchesKeyword(search)) return false;
    if (activeHotTopic !== 'All') return matchesKeyword(activeHotTopic.toLowerCase());
    if (activeCategory === 'Breaking') return market.status === 'Closing soon';
    if (activeCategory === 'Trending' || activeCategory === 'New') return true;
    return matchesKeyword(activeCategory.toLowerCase());
  });

  const visibleMarkets = sortMarkets(filtered, sortKey);
  const totalVolume = markets.reduce((sum, m) => sum + parseVolume(m.volume), 0);

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-[185px] md:pt-40 md:px-7">

      {/* ── All markets ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black text-white">All markets</h2>
        <span className="text-xs text-[#4a5568]">
          <span className="font-black text-white">{formatVolume(totalVolume)}</span> total vol · Arc Testnet
        </span>
      </div>

      {/* Sort toolbar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-[#4a5568]">
          <span className="font-black text-white">{visibleMarkets.length}</span>{' '}
          market{visibleMarkets.length === 1 ? '' : 's'}
          {searchValue ? ` matching "${searchValue}"` : ''}
        </p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-[10px] border border-white/[0.06] bg-[#0d1520] p-1">
            {([['newest', 'Newest'], ['volume', 'Volume'], ['ending', 'Ending']] as [SortKey, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                className={`rounded-[7px] px-3 py-1.5 text-xs font-bold transition-colors ${
                  sortKey === key ? 'bg-[#1a2540] text-white' : 'text-[#4a5568] hover:text-[#94a3b8]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm font-bold transition-colors ${
              showAdvancedFilters
                ? 'bg-cyan/15 text-cyan'
                : 'bg-white/[0.04] text-[#cbd5e1] hover:bg-white/[0.08] hover:text-white'
            }`}
            title="Toggle filter options"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter toolbar - Polymarket style */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {showAdvancedFilters && (
          <>
            {/* Sort dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenDropdown(openDropdown === 'volume' ? null : 'volume')}
                className="flex items-center gap-2 rounded-[8px] bg-white/[0.04] px-3 py-2 text-sm font-bold text-[#cbd5e1] transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                {sortLabels[sortKey]}
                <span className="text-[10px]">v</span>
              </button>
              {openDropdown === 'volume' && (
                <div className="absolute top-full mt-1 left-0 rounded-[8px] border border-white/[0.06] bg-[#0d1520] py-1 z-50 min-w-[180px]">
                  {([
                    ['newest', 'Newest'],
                    ['volume', 'Volume'],
                    ['ending', 'Ending soon'],
                  ] as [SortKey, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`block w-full px-4 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.08] hover:text-white ${
                        sortKey === key ? 'text-cyan' : 'text-[#cbd5e1]'
                      }`}
                      onClick={() => {
                        setSortKey(key);
                        setOpenDropdown(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Created period */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenDropdown(openDropdown === 'period' ? null : 'period')}
                className="flex items-center gap-2 rounded-[8px] bg-white/[0.04] px-3 py-2 text-sm font-bold text-[#cbd5e1] transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                {periodLabels[periodFilter]}
                <span className="text-[10px]">v</span>
              </button>
              {openDropdown === 'period' && (
                <div className="absolute top-full mt-1 left-0 rounded-[8px] border border-white/[0.06] bg-[#0d1520] py-1 z-50 min-w-[120px]">
                  {([
                    ['all', 'All time'],
                    ['daily', 'Today'],
                    ['weekly', 'This week'],
                    ['monthly', 'This month'],
                  ] as [PeriodFilter, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`block w-full px-4 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.08] hover:text-white ${
                        periodFilter === key ? 'text-cyan' : 'text-[#cbd5e1]'
                      }`}
                      onClick={() => {
                        setPeriodFilter(key);
                        setOpenDropdown(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Status dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenDropdown(openDropdown === 'status' ? null : 'status')}
                className="flex items-center gap-2 rounded-[8px] bg-white/[0.04] px-3 py-2 text-sm font-bold text-[#cbd5e1] transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                {statusFilter === 'active' ? 'Active' : statusFilter === 'resolved' ? 'Resolved' : 'All'}
                <span className="text-[10px]">v</span>
              </button>
              {openDropdown === 'status' && (
                <div className="absolute top-full mt-1 left-0 rounded-[8px] border border-white/[0.06] bg-[#0d1520] py-1 z-50 min-w-[120px]">
                  {(['all', 'active', 'resolved'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => {
                        setStatusFilter(status);
                        setOpenDropdown(null);
                      }}
                      className="block w-full px-4 py-1.5 text-left text-sm text-[#cbd5e1] hover:bg-white/[0.08] hover:text-white transition-colors"
                    >
                      {status === 'all' ? 'All' : status === 'active' ? 'Active' : 'Resolved'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Hide category checkboxes */}
            {(['Sports', 'Crypto', 'Earnings'] as const).map((cat) => (
              <label key={cat} className="flex items-center gap-2 px-3 py-2 cursor-pointer rounded-[8px] transition-colors hover:bg-white/[0.04]">
                <input
                  type="checkbox"
                  checked={hiddenCategories.has(cat)}
                  onChange={() => {
                    const updated = new Set(hiddenCategories);
                    if (updated.has(cat)) {
                      updated.delete(cat);
                    } else {
                      updated.add(cat);
                    }
                    setHiddenCategories(updated);
                  }}
                  className="w-4 h-4 rounded accent-cyan cursor-pointer"
                />
                <span className="text-sm text-[#cbd5e1]">Hide {cat}</span>
              </label>
            ))}

            {/* Clear filters */}
            {(statusFilter !== 'all' || periodFilter !== 'all' || hiddenCategories.size > 0) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('all');
                  setPeriodFilter('all');
                  setHiddenCategories(new Set());
                }}
                className="ml-2 text-sm font-bold text-cyan/80 transition-colors hover:text-cyan"
              >
                Clear filters
              </button>
            )}
          </>
        )}
      </div>

      {/* Market grid */}
      {isLoadingMarkets ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : visibleMarkets.length > 0 ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibleMarkets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      ) : (
        <div className="mt-10 rounded-[16px] border border-dashed border-white/[0.07] bg-[#0d1520] px-8 py-14 text-center">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-cyan/70">No results</p>
          <h2 className="mt-4 text-xl font-black text-white">
            {markets.length === 0 ? 'No markets on chain yet' : 'No markets match that filter'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#64748b]">
            {markets.length === 0
              ? 'Check back soon for new markets.'
              : 'Try a different category or search term.'}
          </p>
        </div>
      )}
    </main>
  );
}

function HorizScroller({ children, className }: { children: ReactNode; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <section className={`relative ${className}`}>
      <div ref={ref} className="scrollbar-hide overflow-x-auto">
        {children}
      </div>
    </section>
  );
}
