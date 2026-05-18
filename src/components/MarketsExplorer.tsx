'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MarketCard } from './MarketCard';
import { useAppState } from '@/lib/appState';
import { primaryMarketCategories, topicMarketCategories } from '@/lib/categories';
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

const categoryEventName = 'presto:market-search';

export function MarketsExplorer() {
  const { markets, isLoadingMarkets } = useAppState();
  const [activePrimaryCategory, setActivePrimaryCategory] = useState('Trending');
  const [activeTopicCategory, setActiveTopicCategory] = useState('All');
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
    window.addEventListener(categoryEventName, syncSearchFromHeader);
    return () => {
      window.removeEventListener('popstate', syncSearchFromUrl);
      window.removeEventListener(categoryEventName, syncSearchFromHeader);
    };
  }, []);

  function selectPrimaryCategory(cat: string) {
    setActivePrimaryCategory(cat);
    setActiveTopicCategory('All');
    setSortKey(cat === 'Breaking' ? 'ending' : cat === 'New' ? 'newest' : 'volume');
  }

  const filtered = markets.filter((market) => {
    const search = searchValue.trim().toLowerCase();
    if (search.length > 0) {
      const matches = market.title.toLowerCase().includes(search)
        || market.description.toLowerCase().includes(search)
        || market.category.toLowerCase().includes(search);
      if (!matches) return false;
    }

    if (activeTopicCategory !== 'All') {
      const topic = activeTopicCategory.toLowerCase();
      return market.title.toLowerCase().includes(topic)
        || market.description.toLowerCase().includes(topic)
        || market.category.toLowerCase().includes(topic);
    }

    if (activePrimaryCategory === 'Breaking') {
      return market.status === 'Closing soon';
    }

    if (activePrimaryCategory === 'Trending' || activePrimaryCategory === 'New') {
      return true;
    }

    const primary = activePrimaryCategory.toLowerCase();
    return market.category.toLowerCase().includes(primary)
      || market.title.toLowerCase().includes(primary)
      || market.description.toLowerCase().includes(primary);
  });

  const visibleMarkets = sortMarkets(filtered, sortKey);
  const totalVolume = markets.reduce((sum, m) => sum + parseVolume(m.volume), 0);

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-24 md:px-7">

      {/* Stats strip */}
      <div className="flex items-center gap-6 border-b border-white/[0.06] pb-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">Markets</p>
          <p className="mt-0.5 text-xl font-black text-white">{isLoadingMarkets ? '—' : markets.length}</p>
        </div>
        <div className="h-8 w-px bg-white/[0.06]" />
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">Total volume</p>
          <p className="mt-0.5 text-xl font-black text-white">
            {isLoadingMarkets ? '—' : totalVolume === 0 ? '$0' : totalVolume >= 1_000_000
              ? `$${(totalVolume / 1_000_000).toFixed(1)}M`
              : totalVolume >= 1_000 ? `$${(totalVolume / 1_000).toFixed(1)}K`
              : `$${totalVolume.toFixed(0)}`}
          </p>
        </div>
        <div className="h-8 w-px bg-white/[0.06]" />
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">Chain</p>
          <p className="mt-0.5 text-sm font-black text-cyan">Arc Testnet</p>
        </div>
      </div>

      {/* Primary category tabs */}
      <CategoryScroller className="mt-5 border-b border-white/[0.06] pb-4">
        <div className="flex gap-7 text-sm font-black text-[#8fa0b4]">
          {primaryMarketCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => selectPrimaryCategory(cat)}
              className={`min-w-fit pb-1 transition-colors hover:text-white ${
                activePrimaryCategory === cat && activeTopicCategory === 'All'
                  ? 'border-b-2 border-cyan text-white'
                  : ''
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </CategoryScroller>

      {/* Topic pills */}
      <CategoryScroller className="border-b border-white/[0.06] py-3">
        <div className="flex gap-2">
          {topicMarketCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveTopicCategory(cat)}
              className={`min-w-fit rounded-full px-3.5 py-1.5 text-xs font-black transition-colors ${
                activeTopicCategory === cat
                  ? 'bg-cyan/15 text-cyan ring-1 ring-cyan/30'
                  : 'text-[#8fa0b4] hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </CategoryScroller>

      {/* Toolbar */}
      <div className="mt-5 flex items-center justify-between gap-4">
        <p className="text-sm text-muted">
          <span className="font-black text-white">{visibleMarkets.length}</span>{' '}
          market{visibleMarkets.length === 1 ? '' : 's'}
          {searchValue ? ` matching "${searchValue}"` : ''}
        </p>

        <div className="flex items-center gap-1 rounded-[10px] border border-white/[0.06] bg-[#141e30] p-1">
          {([['volume', 'Volume'], ['ending', 'Ending'], ['newest', 'Newest']] as [SortKey, string][]).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSortKey(key)}
              className={`rounded-[7px] px-3 py-1.5 text-xs font-black transition-colors ${
                sortKey === key
                  ? 'bg-[#0f172a] text-white shadow-sm'
                  : 'text-[#8fa0b4] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Market grid */}
      {isLoadingMarkets ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-[16px] border border-white/[0.06] bg-[#192126] p-5">
              <div className="flex gap-3">
                <div className="h-10 w-10 shrink-0 rounded-[10px] bg-white/[0.07]" />
                <div className="flex-1 space-y-2">
                  <div className="h-2.5 w-1/3 rounded bg-white/[0.07]" />
                  <div className="h-4 w-full rounded bg-white/[0.07]" />
                  <div className="h-4 w-2/3 rounded bg-white/[0.05]" />
                </div>
              </div>
              <div className="mt-5 h-1.5 w-full rounded-full bg-white/[0.07]" />
              <div className="mt-3 flex justify-between">
                <div className="h-3 w-14 rounded bg-white/[0.05]" />
                <div className="h-3 w-14 rounded bg-white/[0.05]" />
              </div>
              <div className="mt-5 flex justify-between border-t border-white/[0.04] pt-3">
                <div className="h-3 w-24 rounded bg-white/[0.05]" />
                <div className="h-3 w-12 rounded bg-white/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleMarkets.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibleMarkets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      ) : (
        <div className="mt-10 rounded-[16px] border border-dashed border-white/[0.08] bg-[#141e30] px-8 py-14 text-center">
          <p className="text-4xl">🔍</p>
          <h2 className="mt-4 text-xl font-black text-white">
            {markets.length === 0 ? 'No markets on chain yet' : 'No markets match that filter'}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            {markets.length === 0
              ? 'The Arc factory has no deployed markets. Check your RPC and factory address env vars.'
              : 'Try a different category, topic, or search term.'}
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
