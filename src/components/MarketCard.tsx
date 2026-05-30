'use client';

import { memo } from 'react';
import Link from 'next/link';
import type { Market } from '@/lib/markets';
import { getOutcomeColor } from '@/lib/outcomeColors';
import { useAppState } from '@/lib/appState';
import { prefetchMarketDetail } from '@/lib/marketPrefetch';
import { Countdown } from './Countdown';

function generateSparklinePath(marketId: string, odds: number): string {
  const seed = marketId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const points = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * 120;
    const factor = Math.sin(seed + i * 1.5) * 12;
    const targetY = 30 - (odds / 100) * 20; // odds 0-100 -> height 10-30
    const y = targetY + factor * (1 - i / (count - 1));
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M ${points.join(' L ')}`;
}

type MarketCardMarket = Market & {
  source?: 'onchain';
  closeDate?: string;
};

function MarketCardComponent({ market }: { market: MarketCardMarket }) {
  const { refreshAccountPortfolio } = useAppState();
  const yes = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
  const no = market.outcomes.find((o) => o.label === 'NO') ?? market.outcomes[1] ?? yes;
  const yesOdds = yes.odds;
  const isClosingSoon = market.status === 'Closing soon';
  const isLive = market.status === 'Open' || isClosingSoon;
  const isResolved = market.status === 'Resolved';
  const isEurc = market.collateral === 'EURC';
  const isPollMarket = Boolean(market.pollOptions && market.pollOptions.length > 2);
  const isOpinion = market.type === 'Opinion';

  return (
    <Link
      href={`/markets/${market.id}`}
      onMouseEnter={() => prefetchMarketDetail(market.id, refreshAccountPortfolio)}
      className="group flex h-[236px] min-w-0 flex-col overflow-hidden rounded-[16px] border border-white/[0.06] bg-[#131a27] p-4 transition-all hover:border-white/[0.1] hover:bg-[#161e2e]"
    >
      <div className="flex min-h-[40px] items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#0d1a24]">
          {market.imageURI ? (
            <img src={market.imageURI} alt={market.title} width={40} height={40} loading="lazy" decoding="async" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs font-black text-[#64748b]">{market.category.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {isResolved ? (
              <span className="rounded-full border border-cyan/25 bg-cyan/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-cyan">
                Resolved
              </span>
            ) : null}
            <h3 className="mt-0.5 line-clamp-2 text-[14px] font-bold leading-snug text-white">
              {market.title}
            </h3>
          </div>
        </div>
      </div>

      {isPollMarket ? (
        <div
          className="scrollbar-hide mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1"
          aria-label="Market outcomes"
        >
          {market.pollOptions?.map((option, index) => {
            const color = getOutcomeColor(index);
            return (
              <div
                key={`${option}-${index}`}
                className="flex min-h-[36px] items-center justify-between rounded-[8px] border px-2.5 py-1.5"
                style={{ borderColor: `${color}1F`, backgroundColor: `${color}0A` }}
              >
                <span className="flex min-w-0 items-center gap-2 text-[12px] font-bold leading-tight text-[#cbd5e1]">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="truncate">{option}</span>
                </span>
                <span className="ml-3 shrink-0 text-[12px] font-black" style={{ color }}>{market.outcomes[index]?.odds ?? 0}%</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {!isPollMarket ? (
        isOpinion ? (
          /* ── Opinion Labs "VS" Split Duel Layout ── */
          <div className="mt-auto flex flex-col gap-2.5">
            {/* Symmetrical Debate Progress Bar */}
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-[#1e293b] flex">
              <div 
                style={{ width: `${yesOdds}%` }} 
                className="h-full bg-gradient-to-r from-cyan to-emerald-400 transition-all duration-500" 
              />
              <div 
                style={{ width: `${100 - yesOdds}%` }} 
                className="h-full bg-gradient-to-r from-red-500 to-rose-600 transition-all duration-500" 
              />
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[#090e1a]" />
            </div>

            <div className="flex items-center justify-between gap-1">
              {/* YES Action (Support) */}
              {isLive ? (
                <Link
                  href={`/markets/${market.id}?buy=yes`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 flex flex-col items-center rounded-lg border border-emerald-500/20 bg-emerald-500/5 py-1.5 transition-all hover:bg-emerald-500/10 hover:border-emerald-500/40 active:scale-95"
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400">Support</span>
                  <span className="text-sm font-bold text-white mt-0.5">{yesOdds}%</span>
                </Link>
              ) : (
                <div className="flex-1 flex flex-col items-center rounded-lg border border-white/[0.04] bg-white/[0.02] py-1.5">
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted">Support</span>
                  <span className="text-sm font-bold text-muted mt-0.5">{yesOdds}%</span>
                </div>
              )}

              {/* VS Glassmorphic Badge */}
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#090e1a]/90 text-[10px] font-black text-cyan shadow-lg shadow-black/20">
                VS
              </div>

              {/* NO Action (Oppose) */}
              {isLive ? (
                <Link
                  href={`/markets/${market.id}?buy=no`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 flex flex-col items-center rounded-lg border border-rose-500/20 bg-rose-500/5 py-1.5 transition-all hover:bg-rose-500/10 hover:border-rose-500/40 active:scale-95"
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-rose-400">Oppose</span>
                  <span className="text-sm font-bold text-white mt-0.5">{100 - yesOdds}%</span>
                </Link>
              ) : (
                <div className="flex-1 flex flex-col items-center rounded-lg border border-white/[0.04] bg-white/[0.02] py-1.5">
                  <span className="text-[10px] font-black uppercase tracking-wider text-muted">Oppose</span>
                  <span className="text-sm font-bold text-muted mt-0.5">{100 - yesOdds}%</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Regular Prediction Market YES/NO Capsules & Sparkline ── */
          <div className="mt-auto flex flex-col gap-2">
            {/* Sparkline Glow wave */}
            {isLive ? (
              <div className="my-1.5 flex h-7 items-center justify-between gap-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">24h trend</span>
                <svg className="h-6 w-32 overflow-visible" viewBox="0 0 120 40" onClick={(e) => e.preventDefault()}>
                  <defs>
                    <linearGradient id={`sparkline-grad-${market.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#25c0f4" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="#25c0f4" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={`${generateSparklinePath(market.id, yesOdds)} L 120,40 L 0,40 Z`}
                    fill={`url(#sparkline-grad-${market.id})`}
                  />
                  <path
                    d={generateSparklinePath(market.id, yesOdds)}
                    fill="none"
                    stroke="#25c0f4"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="drop-shadow-[0_0_2px_rgba(37,192,244,0.5)]"
                  />
                  <circle cx="120" cy={30 - (yesOdds / 100) * 20} r="2.5" fill="#25c0f4" className="animate-pulse" />
                </svg>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[24px] font-black leading-none text-white">{yesOdds}%</span>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#4ade80]">chance</span>
                  {isLive ? (
                    <span className={`flex items-center gap-1 text-[10px] font-bold ${isClosingSoon ? 'text-amber-300' : 'text-[#8fa0b4]'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${isClosingSoon ? 'bg-amber-300 animate-pulse' : 'bg-red-400'}`} />
                      {market.closeDate ? <Countdown closeDate={market.closeDate} /> : 'LIVE'}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-[#8fa0b4]">{isResolved ? 'Resolved' : market.closeLabel}</span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isLive ? (
                  <>
                    {/* Clickable YES Betting Capsule */}
                    <Link
                      href={`/markets/${market.id}?buy=yes`}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-[8px] border border-[#0e4b30] bg-[#0a3320] px-3.5 py-2 text-sm font-bold text-[#4ade80] transition-all duration-200 hover:bg-[#0d4429] hover:text-[#5aff96] hover:border-emerald-500/40 active:scale-95"
                    >
                      YES {yesOdds}%
                    </Link>
                    {/* Clickable NO Betting Capsule */}
                    <Link
                      href={`/markets/${market.id}?buy=no`}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-[8px] border border-[#441818] bg-[#2d1010] px-3.5 py-2 text-sm font-bold text-[#f87171] transition-all duration-200 hover:bg-[#3d1515] hover:text-[#ff8a8a] hover:border-rose-500/40 active:scale-95"
                    >
                      NO {100 - yesOdds}%
                    </Link>
                  </>
                ) : (
                  <span className="rounded-[8px] bg-white/[0.04] px-4 py-2.5 text-sm font-bold text-[#64748b]">
                    {isResolved ? 'Resolved' : 'Closed'}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.04] pt-3">
        <span className="text-xs text-[#4a5568]">{market.volume} Vol.</span>
        {isPollMarket ? (
          <span className="shrink-0 rounded-[8px] bg-[#0d1520] px-2 py-1 text-[10px] font-black uppercase text-[#64748b]">
            {isLive ? (market.closeDate ? <Countdown closeDate={market.closeDate} /> : 'Live') : isResolved ? 'Resolved' : market.closeLabel}
          </span>
        ) : null}
        <div className="flex items-center gap-2">
          {isEurc ? (
            <span className="rounded-full border border-blue-400/25 bg-blue-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-blue-400">
              EURC
            </span>
          ) : null}
          <span className="text-xs text-[#4a5568]">{market.liquidity} Liq.</span>
        </div>
      </div>
    </Link>
  );
}

export const MarketCard = memo(MarketCardComponent);
