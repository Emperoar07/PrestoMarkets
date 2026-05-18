'use client';

import { useState } from 'react';
import { MarketCard } from './MarketCard';
import { useAppState } from '@/lib/appState';

const filters = ['All', 'Prediction', 'Opinion', 'Opportunity', 'Open', 'Closing soon', 'Resolved', 'Canceled', 'Onchain'];

export function MarketsExplorer() {
  const { markets } = useAppState();
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchValue, setSearchValue] = useState('');

  const visibleMarkets = markets.filter((market) => {
    const search = searchValue.trim().toLowerCase();
    const matchesSearch = search.length === 0
      || market.title.toLowerCase().includes(search)
      || market.description.toLowerCase().includes(search)
      || market.category.toLowerCase().includes(search);

    if (!matchesSearch) {
      return false;
    }

    if (activeFilter === 'All') {
      return true;
    }

    if (activeFilter === 'Onchain') {
      return market.source === 'onchain';
    }

    if (activeFilter === market.type || activeFilter === market.status) {
      return true;
    }

    return false;
  });

  return (
    <main className="mx-auto max-w-[1140px] px-4 pb-16 pt-28 md:px-7">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Explore</p>
        <h1 className="mt-3 text-[clamp(38px,6vw,64px)] font-black tracking-tight text-white">Presto Markets</h1>
        <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-[1.7] text-muted">
          Browse live Arc markets, search public signals, and trade USDC-backed outcomes with clear rules.
        </p>
      </div>

      <section className="mt-9 border-y border-white/[0.06] py-3">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1 lg:pb-0">
            {filters.map((filter, index) => (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                className={`group flex min-w-fit items-center gap-2 rounded-[12px] border px-3 py-2 text-sm font-black transition-colors ${
                  activeFilter === filter
                    ? 'border-cyan/45 bg-cyan/15 text-white'
                    : 'border-transparent text-[#8fa0b4] hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white'
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                  activeFilter === filter ? 'bg-cyan text-ink' : 'bg-[#1b252d] text-[#8fa0b4] group-hover:text-white'
                }`}>
                  {index + 1}
                </span>
                {filter}
              </button>
            ))}
          </div>
          <div className="w-full lg:max-w-[320px]">
            <input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search markets"
              className="w-full rounded-[12px] border border-white/[0.06] bg-[#11191f] px-4 py-2.5 text-sm font-bold text-white outline-none transition-colors placeholder:text-[#64748b] focus:border-cyan/50"
            />
          </div>
        </div>
      </section>

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
