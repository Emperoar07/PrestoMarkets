'use client';

import { useState } from 'react';
import { MarketCard } from './MarketCard';
import { useAppState } from '@/lib/appState';
import { marketCategories } from '@/lib/marketTemplates';

const filters = ['All', 'Prediction', 'Opinion', 'Opportunity', 'Open', 'Closing soon', 'Resolved', 'Canceled', 'Draft', 'Onchain', 'Created'];

function formatUsd(value: number) {
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }

  return `$${value.toFixed(0)}`;
}

function parseCompactUsd(value: string) {
  const normalized = value.replace('$', '').toUpperCase();

  if (normalized.endsWith('K')) {
    return Number(normalized.slice(0, -1)) * 1_000;
  }

  if (normalized.endsWith('M')) {
    return Number(normalized.slice(0, -1)) * 1_000_000;
  }

  return Number(normalized.replace(/,/g, '')) || 0;
}

export function MarketsExplorer() {
  const { markets } = useAppState();
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchValue, setSearchValue] = useState('');

  const totalVolume = markets.reduce((sum, market) => sum + parseCompactUsd(market.volume), 0);
  const totalLiquidity = markets.reduce((sum, market) => sum + parseCompactUsd(market.liquidity), 0);

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

    if (activeFilter === 'Created') {
      return market.source === 'created';
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
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Explore</p>
          <h1 className="mt-3 text-[clamp(34px,5vw,54px)] font-black tracking-tight text-white">Markets</h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-[1.7] text-muted">
            Browse public Arc markets across predictions, opinions, and opportunity discovery.
          </p>
        </div>
        <div className="w-full max-w-md">
          <label className="text-xs font-black uppercase tracking-[0.18em] text-muted">Search markets</label>
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search Arc, macro, product, opportunity..."
            className="mt-2 w-full rounded-[10px] border border-white/10 bg-[#141e30] px-4 py-3 text-white outline-none transition-colors placeholder:text-[#4b6280] focus:border-cyan/50"
          />
        </div>
      </div>

      <section className="mt-9 grid gap-4 md:grid-cols-3">
        <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
          <p className="text-sm text-muted">Market volume</p>
          <p className="mt-2 text-3xl font-black text-cyan">{formatUsd(totalVolume)}</p>
          <p className="mt-1 text-sm font-bold text-mint">USDC market activity</p>
        </div>
        <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
          <p className="text-sm text-muted">Liquidity</p>
          <p className="mt-2 text-3xl font-black text-cyan">{formatUsd(totalLiquidity)}</p>
          <p className="mt-1 text-sm font-bold text-mint">Across visible markets</p>
        </div>
        <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
          <p className="text-sm text-muted">Templates</p>
          <p className="mt-2 text-3xl font-black text-cyan">{marketCategories.length}</p>
          <p className="mt-1 text-sm font-bold text-mint">Ready creator categories</p>
        </div>
      </section>

      <section className="mt-5 flex flex-wrap gap-2">
        {filters.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setActiveFilter(filter)}
            className={`rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
              activeFilter === filter ? 'border-cyan/40 bg-cyan text-ink' : 'border-white/[0.06] bg-[#141e30] text-muted hover:border-cyan/30 hover:text-white'
            }`}
          >
            {filter}
          </button>
        ))}
      </section>

      <section className="mt-5 flex flex-wrap gap-2">
        {marketCategories.map((category) => (
          <span key={category} className="rounded-full border border-white/[0.06] bg-[#141e30] px-4 py-2 text-sm font-bold text-muted">
            {category}
          </span>
        ))}
      </section>

      {visibleMarkets.length > 0 ? (
        <div className="mt-9 grid gap-5 lg:grid-cols-3">
          {visibleMarkets.map((market) => <MarketCard key={market.id} market={market} />)}
        </div>
      ) : (
        <div className="mt-9 rounded-[16px] border border-dashed border-white/[0.08] bg-[#141e30] p-10 text-center">
          <h2 className="text-2xl font-black text-white">No markets match that view</h2>
          <p className="mt-3 text-muted">
            Try another filter or search term. Created markets will appear here as soon as you launch them.
          </p>
        </div>
      )}
    </main>
  );
}
