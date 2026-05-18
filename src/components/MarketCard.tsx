'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Market } from '@/lib/markets';

type MarketCardMarket = Market & {
  source?: 'onchain';
  closeDate?: string;
};

const typeColor: Record<Market['type'], string> = {
  Prediction: 'text-cyan',
  Opinion: 'text-mint',
  Opportunity: 'text-blue-300',
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Closing';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
}

function ClosingCountdown({ closeDate }: { closeDate: string }) {
  const [label, setLabel] = useState(() => formatCountdown(new Date(closeDate).getTime() - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setLabel(formatCountdown(new Date(closeDate).getTime() - Date.now())), 1000);
    return () => clearInterval(id);
  }, [closeDate]);
  return <>{label}</>;
}

export function MarketCard({ market }: { market: MarketCardMarket }) {
  const yes = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
  const no = market.outcomes.find((o) => o.label === 'NO') ?? market.outcomes[1] ?? yes;
  const yesOdds = yes.odds;
  const noOdds = no.odds;
  const isClosingSoon = market.status === 'Closing soon';
  const isLive = market.status === 'Open' || isClosingSoon;
  const isResolved = market.status === 'Resolved';

  return (
    <Link
      href={`/markets/${market.id}`}
      className="group flex flex-col rounded-[16px] border border-white/[0.06] bg-[#192126] p-5 transition-all hover:-translate-y-[2px] hover:border-cyan/30 hover:bg-[#1c2830] hover:shadow-lg hover:shadow-black/30"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-[#0f1e28]">
          {market.imageURI ? (
            <img src={market.imageURI} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className={`text-base font-black ${typeColor[market.type]}`}>{market.type.slice(0, 1)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-black uppercase tracking-wider ${typeColor[market.type]}`}>{market.type}</span>
            {isLive ? <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> : null}
          </div>
          <h3 className="mt-1 line-clamp-2 text-[14px] font-black leading-snug tracking-tight text-white">
            {market.title}
          </h3>
        </div>
      </div>

      {/* Odds bar */}
      <div className="mt-4">
        <div className="flex overflow-hidden rounded-full" style={{ height: 6 }}>
          <div className="bg-cyan transition-all" style={{ width: `${yesOdds}%` }} />
          <div className="flex-1 bg-red-500/50" />
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="rounded-[5px] bg-cyan/10 px-2 py-0.5 text-xs font-black text-cyan">Yes</span>
            <span className="text-sm font-black text-white">{yesOdds}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-black text-white">{noOdds}%</span>
            <span className="rounded-[5px] bg-red-400/10 px-2 py-0.5 text-xs font-black text-red-300">No</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between border-t border-white/[0.05] pt-3.5">
        <div className="flex items-center gap-3 text-xs font-bold text-[#8fa0b4]">
          <span>{market.volume} Vol.</span>
          <span className="text-white/20">·</span>
          <span>{market.liquidity} Liq.</span>
        </div>
        <span className={`text-xs font-black ${isClosingSoon ? 'text-yellow-300' : isResolved ? 'text-cyan' : 'text-[#8fa0b4]'}`}>
          {isClosingSoon && market.closeDate
            ? <ClosingCountdown closeDate={market.closeDate} />
            : market.status === 'Open' ? 'LIVE'
            : market.closeLabel}
        </span>
      </div>
    </Link>
  );
}
