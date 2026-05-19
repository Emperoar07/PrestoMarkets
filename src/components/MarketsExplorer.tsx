'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MarketCard } from './MarketCard';
import { MarketSignalChart } from './MarketSignalChart';
import { useAppState } from '@/lib/appState';
import { topicMarketCategories } from '@/lib/categories';
import type { AppMarket } from '@/lib/appState';

type SortKey = 'volume' | 'ending' | 'newest';

function parseVolume(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return 0;
  if (v.includes('M')) return n * 1_000_000;
  if (v.includes('K')) return n * 1_000;
  return n;
}

function fmtVol(v: number) {
  if (v === 0) return '$0';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function sortMarkets(list: AppMarket[], sort: SortKey): AppMarket[] {
  const copy = [...list];
  if (sort === 'volume') return copy.sort((a, b) => parseVolume(b.volume) - parseVolume(a.volume));
  if (sort === 'ending') {
    return copy.sort((a, b) => {
      const at = a.closeDate ? new Date(a.closeDate).getTime() : Infinity;
      const bt = b.closeDate ? new Date(b.closeDate).getTime() : Infinity;
      return at - bt;
    });
  }
  return copy.reverse();
}

function getCatFromUrl() {
  if (typeof window === 'undefined') return 'Trending';
  return new URLSearchParams(window.location.search).get('cat') ?? 'Trending';
}

// ─── Featured market hero (Polymarket-style large card) ───────────────────────
function FeaturedMarket({ market }: { market: AppMarket }) {
  const yes = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
  const no = market.outcomes.find((o) => o.label === 'NO') ?? market.outcomes[1] ?? yes;
  const isLive = market.status === 'Open' || market.status === 'Closing soon';

  return (
    <Link
      href={`/markets/${market.id}`}
      className="group flex flex-col overflow-hidden rounded-[18px] border border-white/[0.06] bg-[#0d1520] transition-all hover:border-white/[0.1]"
    >
      {/* Header */}
      <div className="flex items-start gap-4 p-6 pb-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[#111b2e]">
          {market.imageURI ? (
            <img src={market.imageURI} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-sm font-black text-cyan">{market.category.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#4a5568]">
            {market.category}
            {isLive ? <span className="ml-2 inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Live</span> : null}
          </p>
          <h2 className="mt-1 text-[22px] font-black leading-snug tracking-tight text-white">
            {market.title}
          </h2>
        </div>
      </div>

      {/* Outcome rows */}
      <div className="px-6 py-2 space-y-2">
        {[yes, no].map((outcome) => (
          <div key={outcome.label} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-bold text-white">{outcome.label === 'YES' ? 'Yes' : 'No'}</span>
              <span className={`text-lg font-black ${outcome.label === 'YES' ? 'text-white' : 'text-[#64748b]'}`}>
                {outcome.odds}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-[8px] bg-[#0a3320] px-4 py-1.5 text-xs font-bold text-[#4ade80] hover:bg-[#0d4429]"
                onClick={(e) => e.preventDefault()}
              >
                Buy Yes
              </button>
              <button
                type="button"
                className="rounded-[8px] bg-[#2d1010] px-4 py-1.5 text-xs font-bold text-[#f87171] hover:bg-[#3d1515]"
                onClick={(e) => e.preventDefault()}
              >
                Buy No
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="px-6 pt-3">
        <MarketSignalChart market={market} compact />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[0.04] px-6 py-4 mt-2">
        <span className="text-sm font-bold text-[#4a5568]">{market.volume} Vol.</span>
        <span className="text-sm font-bold text-[#4a5568]">
          {market.closeLabel ? `Ends ${market.closeLabel}` : market.status}
        </span>
      </div>
    </Link>
  );
}

// ─── Breaking news panel ──────────────────────────────────────────────────────
function BreakingNewsPanel({ markets }: { markets: AppMarket[] }) {
  const items = markets
    .filter((m) => m.status === 'Closing soon' || m.status === 'Open')
    .sort((a, b) => parseVolume(b.volume) - parseVolume(a.volume))
    .slice(0, 5);

  return (
    <div className="rounded-[16px] border border-white/[0.06] bg-[#0d1520] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-black text-white">Breaking news</h3>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-[#4a5568]">No markets closing soon.</p>
      ) : (
        <ol className="space-y-4">
          {items.map((market, i) => {
            const yes = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
            return (
              <li key={market.id}>
                <Link href={`/markets/${market.id}`} className="flex items-start gap-3 group">
                  <span className="mt-0.5 w-4 shrink-0 text-[11px] font-black text-[#334155]">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13px] font-bold leading-snug text-[#cbd5e1] group-hover:text-white transition-colors">
                      {market.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-sm font-black text-white">{yes.odds}%</span>
                      <span className="text-[11px] font-bold text-[#4ade80]">↑ chance</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ─── Hot topics panel ─────────────────────────────────────────────────────────
function HotTopicsPanel({ markets }: { markets: AppMarket[] }) {
  const topics = topicMarketCategories
    .filter((t) => t !== 'All')
    .map((topic) => {
      const matched = markets.filter(
        (m) =>
          m.title.toLowerCase().includes(topic.toLowerCase()) ||
          m.category.toLowerCase().includes(topic.toLowerCase()) ||
          m.description.toLowerCase().includes(topic.toLowerCase()),
      );
      const vol = matched.reduce((s, m) => s + parseVolume(m.volume), 0);
      return { topic, vol, count: matched.length };
    })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.vol - a.vol)
    .slice(0, 5);

  return (
    <div className="rounded-[16px] border border-white/[0.06] bg-[#0d1520] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-black text-white">Hot topics</h3>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4a5568" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
      {topics.length === 0 ? (
        <p className="text-xs text-[#4a5568]">No topic data yet.</p>
      ) : (
        <ol className="space-y-3">
          {topics.map(({ topic, vol }, i) => (
            <li key={topic} className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-[11px] font-black text-[#334155]">{i + 1}</span>
              <span className="flex-1 text-[13px] font-bold text-[#cbd5e1]">{topic}</span>
              <span className="text-[12px] font-bold text-[#4a5568]">{fmtVol(vol)}</span>
              <span className="text-base">🔥</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── Main explorer ────────────────────────────────────────────────────────────
export function MarketsExplorer() {
  const { markets, isLoadingMarkets } = useAppState();
  const [activeCategory, setActiveCategory] = useState(getCatFromUrl);
  const [activeHotTopic, setActiveHotTopic] = useState('All');
  const [searchValue, setSearchValue] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const cat = getCatFromUrl();
    return cat === 'Breaking' ? 'ending' : cat === 'New' ? 'newest' : 'volume';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    function syncFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get('cat') ?? 'Trending';
      const q = params.get('q') ?? '';
      setActiveCategory(cat);
      setSearchValue(q);
      setSortKey(cat === 'Breaking' ? 'ending' : cat === 'New' ? 'newest' : 'volume');
    }

    function onCategoryChange(event: Event) {
      const cat = (event as CustomEvent<string>).detail ?? 'Trending';
      setActiveCategory(cat);
      setActiveHotTopic('All');
      setSortKey(cat === 'Breaking' ? 'ending' : cat === 'New' ? 'newest' : 'volume');
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

  // Featured = highest-volume market overall (shown when no search/topic filter active)
  const featuredMarket = markets.length > 0
    ? [...markets].sort((a, b) => parseVolume(b.volume) - parseVolume(a.volume))[0]
    : null;

  const showHero = !isLoadingMarkets && featuredMarket && !searchValue && activeHotTopic === 'All';

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-36 md:px-7">

      {/* ── Hero: featured market + sidebar ── */}
      {showHero ? (
        <div className="mb-10 grid gap-4 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_320px]">
          <FeaturedMarket market={featuredMarket} />
          <div className="flex flex-col gap-4">
            <BreakingNewsPanel markets={markets} />
            <HotTopicsPanel markets={markets} />
          </div>
        </div>
      ) : null}

      {/* ── All markets ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black text-white">All markets</h2>
        <span className="text-xs text-[#4a5568]">
          <span className="font-black text-white">{isLoadingMarkets ? '—' : fmtVol(totalVolume)}</span> total vol · Arc Testnet
        </span>
      </div>

      {/* Hot topic pills */}
      <HorizScroller className="mt-3 border-b border-white/[0.04] pb-3">
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
      </HorizScroller>

      {/* Sort toolbar */}
      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-sm text-[#4a5568]">
          <span className="font-black text-white">{isLoadingMarkets ? '—' : visibleMarkets.length}</span>{' '}
          market{visibleMarkets.length === 1 ? '' : 's'}
          {searchValue ? ` matching "${searchValue}"` : ''}
        </p>
        <div className="flex items-center gap-0.5 rounded-[10px] border border-white/[0.06] bg-[#0d1520] p-1">
          {([['volume', 'Volume'], ['ending', 'Ending'], ['newest', 'Newest']] as [SortKey, string][]).map(([key, label]) => (
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
