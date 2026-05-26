'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { MarketCard } from './MarketCard';
import { MarketSignalChart } from './MarketSignalChart';
import { useAppState } from '@/lib/appState';
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
    return group.reverse();
  };

  return [...sortGroup(open), ...sortGroup(closed)];
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

// ─── Breaking news panel ──────────────────────────────────────────────────────
// Pulls real crypto news from /api/news/breaking, which itself fetches Cointelegraph,
// Decrypt, The Block, CoinDesk, and TechCrunch Crypto RSS, ranks them, and caches the
// result for 24h. The agent's market drafts and the news feed are separate concerns.
type NewsItem = { title: string; url: string; source: string; publishedAt: string };

function BreakingNewsPanel() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/news/breaking')
      .then((r) => r.json())
      .then((data: { items?: NewsItem[] }) => { if (!cancelled) setItems(data.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visible = items.slice(0, 5);
  const remaining = Math.max(0, items.length - visible.length);

  return (
    <div className="rounded-[16px] border border-white/[0.06] bg-[#0d1520] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-black text-white">Breaking news</h3>
      </div>
      {loading ? (
        <p className="text-xs text-[#4a5568]">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="text-xs text-[#4a5568]">News feed unavailable right now.</p>
      ) : (
        <ol className="space-y-4">
          {visible.map((item, i) => (
            <li key={item.url}>
              <a href={item.url} target="_blank" rel="noreferrer" className="flex items-start gap-3 group">
                <span className="mt-0.5 w-4 shrink-0 text-[11px] font-black text-[#334155]">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] font-bold leading-snug text-[#cbd5e1] group-hover:text-white transition-colors">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[10.5px] font-bold uppercase tracking-widest text-[#4a5568]">
                    {item.source}
                  </p>
                </div>
              </a>
            </li>
          ))}
        </ol>
      )}
      {remaining > 0 ? (
        <Link href="/news" className="mt-5 block border-t border-white/[0.04] pt-4 text-[12px] font-bold text-cyan/80 transition-colors hover:text-cyan">
          See {remaining} more
        </Link>
      ) : null}
    </div>
  );
}

// ─── Hot topics panel ─────────────────────────────────────────────────────────
function HotTopicsPanel({ markets, topics: derivedTopics }: { markets: AppMarket[]; topics: string[] }) {
  const topics = derivedTopics.slice(0, 5).map((topic) => {
    const t = topic.toLowerCase();
    const matched = markets.filter(
      (m) =>
        m.title.toLowerCase().includes(t) ||
        m.category.toLowerCase().includes(t) ||
        m.description.toLowerCase().includes(t),
    );
    const vol = matched.reduce((s, m) => s + parseVolume(m.volume), 0);
    return { topic, vol, count: matched.length };
  }).filter((t) => t.count > 0);

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
  const { markets } = useAppState();

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
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('all');
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    function syncFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const cat = params.get('cat') ?? 'Trending';
      setActiveCategory(cat);
      setSearchValue('');
      setSortKey('newest');
    }

    function onCategoryChange(event: Event) {
      const cat = (event as CustomEvent<string>).detail ?? 'Trending';
      setActiveCategory(cat);
      setActiveHotTopic('All');
      setSearchValue('');
      setSortKey('newest');
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
    if (statusFilter === 'closed' && (market.status !== 'Closed' && market.status !== 'Resolved' && market.status !== 'Canceled')) {
      return false;
    }

    // Category filter - hide selected categories
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

  const showSidePanels = markets.length > 0 && !searchValue && activeHotTopic === 'All';

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-[185px] md:pt-40 md:px-7">

      {/* Side panels: breaking + hot topics. The big featured-market hero was removed in
          favor of letting the market grid speak for itself. */}
      {showSidePanels ? (
        <div className="mb-8 grid gap-4 md:grid-cols-2">
          <BreakingNewsPanel />
          <HotTopicsPanel markets={markets} topics={dynamicTopics} />
        </div>
      ) : null}

      {/* ── All markets ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-black text-white">All markets</h2>
        <span className="text-xs text-[#4a5568]">
          <span className="font-black text-white">{fmtVol(totalVolume)}</span> total vol · Arc Testnet
        </span>
      </div>

      {/* Hot topic pills — derived live from market data */}
      <HorizScroller className="mt-3 border-b border-white/[0.04] pb-3">
        <div className="flex gap-1.5">
          {(['All', ...dynamicTopics]).map((cat) => (
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
          <span className="font-black text-white">{visibleMarkets.length}</span>{' '}
          market{visibleMarkets.length === 1 ? '' : 's'}
          {searchValue ? ` matching "${searchValue}"` : ''}
        </p>
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
      </div>

      {/* Filter toolbar */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {/* Status filter */}
        <div className="flex items-center gap-0.5 rounded-[8px] border border-white/[0.06] bg-white/[0.02] p-1">
          {(['all', 'active', 'closed'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-[6px] px-2.5 py-1 text-xs font-bold transition-colors ${
                statusFilter === status
                  ? 'bg-white/[0.08] text-white'
                  : 'text-[#4a5568] hover:text-[#94a3b8]'
              }`}
            >
              {status === 'all' ? 'All' : status === 'active' ? 'Active' : 'Closed'}
            </button>
          ))}
        </div>

        {/* Hide category filters - show most common ones */}
        {(['Sports', 'Crypto', 'Earnings'] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => {
              const updated = new Set(hiddenCategories);
              if (updated.has(cat)) {
                updated.delete(cat);
              } else {
                updated.add(cat);
              }
              setHiddenCategories(updated);
            }}
            className={`rounded-[6px] px-3 py-1.5 text-xs font-bold transition-colors ${
              hiddenCategories.has(cat)
                ? 'bg-white/[0.08] text-white'
                : 'text-[#4a5568] hover:bg-white/[0.04] hover:text-[#94a3b8]'
            }`}
          >
            {hiddenCategories.has(cat) ? `✓ Hide ${cat}` : `Hide ${cat}`}
          </button>
        ))}

        {/* Clear filters */}
        {(statusFilter !== 'all' || hiddenCategories.size > 0) && (
          <button
            type="button"
            onClick={() => {
              setStatusFilter('all');
              setHiddenCategories(new Set());
            }}
            className="text-xs font-bold text-cyan/80 transition-colors hover:text-cyan"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Market grid */}
      {visibleMarkets.length > 0 ? (
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
