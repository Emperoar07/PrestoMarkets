'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { useAppState } from '@/lib/appState';
import { computePortfolioInsights } from '@/lib/portfolioInsights';

const statusStyle = {
  Open: 'border-cyan/25 bg-cyan/10 text-cyan',
  Claimable: 'border-mint/25 bg-mint/10 text-mint',
  Realized: 'border-white/10 bg-white/[0.04] text-[#dbeafe]',
  Watching: 'border-line bg-ink text-muted',
  Pending: 'border-yellow-400/25 bg-yellow-400/10 text-yellow-200',
  Confirmed: 'border-mint/25 bg-mint/10 text-mint',
  Failed: 'border-red-400/25 bg-red-400/10 text-red-200',
};

type FilterType = 'all' | 'open' | 'winning' | 'losing' | 'claimable';
type SortType = 'pnl' | 'size' | 'name' | 'date';

function parseUsd(value: string) {
  return Number(value.replace(/[$,]/g, '')) || 0;
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

function parsePnlPercent(pnl: string): number {
  const match = pnl.match(/([+-]?\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

export function PortfolioClient() {
  const { positions, connectedWallet, isLoadingAccount, markets, claimMarket } = useAppState();
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('date');
  const [claimingAll, setClaimingAll] = useState(false);

  const insights = computePortfolioInsights(positions, markets);

  async function claimAll() {
    const ids = Array.from(new Set(positions.filter((p) => p.status === 'Claimable').map((p) => p.marketId)));
    if (ids.length === 0) return;
    setClaimingAll(true);
    for (const marketId of ids) {
      try { await claimMarket(marketId); } catch { /* keep claiming the rest */ }
    }
    setClaimingAll(false);
  }

  const filteredPositions = positions.filter((position) => {
    if (filter === 'open') return position.status === 'Open';
    if (filter === 'winning') return parsePnlPercent(position.pnl) > 0;
    if (filter === 'losing') return parsePnlPercent(position.pnl) < 0;
    if (filter === 'claimable') return position.status === 'Claimable';
    return true;
  });

  const sortedPositions = [...filteredPositions].sort((a, b) => {
    if (sort === 'pnl') return parsePnlPercent(b.pnl) - parsePnlPercent(a.pnl);
    if (sort === 'size') return parseUsd(b.value) - parseUsd(a.value);
    if (sort === 'name') return a.title.localeCompare(b.title);
    return 0;
  });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-36 md:px-7 md:pt-40">
        <h1 className="text-[clamp(44px,6vw,68px)] font-black tracking-tight text-white">Portfolio</h1>

        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm text-muted">Position value</p>
            <p className="mt-2 text-3xl font-black text-white">{formatUsd(insights.totalValue)}</p>
            <p className="mt-1 text-sm font-bold text-mint">{isLoadingAccount ? 'Loading account reads' : `${positions.length} positions`}</p>
          </div>
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm text-muted">Unrealized P&L</p>
            <p className={`mt-2 text-3xl font-black ${insights.unrealizedPnl < 0 ? 'text-red-200' : 'text-mint'}`}>
              {insights.unrealizedPnl >= 0 ? '+' : ''}{formatUsd(insights.unrealizedPnl)}
            </p>
            <p className="mt-1 text-sm font-bold text-muted">Open: value − cost</p>
          </div>
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm text-muted">Realized P&L</p>
            <p className={`mt-2 text-3xl font-black ${insights.realizedPnl < 0 ? 'text-red-200' : 'text-mint'}`}>
              {insights.realizedPnl >= 0 ? '+' : ''}{formatUsd(insights.realizedPnl)}
            </p>
            <p className="mt-1 text-sm font-bold text-muted">Settled + claimable</p>
          </div>
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm text-muted">Cost basis</p>
            <p className="mt-2 text-3xl font-black text-white">{formatUsd(insights.totalCost)}</p>
            <p className="mt-1 text-sm font-bold text-muted">Total invested</p>
          </div>
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm text-muted">Claimable</p>
            <p className="mt-2 text-3xl font-black text-white">{formatUsd(insights.claimableValue)}</p>
            <p className="mt-1 text-sm font-bold text-muted">{insights.claimableCount} to claim</p>
          </div>
        </section>

        {(insights.claimableCount > 0 || insights.closingSoonCount > 0) ? (
          <section className="mt-4 flex flex-wrap gap-3">
            {insights.claimableCount > 0 ? (
              <button
                type="button"
                onClick={() => setFilter('claimable')}
                className="rounded-full border border-mint/30 bg-mint/10 px-4 py-2 text-sm font-black text-mint transition-colors hover:bg-mint/15"
              >
                ⚡ {insights.claimableCount} claimable — {formatUsd(insights.claimableValue)}
              </button>
            ) : null}
            {insights.claimableCount > 0 ? (
              <button
                type="button"
                onClick={() => void claimAll()}
                disabled={claimingAll}
                className="rounded-full bg-mint px-4 py-2 text-sm font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {claimingAll ? 'Claiming…' : `Claim all (${insights.claimableCount})`}
              </button>
            ) : null}
            {insights.closingSoonCount > 0 ? (
              <span className="rounded-full border border-yellow-400/25 bg-yellow-400/10 px-4 py-2 text-sm font-black text-yellow-200">
                ⏳ {insights.closingSoonCount} position{insights.closingSoonCount > 1 ? 's' : ''} closing soon
              </span>
            ) : null}
          </section>
        ) : null}

        {insights.exposure.length > 0 ? (
          <section className="mt-4 rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm text-muted">Exposure by category</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {insights.exposure.map((entry) => (
                <span key={entry.category} className="rounded-full border border-white/[0.08] bg-[#0d1520] px-3 py-1.5 text-sm text-white">
                  {entry.category} <span className="font-black text-cyan">{Math.round(entry.pct * 100)}%</span>
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-8 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
          <div className="border-b border-line p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <h2 className="text-xl font-black text-white">Share positions</h2>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortType)}
                className="rounded-lg border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-sm font-bold text-[#94a3b8] transition-colors hover:border-cyan/30 focus:border-cyan/50 outline-none"
              >
                <option value="date">Newest first</option>
                <option value="pnl">Best P&L first</option>
                <option value="size">Largest first</option>
                <option value="name">A to Z</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-b border-line px-6 pt-4 pb-0">
            {(['all', 'open', 'winning', 'losing', 'claimable'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition-all ${
                  filter === f
                    ? 'border-cyan/30 bg-cyan/10 text-cyan'
                    : 'border-transparent text-[#94a3b8] hover:text-white'
                }`}
              >
                {f === 'all' && 'All'}
                {f === 'open' && 'Open'}
                {f === 'winning' && 'Winning'}
                {f === 'losing' && 'Losing'}
                {f === 'claimable' && 'Claimable'}
              </button>
            ))}
          </div>

          <div className="divide-y divide-line">
            {sortedPositions.length > 0 ? sortedPositions.map((position) => (
              <Link
                key={`${position.marketId}-${position.outcome}-${position.shares}`}
                href={`/markets/${position.marketId}#trade-panel`}
                className="grid gap-4 p-6 transition-colors hover:bg-white/[0.025] md:grid-cols-[1.5fr_repeat(5,1fr)_auto] md:items-center"
              >
                <div>
                  <p className="font-black text-white">{position.title}</p>
                  <p className="mt-1 text-sm text-muted">{position.outcome} shares</p>
                  <p className="mt-2 text-xs font-black uppercase tracking-[0.16em] text-cyan">Open trade panel</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Shares</p>
                  <p className="mt-1 font-black text-white">{position.shares}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Average</p>
                  <p className="mt-1 font-black text-white">{position.averagePrice}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Current</p>
                  <p className="mt-1 font-black text-cyan">{position.currentPrice}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Value</p>
                  <p className="mt-1 font-black text-white">{position.value}</p>
                  <p className="mt-1 text-xs font-bold text-muted">{position.valuationLabel}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">P/L</p>
                  <p className={`mt-1 font-black ${position.pnl.startsWith('-') ? 'text-red-200' : 'text-mint'}`}>
                    {position.pnl}
                  </p>
                  <p className="mt-1 text-xs font-bold text-muted">{position.costBasis} cost</p>
                </div>
                <span className={`w-fit rounded-full border px-3 py-1 text-xs font-black ${statusStyle[position.status]}`}>
                  {position.status}
                </span>
              </Link>
            )) : (
              <div className="flex flex-col items-center justify-center gap-4 py-12 px-6 text-center">
                <div>
                  <p className="text-sm font-bold text-white">
                    {connectedWallet ? 'No positions yet' : 'Connect a wallet to get started'}
                  </p>
                  <p className="mt-2 text-sm text-muted leading-6">
                    {connectedWallet
                      ? 'You do not hold any shares in the live markets. Browse markets and buy shares to track your positions here.'
                      : 'Connect your wallet to view your positions and portfolio performance across all markets.'}
                  </p>
                </div>
                {connectedWallet && (
                  <Link
                    href="/markets"
                    className="mt-2 inline-block rounded-lg border border-cyan/30 bg-cyan/10 px-4 py-2 text-sm font-black text-cyan transition-colors hover:bg-cyan/15"
                  >
                    Browse Markets
                  </Link>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
