import Link from 'next/link';
import type { Market } from '@/lib/markets';

type MarketCardMarket = Market & {
  source?: 'onchain';
};

const typeStyle: Record<Market['type'], string> = {
  Prediction: 'border-cyan/30 bg-cyan/10 text-cyan',
  Opinion: 'border-mint/25 bg-mint/10 text-mint',
  Opportunity: 'border-blue-300/25 bg-blue-300/10 text-blue-200',
};

const statusStyle: Record<Market['status'], string> = {
  Open: 'text-mint',
  'Closing soon': 'text-yellow-200',
  Resolved: 'text-cyan',
  Canceled: 'text-red-200',
  Draft: 'text-muted',
};

export function MarketCard({ market }: { market: MarketCardMarket }) {
  const yesOutcome = market.outcomes.find((outcome) => outcome.label === 'YES') ?? market.outcomes[0];
  const noOutcome = market.outcomes.find((outcome) => outcome.label === 'NO') ?? market.outcomes[1] ?? yesOutcome;
  const isDirectional = market.title.toLowerCase().includes('up or down');

  return (
    <Link
      href={`/markets/${market.id}`}
      className="group flex min-h-[224px] flex-col rounded-[18px] border border-white/[0.06] bg-[#192126] p-4 transition-all hover:-translate-y-1 hover:border-cyan/35 hover:bg-[#1d2830]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-cyan/10">
            {market.imageURI ? (
              <img src={market.imageURI} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xl font-black text-cyan">{market.type.slice(0, 1)}</span>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-[16px] font-black leading-snug tracking-tight text-white">{market.title}</h3>
            <p className="mt-2 text-xs font-bold text-[#8fa0b4]">{market.type} · {market.chain}</p>
          </div>
        </div>
        {isDirectional ? (
          <div className="text-right">
            <p className="text-2xl font-black text-white">{yesOutcome.odds}%</p>
            <p className="text-xs font-bold text-[#8fa0b4]">Up</p>
          </div>
        ) : null}
      </div>

      <div className="mt-6 grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-black text-white">{isDirectional ? 'Up' : yesOutcome.label}</span>
          <span className="text-lg font-black text-white">{yesOutcome.odds}%</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-sm font-black text-white">{isDirectional ? 'Down' : noOutcome.label}</span>
          <span className="text-lg font-black text-white">{noOutcome.odds}%</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <span className="rounded-[9px] bg-[#1d4938] px-4 py-3 text-center text-sm font-black text-mint">
          {isDirectional ? 'Up' : 'Yes'}
        </span>
        <span className="rounded-[9px] bg-[#462328] px-4 py-3 text-center text-sm font-black text-red-300">
          {isDirectional ? 'Down' : 'No'}
        </span>
      </div>

      <div className="mt-auto flex items-center justify-between pt-4">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${market.status === 'Open' || market.status === 'Closing soon' ? 'bg-red-400' : 'bg-cyan'}`} />
          <span className={`text-xs font-black ${statusStyle[market.status]}`}>{market.status === 'Open' ? 'LIVE' : market.status}</span>
          <span className="text-xs font-bold text-[#8fa0b4]">{market.volume} Vol.</span>
        </div>
        <span className="text-xs font-bold text-[#8fa0b4]">{market.liquidity} Liq.</span>
      </div>
    </Link>
  );
}
