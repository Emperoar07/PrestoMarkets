'use client';

import { memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { Market } from '@/lib/markets';
import { getOutcomeColor } from '@/lib/outcomeColors';
import { Countdown } from './Countdown';

type MarketCardMarket = Market & {
  source?: 'onchain';
  closeDate?: string;
};

function MarketCardComponent({ market }: { market: MarketCardMarket }) {
  const yes = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
  const no = market.outcomes.find((o) => o.label === 'NO') ?? market.outcomes[1] ?? yes;
  const yesOdds = yes.odds;
  const isClosingSoon = market.status === 'Closing soon';
  const isLive = market.status === 'Open' || isClosingSoon;
  const isResolved = market.status === 'Resolved';
  const isEurc = market.collateral === 'EURC';

  return (
    <Link
      href={`/markets/${market.id}`}
      className="group flex flex-col rounded-[16px] border border-white/[0.06] bg-[#131a27] p-5 sm:p-6 transition-all hover:border-white/[0.1] hover:bg-[#161e2e]"
    >
      {/* Header: icon + title */}
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#0d1a24]">
          {market.imageURI ? (
            <Image src={market.imageURI} alt={market.title} width={40} height={40} className="h-full w-full object-cover" priority={false} loading="lazy" onError={(e) => { e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect fill=%22%230d1a24%22 width=%2240%22 height=%2240%22/%3E%3C/svg%3E'; }} />
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
            <h3 className="line-clamp-2 text-[14px] font-bold leading-snug tracking-tight text-white mt-0.5">
              {market.title}
            </h3>
          </div>
        </div>
      </div>

      {market.pollOptions && market.pollOptions.length > 2 ? (
        <div className="mt-5 grid gap-2.5">
          {market.pollOptions.slice(0, 4).map((option, index) => {
            const color = getOutcomeColor(index);
            return (
              <div
                key={`${option}-${index}`}
                className="flex items-center justify-between rounded-[10px] border px-3.5 py-2"
                style={{ borderColor: `${color}1F`, backgroundColor: `${color}0A` }}
              >
                <span className="flex min-w-0 items-center gap-2 text-[12px] font-bold text-[#cbd5e1]">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="truncate">{option}</span>
                </span>
                <span className="ml-3 shrink-0 text-[12px] font-black" style={{ color }}>{market.outcomes[index]?.odds ?? 0}%</span>
              </div>
            );
          })}
          {market.pollOptions.length > 4 ? (
            <p className="text-[10px] font-bold text-[#64748b]">+{market.pollOptions.length - 4} more options</p>
          ) : null}
        </div>
      ) : null}

      {/* Odds row: probability + buy actions */}
      <div className="mt-6 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {market.pollOptions && market.pollOptions.length > 2 ? (
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-wider text-cyan">poll market</span>
              {isLive ? (
                <span className={`flex items-center gap-1 text-[10px] font-bold ${isClosingSoon ? 'text-amber-300' : 'text-[#8fa0b4]'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isClosingSoon ? 'bg-amber-300 animate-pulse' : 'bg-red-400'}`} />
                  {market.closeDate ? <Countdown closeDate={market.closeDate} /> : 'LIVE'}
                </span>
              ) : (
                <span className="text-[10px] font-bold text-[#8fa0b4]">{isResolved ? 'Resolved' : market.closeLabel}</span>
              )}
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* YES / NO or View Poll action buttons */}
        {market.pollOptions && market.pollOptions.length > 2 ? (
          <button
            type="button"
            className="rounded-[8px] bg-cyan/10 px-4 py-2.5 text-sm font-bold text-cyan transition-all duration-200 hover:bg-cyan/15 group-hover:bg-cyan group-hover:text-ink active:scale-95"
          >
            {isLive ? 'Bet Now' : isResolved ? 'Resolved' : 'Closed'}
          </button>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className={`rounded-[8px] px-4 py-2.5 text-sm font-bold transition-all duration-200 ${
                isLive
                  ? 'bg-[#0a3320] text-[#4ade80] hover:bg-[#0d4429] active:scale-95'
                  : 'bg-white/[0.04] text-[#64748b]'
              }`}
            >
              {isLive ? 'Buy Yes' : isResolved ? 'Resolved' : 'Closed'}
            </button>
            {isLive ? (
              <button
                type="button"
                className="rounded-[8px] bg-[#2d1010] px-4 py-2.5 text-sm font-bold text-[#f87171] transition-all duration-200 hover:bg-[#3d1515] active:scale-95"
              >
                Buy No
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* Footer: volume + collateral + liquidity */}
      <div className="mt-5 flex items-center justify-between border-t border-white/[0.04] pt-5">
        <span className="text-xs text-[#4a5568]">{market.volume} Vol.</span>
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
