'use client';

import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useAppState } from '@/lib/appState';
import { ChanceMeter } from './ChanceMeter';
import { MarketSignalChart } from './MarketSignalChart';

interface NewsMarketDetailProps {
  marketId: string;
}

export function NewsMarketDetail({ marketId }: NewsMarketDetailProps) {
  const { getMarket } = useAppState();
  const market = getMarket(marketId);

  if (!market) {
    notFound();
  }

  const yesOutcome = market.outcomes.find((o) => o.label.toUpperCase() === 'YES');
  const yesPercentage = yesOutcome?.odds || 50;

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0e27] to-[#131a27] px-6 py-8">
      <div className="max-w-4xl">
        {/* Back Link */}
        <Link
          href="/breaking-news"
          className="mb-6 inline-flex items-center text-cyan-400 hover:text-cyan-300"
        >
          ← Back to Breaking News
        </Link>

        {/* Header */}
        <div className="mb-8 rounded-lg border border-white/10 bg-white/5 p-8">
          <h1 className="mb-4 text-3xl font-bold text-white">{market.title}</h1>
          <p className="mb-6 text-gray-300">{market.description}</p>

          {/* ChanceMeter */}
          <div className="mb-6 flex justify-center">
            <ChanceMeter percentage={yesPercentage} size="large" />
          </div>

          {/* Trading Grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            {market.outcomes.map((outcome) => (
              <div
                key={outcome.label}
                className={`rounded-lg border-2 py-4 font-bold ${
                  outcome.label.toUpperCase() === 'YES'
                    ? 'border-cyan-400 bg-cyan-400/10 text-cyan-300'
                    : 'border-red-400 bg-red-400/10 text-red-300'
                }`}
              >
                {outcome.label} {outcome.odds}%
              </div>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div className="mb-8">
          <h2 className="mb-4 text-xl font-bold text-white">Market Activity</h2>
          <div className="h-80 rounded-lg border border-white/10 bg-white/5 p-6">
            <MarketSignalChart market={market} />
          </div>
        </div>

        {/* Market Info */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-gray-500">Closes</p>
              <p className="mt-1 text-lg font-semibold text-white">{market.closeLabel}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Volume</p>
              <p className="mt-1 text-lg font-semibold text-white">{market.liquidity}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Category</p>
              <p className="mt-1 text-lg font-semibold text-white">{market.category}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-gray-500">Type</p>
              <p className="mt-1 text-lg font-semibold text-white">{market.type}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
