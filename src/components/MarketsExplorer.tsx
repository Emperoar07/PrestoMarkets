'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MarketCard } from './MarketCard';
import { useAppState } from '@/lib/appState';
import { primaryMarketCategories, topicMarketCategories } from '@/lib/categories';

const categoryEventName = 'presto:market-search';

export function MarketsExplorer() {
  const { markets } = useAppState();
  const [activePrimaryCategory, setActivePrimaryCategory] = useState('Trending');
  const [activeTopicCategory, setActiveTopicCategory] = useState('All');
  const [searchValue, setSearchValue] = useState('');

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

  const visibleMarkets = markets.filter((market) => {
    const search = searchValue.trim().toLowerCase();
    const matchesSearch = search.length === 0
      || market.title.toLowerCase().includes(search)
      || market.description.toLowerCase().includes(search)
      || market.category.toLowerCase().includes(search);

    if (!matchesSearch) {
      return false;
    }

    if (activeTopicCategory !== 'All') {
      const topic = activeTopicCategory.toLowerCase();
      return market.title.toLowerCase().includes(topic)
        || market.description.toLowerCase().includes(topic)
        || market.category.toLowerCase().includes(topic);
    }

    if (activePrimaryCategory === 'Trending') {
      return true;
    }

    if (activePrimaryCategory === 'Breaking') {
      return market.status === 'Closing soon' || market.status === 'Open';
    }

    if (activePrimaryCategory === 'New') {
      return true;
    }

    const primary = activePrimaryCategory.toLowerCase();
    return market.category.toLowerCase().includes(primary)
      || market.title.toLowerCase().includes(primary)
      || market.description.toLowerCase().includes(primary);
  });

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-28 md:px-7">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Explore</p>
        <h1 className="mt-3 text-[clamp(38px,6vw,64px)] font-black tracking-tight text-white">Presto Markets</h1>
        <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-[1.7] text-muted">
          Browse live Arc markets, search public signals, and trade USDC-backed outcomes with clear rules.
        </p>
      </div>

      <CategoryScroller className="mt-9 border-y border-white/[0.06] py-3">
        <div className="flex gap-7 pb-1 text-sm font-black text-[#8fa0b4]">
          {primaryMarketCategories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => {
                setActivePrimaryCategory(category);
                setActiveTopicCategory('All');
              }}
              className={`min-w-fit transition-colors hover:text-white ${activePrimaryCategory === category && activeTopicCategory === 'All' ? 'text-white' : ''}`}
            >
              {category}
            </button>
          ))}
        </div>
      </CategoryScroller>

      <CategoryScroller className="border-b border-white/[0.06] py-4">
        <div className="flex gap-4 pb-1">
          {topicMarketCategories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveTopicCategory(category)}
                className={`min-w-fit rounded-[8px] px-4 py-2 text-sm font-black transition-colors ${
                  activeTopicCategory === category
                    ? 'bg-[#123f5c] text-cyan'
                    : 'text-[#8fa0b4] hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                {category}
              </button>
            ))}
        </div>
      </CategoryScroller>

      <div className="mt-7 flex items-center justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Live factory markets</p>
          <p className="mt-1 text-sm text-muted">{visibleMarkets.length} market{visibleMarkets.length === 1 ? '' : 's'} in view</p>
        </div>
        <p className="text-sm font-bold text-cyan">Arc Testnet</p>
      </div>

      {visibleMarkets.length > 0 ? (
        <div className="mt-9 grid gap-5 lg:grid-cols-3">
          {visibleMarkets.map((market) => <MarketCard key={market.id} market={market} />)}
        </div>
      ) : (
        <div className="mt-9 rounded-[16px] border border-dashed border-white/[0.08] bg-[#141e30] p-10 text-center">
          <h2 className="text-2xl font-black text-white">No markets match that view</h2>
          <p className="mt-3 text-muted">
            Try another filter or search term. Live markets will appear here as soon as the deployed Arc factory returns them.
          </p>
        </div>
      )}
    </main>
  );
}

function CategoryScroller({ children, className }: { children: ReactNode; className: string }) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollByAmount(direction: 'left' | 'right') {
    scrollerRef.current?.scrollBy({
      left: direction === 'left' ? -320 : 320,
      behavior: 'smooth',
    });
  }

  return (
    <section className={`group relative ${className}`}>
      <button
        type="button"
        onClick={() => scrollByAmount('left')}
        className="absolute left-0 top-1/2 z-10 flex h-full w-12 -translate-y-1/2 items-center justify-start bg-gradient-to-r from-[#090e1a] to-transparent pl-1 text-2xl font-black text-white opacity-0 transition-opacity group-hover:opacity-0 hover:opacity-100"
        aria-label="Scroll categories left"
      >
        ‹
      </button>
      <div ref={scrollerRef} className="scrollbar-hide overflow-x-auto">
        {children}
      </div>
      <button
        type="button"
        onClick={() => scrollByAmount('right')}
        className="absolute right-0 top-1/2 z-10 flex h-full w-12 -translate-y-1/2 items-center justify-end bg-gradient-to-l from-[#090e1a] to-transparent pr-1 text-2xl font-black text-white opacity-0 transition-opacity group-hover:opacity-0 hover:opacity-100"
        aria-label="Scroll categories right"
      >
        ›
      </button>
    </section>
  );
}
