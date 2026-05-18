'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MarketCard } from './MarketCard';
import { useAppState } from '@/lib/appState';
import { primaryViewCategories, topicNavCategories, topicMarketCategories } from '@/lib/categories';
import type { AppMarket } from '@/lib/appState';

type SortKey = 'volume' | 'ending' | 'newest';

function parseVolume(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return 0;
  if (v.includes('M')) return n * 1_000_000;
  if (v.includes('K')) return n * 1_000;
  return n;
}

function sortMarkets(list: AppMarket[], sort: SortKey): AppMarket[] {
  const copy = [...list];
  if (sort === 'volume') {
    return copy.sort((a, b) => parseVolume(b.volume) - parseVolume(a.volume));
  }
  if (sort === 'ending') {
    return copy.sort((a, b) => {
      const at = a.closeDate ? new Date(a.closeDate).getTime() : Infinity;
      const bt = b.closeDate ? new Date(b.closeDate).getTime() : Infinity;
      return at - bt;
    });
  }
  return copy.reverse();
}

const searchEventName = 'presto:market-search';

export function MarketsExplorer() {
  const { markets, isLoadingMarkets } = useAppState();
  const [activeCategory, setActiveCategory] = useState('Trending');
  const [activeHotTopic, setActiveHotTopic] = useState('All');
  const [searchValue, setSearchValue] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('volume');

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    function syncSearchFromUrl() {
      setSearchValue(new URLSearchParams(window.location.search).get('q') ?? '');
    }

    function syncSearchFromHeader(event: Event) {
      setSearchValue((event as CustomEvent<string>).detail ?? '');
    }

    syncSearchFromUrl();
    window.addEventListener('popstate', syncSearchFromUrl);
    window.addEventListener(searchEventName, syncSearchFromHeader);
    return () => {
      window.removeEventListener('popstate', syncSearchFromUrl);
      window.removeEventListener(searchEventName, syncSearchFromHeader);
    };
  }, []);

  function selectCategory(cat: string) {
    setActiveCategory(cat);
    setActiveHotTopic('All');
    setSortKey(cat === 'Breaking' ? 'ending' : cat === 'New' ? 'newest' : 'volume');
  }

  const filtered = markets.filter((market) => {
    const search = searchValue.trim().toLowerCase();
    if (search.length > 0) {
      const matches =
        market.title.toLowerCase().includes(search) ||
        market.description.toLowerCase().includes(search) ||
        market.category.toLowerCase().includes(search);
      if (!matches) return false;
    }

    if (activeHotTopic !== 'All') {
      const topic = activeHotTopic.toLowerCase();
      return (
        market.title.toLowerCase().includes(topic) ||
        market.description.toLowerCase().includes(topic) ||
        market.category.toLowerCase().includes(topic)
      );
    }

    if (activeCategory === 'Breaking') return market.status === 'Closing soon';
    if (activeCategory === 'Trending' || activeCategory === 'New') return true;

    const cat = activeCategory.toLowerCase();
    return (
      market.category.toLowerCase().includes(cat) ||
      market.title.toLowerCase().includes(cat) ||
      market.description.toLowerCase().includes(cat)
    );
  });

  const visibleMarkets = sortMarkets(filtered, sortKey);
  const totalVolume = markets.reduce((sum, m) => sum + parseVolume(m.volume), 0);

  const fmtVolume = (v: number) =>
    v === 0 ? '$0'
    : v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `$${(v / 1_000).toFixed(1)}K`
    : `$${v.toFixed(0)}`;

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-[66px] md:px-7">

      {/* ── Polymarket-style combined nav row ── */}
      <CategoryScroller className="border-b border-white/[0.06]">
        <div className="flex items-center">
          {/* Primary view tabs: Trending / Breaking / New */}
          {primaryViewCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => selectCategory(cat)}
              className={`flex min-w-fit items-center gap-1.5 px-4 py-4 text-[13px] font-bold transition-colors ${
                activeCategory === cat && activeHotTopic === 'All'
                  ? 'border-b-2 border-cyan text-white'
                  : 'text-[#64748b] hover:text-[#94a3b8]'
              }`}
            >
              {cat === 'Trending' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              ) : cat === 'Breaking' ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="10" opacity="0.3" />
                  <circle cx="12" cy="12" r="5" />
                </svg>
              ) : null}
              {cat}
            </button>
          ))}

          {/* Divider */}
          <div className="mx-1 h-5 w-px shrink-0 bg-white/[0.1]" />

          {/* Topic nav tabs: Politics / Sports / Crypto … */}
          {topicNavCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => selectCategory(cat)}
              className={`min-w-fit px-4 py-4 text-[13px] font-bold transition-colors ${
                activeCategory === cat && activeHotTopic === 'All'
                  ? 'border-b-2 border-cyan text-white'
                  : 'text-[#64748b] hover:text-[#94a3b8]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </CategoryScroller>

      {/* Hot topic pills */}
      <CategoryScroller className="border-b border-white/[0.04] py-2.5">
        <div className="flex gap-1.5">
          {topicMarketCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveHotTopic(cat)}
              className={`min-w-fit rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                activeHotTopic === cat
                  ? 'bg-cyan/15 text-cyan ring-1 ring-cyan/30'
                  : 'text-[#4a5568] hover:bg-white/[0.04] hover:text-[#94a3b8]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </CategoryScroller>

      {/* Stats + sort toolbar */}
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#4a5568]">Markets</p>
            <p className="text-sm font-black text-white">{isLoadingMarkets ? '—' : markets.length}</p>
          </div>
          <div className="h-6 w-px bg-white/[0.06]" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#4a5568]">Total volume</p>
            <p className="text-sm font-black text-white">{isLoadingMarkets ? '—' : fmtVolume(totalVolume)}</p>
          </div>
          <div className="h-6 w-px bg-white/[0.06]" />
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#4a5568]">Chain</p>
            <p className="text-sm font-black text-cyan">Arc Testnet</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <p className="hidden text-xs text-[#4a5568] sm:block">
            <span className="font-black text-white">{visibleMarkets.length}</span> market{visibleMarkets.length === 1 ? '' : 's'}
            {searchValue ? ` for "${searchValue}"` : ''}
          </p>
          <div className="flex items-center gap-0.5 rounded-[10px] border border-white/[0.06] bg-[#0d1520] p-1">
            {(['volume', 'Ending', 'Newest'] as const).map((k) => {
              const key = k === 'Ending' ? 'ending' : k === 'Newest' ? 'newest' : 'volume' as SortKey;
              const label = k === 'volume' ? 'Volume' : k;
              return (
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
              );
            })}
          </div>
        </div>
      </div>

      {/* Market grid */}
      {isLoadingMarkets ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-[14px] border border-white/[0.05] bg-[#131a27] p-4">
              <div className="flex gap-3">
                <div className="h-9 w-9 shrink-0 rounded-[10px] bg-white/[0.06]" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-full rounded bg-white/[0.06]" />
                  <div className="h-4 w-2/3 rounded bg-white/[0.04]" />
                </div>
              </div>
              <div className="mt-5 flex items-end justify-between">
                <div className="h-7 w-16 rounded bg-white/[0.06]" />
                <div className="flex gap-2">
                  <div className="h-8 w-16 rounded-[8px] bg-[#0a3320]" />
                  <div className="h-8 w-14 rounded-[8px] bg-[#2d1010]" />
                </div>
              </div>
              <div className="mt-4 flex justify-between border-t border-white/[0.04] pt-3">
                <div className="h-3 w-20 rounded bg-white/[0.04]" />
                <div className="h-3 w-14 rounded bg-white/[0.04]" />
              </div>
            </div>
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
          <p className="text-4xl">🔍</p>
          <h2 className="mt-4 text-xl font-black text-white">
            {markets.length === 0 ? 'No markets on chain yet' : 'No markets match that filter'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#64748b]">
            {markets.length === 0
              ? 'The Arc factory has no deployed markets. Check your RPC and factory address env vars.'
              : 'Try a different category or search term.'}
          </p>
        </div>
      )}
    </main>
  );
}

function CategoryScroller({ children, className }: { children: ReactNode; className: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  return (
    <section className={`relative ${className}`}>
      <div ref={scrollerRef} className="scrollbar-hide overflow-x-auto">
        {children}
      </div>
    </section>
  );
}
