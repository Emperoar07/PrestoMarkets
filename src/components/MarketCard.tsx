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

function MarketCardComponent({
  market,
  onQuickBuy,
}: {
  market: MarketCardMarket;
  onQuickBuy?: (market: MarketCardMarket, outcome: string) => void;
}) {
  const { refreshAccountPortfolio } = useAppState();
  const yes = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
  const yesOdds = yes?.odds ?? 50;
  const isClosingSoon = market.status === 'Closing soon';
  const isLive = market.status === 'Open' || isClosingSoon;
  const isResolved = market.status === 'Resolved';
  const isPollMarket = Boolean(market.pollOptions && market.pollOptions.length > 2);
  const isOpinion = market.type === 'Opinion';

  return (
    <Link
      href={`/markets/${market.id}`}
      onMouseEnter={() => prefetchMarketDetail(market.id, refreshAccountPortfolio)}
      className="group flex h-[142px] min-w-0 items-stretch gap-2.5 overflow-hidden rounded-[10px] border border-white/[0.05] bg-[#0c121d] p-2.5 transition-all hover:border-white/[0.09] hover:bg-[#101929]"
    >
      {/* Left: Icon logo */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-white/[0.04] bg-[#070e17]">
        {market.imageURI ? (
          <img src={market.imageURI} alt={market.title} width={40} height={40} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[10px] font-black text-cyan/70">{market.category.slice(0, 2).toUpperCase()}</span>
        )}
      </div>

      {/* Right: Contents column */}
      <div className="flex flex-1 flex-col justify-between h-full min-w-0">
        
        {/* Title row */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {isResolved ? (
              <span className="rounded-full border border-cyan/25 bg-cyan/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-cyan shrink-0">
                {'Resolved'}
              </span>
            ) : null}
            <h3 className="line-clamp-2 text-[12.5px] font-bold leading-snug text-[#cbd5e1] transition-colors group-hover:text-white">
              {market.title}
            </h3>
          </div>
        </div>

        {/* Outcomes layout */}
        {isPollMarket ? (
          /* ── Multi-outcome Poll Market: scrollable list without scrollbars ── */
          <div className="scrollbar-hide my-1 max-h-[58px] space-y-0.5 overflow-y-auto pr-1">
            {market.pollOptions?.map((option, index) => {
              const color = getOutcomeColor(index);
              const odds = market.outcomes.find((_, idx) => idx === index)?.odds ?? 0;
              return (
                <div key={`${option}-${index}`} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-bold text-[#94a3b8]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="truncate">{option}</span>
                    <span className="ml-1 text-[10.5px] font-black text-[#cbd5e1]">{odds}%</span>
                  </span>
                  
                  {isLive ? (
                    <div className="flex items-center gap-1 shrink-0 bg-white/[0.02] border border-white/[0.06] rounded-[6px] p-[2px]">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onQuickBuy) {
                            onQuickBuy(market, option);
                          } else {
                            window.location.href = `/markets/${market.id}?buy=${encodeURIComponent(option)}`;
                          }
                        }}
                        className="px-2 py-0.5 text-[9px] font-black uppercase rounded bg-[#132d21] text-emerald-400 hover:bg-[#183929] hover:text-emerald-300 active:scale-95 transition-all"
                      >
                        {'YES'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onQuickBuy) {
                            onQuickBuy(market, option);
                          } else {
                            window.location.href = `/markets/${market.id}?buy=${encodeURIComponent(option)}`;
                          }
                        }}
                        className="px-2 py-0.5 text-[9px] font-black uppercase rounded bg-[#381515] text-rose-400 hover:bg-[#4c1c1c] hover:text-rose-300 active:scale-95 transition-all"
                      >
                        {'NO'}
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] font-bold text-[#475569]">{'Closed'}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Binary (YES/NO) Prediction or Opinion markets ── */
          <div className="my-1.5 flex items-center justify-between gap-2">
            <span className="text-[10.5px] font-bold text-[#94a3b8]">
              {isOpinion ? 'Support' : 'YES'} <span className="font-black text-[#cbd5e1]">{yesOdds}%</span>
            </span>

            {isLive ? (
              <div className="flex items-center gap-1 shrink-0 bg-white/[0.02] border border-white/[0.06] rounded-[6px] p-[2px]">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onQuickBuy) {
                      onQuickBuy(market, 'YES');
                    } else {
                      window.location.href = `/markets/${market.id}?buy=yes`;
                    }
                  }}
                  className="px-2 py-0.5 text-[9px] font-black uppercase rounded bg-[#132d21] text-emerald-400 hover:bg-[#183929] hover:text-emerald-300 active:scale-95 transition-all"
                >
                  {'YES'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onQuickBuy) {
                      onQuickBuy(market, 'NO');
                    } else {
                      window.location.href = `/markets/${market.id}?buy=no`;
                    }
                  }}
                  className="px-2 py-0.5 text-[9px] font-black uppercase rounded bg-[#381515] text-rose-400 hover:bg-[#4c1c1c] hover:text-rose-300 active:scale-95 transition-all"
                >
                  {'NO'}
                </button>
              </div>
            ) : (
              <span className="text-[10px] font-bold text-[#475569]">{'Closed'}</span>
            )}
          </div>
        )}

        {/* Metadata row (only volume) */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/[0.04] pt-1.5">
          <span className="text-[10px] font-semibold text-[#475569]">{market.volume} Vol.</span>
          <div className="flex items-center gap-2">
            {isLive ? (
              <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider ${isClosingSoon ? 'text-amber-400 animate-pulse' : 'text-[#475569]'}`}>
                <span className={`h-1 w-1 rounded-full ${isClosingSoon ? 'bg-amber-400 animate-pulse' : 'bg-red-500'}`} />
                {market.closeDate ? <Countdown closeDate={market.closeDate} /> : 'LIVE'}
              </span>
            ) : (
              <span className="text-[9px] font-black uppercase tracking-wider text-[#475569]">
                {isResolved ? 'Resolved' : market.closeLabel || 'Closed'}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export const MarketCard = memo(MarketCardComponent);
