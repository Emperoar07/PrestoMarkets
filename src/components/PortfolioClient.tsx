'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { useAppState } from '@/lib/appState';
import { computePortfolioInsights } from '@/lib/portfolioInsights';
import { 
  Wallet, 
  TrendingUp, 
  Coins, 
  CreditCard, 
  Trophy, 
  Clock, 
  Lock, 
  Eye,
  TrendingDown
} from 'lucide-react';

const statusBadgeStyles = {
  Open: 'text-cyan bg-cyan/10 border-cyan/20',
  Claimable: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  Realized: 'text-[#cbd5e1] bg-white/[0.04] border-white/[0.06]',
  Watching: 'text-[#64748b] bg-white/[0.02] border-white/[0.04]',
};

function statusIconFor(status: string) {
  if (status === 'Open') return Clock;
  if (status === 'Claimable') return Trophy;
  if (status === 'Realized') return Lock;
  return Eye;
}

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

  const counts = useMemo(() => {
    return {
      all: positions.length,
      open: positions.filter((p) => p.status === 'Open').length,
      winning: positions.filter((p) => parsePnlPercent(p.pnl) > 0).length,
      losing: positions.filter((p) => parsePnlPercent(p.pnl) < 0).length,
      claimable: positions.filter((p) => p.status === 'Claimable').length,
    };
  }, [positions]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-5 pb-20 pt-28 md:px-6 md:pt-28">
        {/* Header Section */}
        <div className="flex flex-col gap-2">
          <h1 className="text-[clamp(28px,3.5vw,40px)] font-black tracking-tight text-white">Portfolio</h1>
          <p className="text-[15px] leading-relaxed text-[#94a3b8]">
            Manage your active positions, view performance metrics, and claim reward payouts.
          </p>
        </div>

        {/* Cockpit Stats Cards */}
        {connectedWallet && (
          <section className="mt-8 grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {/* Position Value */}
            <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-extrabold text-[#64748b] uppercase tracking-wider">Position Value</span>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                  <Wallet className="h-4.5 w-4.5" />
                </span>
              </div>
              <p className="mt-4 text-2xl font-black text-white">{formatUsd(insights.totalValue)}</p>
              <p className="mt-1.5 text-[11px] font-bold tracking-wide text-cyan">
                {isLoadingAccount ? 'Syncing...' : `${positions.length} active position${positions.length === 1 ? '' : 's'}`}
              </p>
            </div>

            {/* Unrealized P&L */}
            <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-extrabold text-[#64748b] uppercase tracking-wider">Unrealized P&L</span>
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
                  insights.unrealizedPnl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                }`}>
                  {insights.unrealizedPnl >= 0 ? (
                    <TrendingUp className="h-4.5 w-4.5" />
                  ) : (
                    <TrendingDown className="h-4.5 w-4.5" />
                  )}
                </span>
              </div>
              <p className={`mt-4 text-2xl font-black ${insights.unrealizedPnl < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {insights.unrealizedPnl >= 0 ? '+' : ''}{formatUsd(insights.unrealizedPnl)}
              </p>
              <p className="mt-1.5 text-[11px] font-bold text-[#64748b] tracking-wide">Current valuation − cost</p>
            </div>

            {/* Realized P&L */}
            <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-extrabold text-[#64748b] uppercase tracking-wider">Realized P&L</span>
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
                  insights.realizedPnl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                }`}>
                  {insights.realizedPnl >= 0 ? (
                    <TrendingUp className="h-4.5 w-4.5" />
                  ) : (
                    <TrendingDown className="h-4.5 w-4.5" />
                  )}
                </span>
              </div>
              <p className={`mt-4 text-2xl font-black ${insights.realizedPnl < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                {insights.realizedPnl >= 0 ? '+' : ''}{formatUsd(insights.realizedPnl)}
              </p>
              <p className="mt-1.5 text-[11px] font-bold text-[#64748b] tracking-wide">Settled + claimable rewards</p>
            </div>

            {/* Cost Basis */}
            <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-extrabold text-[#64748b] uppercase tracking-wider">Cost Basis</span>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                  <CreditCard className="h-4.5 w-4.5" />
                </span>
              </div>
              <p className="mt-4 text-2xl font-black text-white">{formatUsd(insights.totalCost)}</p>
              <p className="mt-1.5 text-[11px] font-bold text-[#64748b] tracking-wide">Total capital invested</p>
            </div>

            {/* Claimable */}
            <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-extrabold text-[#64748b] uppercase tracking-wider">Claimable</span>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                  <Trophy className="h-4.5 w-4.5" />
                </span>
              </div>
              <p className="mt-4 text-2xl font-black text-white">{formatUsd(insights.claimableValue)}</p>
              <p className="mt-1.5 text-[11px] font-extrabold text-emerald-400 tracking-wide uppercase">
                {insights.claimableCount} reward{insights.claimableCount === 1 ? '' : 's'} ready
              </p>
            </div>
          </section>
        )}

        {/* Claimable / Closing Alerts Banner */}
        {connectedWallet && (insights.claimableCount > 0 || insights.closingSoonCount > 0) ? (
          <div className="mt-6 flex flex-col gap-4 rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {insights.claimableCount > 0 && (
                <div className="flex items-center gap-2.5 text-[13.5px] font-bold text-emerald-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                  </span>
                  <span>{insights.claimableCount} position{insights.claimableCount === 1 ? '' : 's'} claimable ({formatUsd(insights.claimableValue)})</span>
                </div>
              )}
              {insights.closingSoonCount > 0 && (
                <div className="flex items-center gap-2.5 text-[13.5px] font-bold text-amber-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
                  </span>
                  <span>{insights.closingSoonCount} position{insights.closingSoonCount === 1 ? '' : 's'} closing soon</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {insights.claimableCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setFilter('claimable')}
                    className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3.5 py-1.5 text-xs font-bold text-[#94a3b8] transition hover:border-white/[0.12] hover:bg-white/[0.04] hover:text-white"
                  >
                    View claimable
                  </button>
                  <button
                    type="button"
                    onClick={() => void claimAll()}
                    disabled={claimingAll}
                    className="rounded-lg bg-emerald-400 px-3.5 py-1.5 text-xs font-extrabold text-[#07111f] transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {claimingAll ? 'Claiming...' : `Claim All (${insights.claimableCount})`}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {/* Filter and sorting control row */}
        {connectedWallet && (
          <div className="mt-10 flex flex-col gap-4 border-b border-white/[0.06] pb-5 md:flex-row md:items-center md:justify-between">
            {/* Filter Tabs */}
            <div className="flex flex-wrap gap-2">
              {(['all', 'open', 'winning', 'losing', 'claimable'] as const).map((f) => {
                const isActive = filter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[12.5px] font-bold transition-all duration-200 ${
                      isActive
                        ? 'bg-cyan text-[#07111f] shadow-lg shadow-cyan/10'
                        : 'text-[#94a3b8] hover:bg-white/[0.04] hover:text-[#f1f5f9]'
                    }`}
                  >
                    <span className="capitalize">{f}</span>
                    <span className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-extrabold ${
                      isActive ? 'bg-[#07111f]/20 text-[#07111f]' : 'bg-white/[0.06] text-[#64748b]'
                    }`}>
                      {counts[f]}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Sort Control */}
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-bold text-[#64748b] uppercase tracking-wide">Sort by</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortType)}
                className="rounded-lg border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-[12.5px] font-bold text-[#cbd5e1] transition-colors hover:border-cyan/30 focus:border-cyan/50 outline-none cursor-pointer"
              >
                <option value="date">Newest first</option>
                <option value="pnl">Best P&L first</option>
                <option value="size">Largest first</option>
                <option value="name">A to Z</option>
              </select>
            </div>
          </div>
        )}

        {/* Positions cards list */}
        {connectedWallet && (
          <div className="mt-6 flex flex-col gap-3.5">
            {sortedPositions.length > 0 ? (
              sortedPositions.map((position) => {
                const isLoss = position.pnl.startsWith('-');
                const StatusIcon = statusIconFor(position.status);
                
                return (
                  <Link
                    key={`${position.marketId}-${position.outcome}-${position.shares}`}
                    href={`/markets/${position.marketId}#trade-panel`}
                    className="group flex flex-col justify-between gap-4 rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02] md:flex-row md:items-center"
                  >
                    {/* Left: Metadata */}
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] font-black text-white transition-colors group-hover:text-cyan leading-snug break-words">
                        {position.title}
                      </p>
                      
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[9px] font-extrabold tracking-wide uppercase ${statusBadgeStyles[position.status]}`}>
                          <StatusIcon className="h-2.5 w-2.5" />
                          <span>{position.status}</span>
                        </span>
                        
                        <span className="text-[12px] font-bold text-[#cbd5e1]">
                          Outcome: <span className="text-white font-extrabold">{position.outcome}</span>
                        </span>
                        
                        <span className="text-[11px] text-[#64748b]">•</span>
                        
                        <span className="text-[12px] font-bold text-[#cbd5e1]">
                          Shares: <span className="text-white font-extrabold">{position.shares}</span>
                        </span>
                      </div>
                    </div>

                    {/* Right: Valuation metrics grid */}
                    <div className="grid grid-cols-2 gap-4 border-t border-white/[0.04] pt-4 sm:grid-cols-4 md:flex md:items-center md:justify-end md:gap-8 md:border-t-0 md:pt-0">
                      <div className="md:min-w-[80px]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Avg Price</p>
                        <p className="mt-1 text-[13.5px] font-extrabold text-white">{position.averagePrice}</p>
                      </div>
                      
                      <div className="md:min-w-[80px]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Current</p>
                        <p className="mt-1 text-[13.5px] font-extrabold text-cyan">{position.currentPrice}</p>
                      </div>
                      
                      <div className="md:min-w-[100px]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">Valuation</p>
                        <p className="mt-1 text-[13.5px] font-extrabold text-white">{position.value}</p>
                        <p className="text-[9.5px] font-bold text-[#64748b] uppercase tracking-wide mt-0.5">{position.valuationLabel}</p>
                      </div>
                      
                      <div className="md:min-w-[100px]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">P/L</p>
                        <p className={`mt-1 text-[13.5px] font-extrabold ${isLoss ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {position.pnl}
                        </p>
                        <p className="text-[9.5px] font-bold text-[#64748b] uppercase tracking-wide mt-0.5">{position.costBasis} cost</p>
                      </div>
                    </div>
                  </Link>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#0b1322]/80 px-6 py-14 text-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan/10 text-cyan mb-4">
                  <TrendingUp className="h-6 w-6" />
                </div>
                <h3 className="text-base font-bold text-white">No active positions</h3>
                <p className="mt-2 text-sm text-[#94a3b8] max-w-sm leading-relaxed">
                  You do not hold any shares in the live markets. Browse active markets to buy shares and track your positions.
                </p>
                <Link
                  href="/markets"
                  className="mt-5 inline-block rounded-lg bg-cyan px-4 py-2.5 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90 shadow-lg shadow-cyan/10"
                >
                  Browse Markets
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Wallet disconnect fallback */}
        {!connectedWallet && (
          <div className="mt-10 flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#0b1322]/80 px-6 py-14 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan/10 text-cyan mb-4">
              <Wallet className="h-6 w-6" />
            </div>
            <h3 className="text-base font-bold text-white">Connect wallet</h3>
            <p className="mt-2 text-sm text-[#94a3b8] max-w-sm leading-relaxed">
              Connect a wallet to view your current positions, performance statistics, and claim rewards.
            </p>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
