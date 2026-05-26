'use client';

import React, { useState, useMemo } from 'react';
import { useAppState } from '@/lib/appState';
import { NewsCard } from './NewsCard';
import { SkeletonCard } from './SkeletonCard';

type NewsTab = 'breaking' | 'new' | 'trending';

const CATEGORIES = ['Politics', 'Finance', 'Crypto', 'Technology', 'Sports', 'World'];

export function BreakingNewsPage() {
  const { markets, isLoadingMarkets } = useAppState();
  const [activeTab, setActiveTab] = useState<NewsTab>('breaking');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Filter for agent-created markets only
  const agentMarkets = useMemo(() => {
    return markets.filter(
      (m) =>
        m.createdByType === 'agent' &&
        m.status !== 'Resolved' &&
        m.status !== 'Canceled',
    );
  }, [markets]);

  // Apply category filter
  const filteredMarkets = useMemo(() => {
    if (selectedCategory === 'All') return agentMarkets;
    return agentMarkets.filter((m) => {
      const categories = m.categories || [];
      return categories.some((c) =>
        c.toLowerCase().includes(selectedCategory.toLowerCase()),
      );
    });
  }, [agentMarkets, selectedCategory]);

  // Helper: Calculate days until market close
  const getDaysUntilClose = (closeDate: string | undefined, now: Date): number => {
    if (!closeDate) return 999;
    const close = new Date(closeDate);
    return (close.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  };

  // Helper: Parse liquidity with K/M magnitude conversion
  const parseLiquidity = (liquidity: string): number => {
    const cleaned = liquidity?.replace(/\$/g, '') || '0';
    const value = parseFloat(cleaned.replace(/[KM]$/, ''));
    if (cleaned.endsWith('M')) return value * 1_000_000;
    if (cleaned.endsWith('K')) return value * 1_000;
    return value;
  };

  // Sort by tab
  const sortedMarkets = useMemo(() => {
    const now = new Date();
    const withScore = filteredMarkets.map((m) => {
      const daysUntilClose = getDaysUntilClose(m.closeDate, now);

      return {
        market: m,
        daysUntilClose,
      };
    });

    if (activeTab === 'breaking') {
      // Breaking: closes within 48 hours
      return withScore
        .filter((x) => x.daysUntilClose <= 2 && x.daysUntilClose > 0)
        .sort((a, b) => a.daysUntilClose - b.daysUntilClose)
        .map((x) => x.market);
    }

    if (activeTab === 'new') {
      // New: created in last 7 days
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return filteredMarkets
        .filter((m) => new Date(m.createdAt) > sevenDaysAgo)
        .sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
    }

    // Trending: highest liquidity
    return filteredMarkets.sort((a, b) => {
      const aLiq = parseLiquidity(a.liquidity);
      const bLiq = parseLiquidity(b.liquidity);
      return bLiq - aLiq;
    });
  }, [filteredMarkets, activeTab]);

  const skeletons = Array(8).fill(null);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0e27] to-[#131a27]">
      {/* Header */}
      <div className="border-b border-white/5 px-6 py-8">
        <h1 className="text-4xl font-bold text-white">Breaking News Markets</h1>
        <p className="mt-2 text-gray-400">
          Prediction markets on trending topics. No hidden sources, pure probability.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/5 px-6">
        <div className="flex gap-8">
          {(['breaking', 'new', 'trending'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`border-b-2 px-1 py-4 font-semibold transition ${
                activeTab === tab
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab === 'breaking'
                ? '⚡ Breaking'
                : tab === 'new'
                  ? '✨ New'
                  : '🔥 Trending'}
            </button>
          ))}
        </div>
      </div>

      {/* Category Filter */}
      <div className="border-b border-white/5 px-6 py-4">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {['All', ...CATEGORIES].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
                selectedCategory === cat
                  ? 'bg-cyan-400/20 text-cyan-300 ring-1 ring-cyan-400/50'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Markets Grid */}
      <div className="px-6 py-8">
        {isLoadingMarkets ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {skeletons.map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : sortedMarkets.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-gray-400">
            <p>No markets found in this category.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sortedMarkets.map((market) => {
              const yesOdds = market.outcomes.find(
                (o) => o.label.toUpperCase() === 'YES',
              );
              return (
                <NewsCard
                  key={market.id}
                  id={market.id}
                  title={market.title}
                  description={market.description}
                  imageURI={market.imageURI}
                  yesPercentage={yesOdds?.odds || 50}
                  noPercentage={100 - (yesOdds?.odds || 50)}
                  closeDate={market.closeDate || new Date().toISOString()}
                  volume={market.liquidity}
                  category={market.category}
                  type={market.type}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
