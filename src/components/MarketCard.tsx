'use client';

import Link from 'next/link';
import type { Market } from '@/lib/markets';
import { Countdown } from './Countdown';

type MarketCardMarket = Market & {
  source?: 'onchain';
  closeDate?: string;
};

export function MarketCard({ market }: { market: MarketCardMarket }) {
  const yes = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
  const no = market.outcomes.find((o) => o.label === 'NO') ?? market.outcomes[1] ?? yes;
  const yesOdds = yes.odds;
  const isClosingSoon = market.status === 'Closing soon';
  const isLive = market.status === 'Open' || isClosingSoon;
  const isResolved = market.status === 'Resolved';
  const isAgentMarket = market.createdByType === 'agent';
  const isEurc = market.collateral === 'EURC';

  return (
    <Link
      href={`/markets/${market.id}`}
      className="group flex flex-col rounded-[14px] border border-white/[0.06] bg-[#131a27] p-4 transition-all hover:border-white/[0.1] hover:bg-[#161e2e]"
    >
      {/* Header: icon + title */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#0d1a24]">
          {market.imageURI ? (
            <img src={market.imageURI} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs font-black text-[#64748b]">{market.category.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {isAgentMarket ? (
              <span className="rounded-full border border-cyan/25 bg-cyan/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-cyan">
                Agent
              </span>
            ) : null}
            <h3 className="line-clamp-2 text-[13.5px] font-bold leading-snug tracking-tight text-white">
              {market.title}
            </h3>
          </div>
          {isAgentMarket && market.agentName ? (
            <p className="mt-1 truncate text-[10px] font-bold text-[#6b7c90]">{market.agentName}</p>
          ) : null}
        </div>
      </div>

      {/* Odds row: probability + Yes/No buy buttons */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[22px] font-black leading-none text-white">{yesOdds}%</span>
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

        {/* Yes / No action buttons */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="rounded-[8px] bg-[#0a3320] px-3 py-2 text-xs font-bold text-[#4ade80] transition-colors hover:bg-[#0d4429] active:scale-95"
          >
            Buy Yes
          </button>
          <button
            type="button"
            className="rounded-[8px] bg-[#2d1010] px-3 py-2 text-xs font-bold text-[#f87171] transition-colors hover:bg-[#3d1515] active:scale-95"
          >
            Buy No
          </button>
        </div>
      </div>

      {/* Footer: volume + collateral + liquidity */}
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.04] pt-3">
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
