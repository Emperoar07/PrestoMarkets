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

  return (
    <Link
      href={`/markets/${market.id}`}
      className="block rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6 transition-all hover:-translate-y-1 hover:border-cyan/35"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.18em] ${typeStyle[market.type]}`}>
            {market.type}
          </span>
          {market.source === 'onchain' ? (
            <span className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-mint">
              Onchain
            </span>
          ) : null}
        </span>
        <span className={`text-sm font-semibold ${statusStyle[market.status]}`}>{market.status}</span>
      </div>
      <h3 className="mt-5 text-[17px] font-extrabold leading-snug tracking-tight text-white">{market.title}</h3>
      <p className="mt-3 min-h-12 text-[14px] leading-[1.7] text-muted">{market.description}</p>
      <div className="mt-6 grid grid-cols-3 overflow-hidden rounded-[14px] border border-white/[0.06] bg-[#0f172a]">
        <div className="p-4">
          <p className="text-xs text-muted">Yes</p>
          <p className="mt-1 text-2xl font-black text-cyan">{yesOutcome.odds}%</p>
        </div>
        <div className="border-x border-white/[0.06] p-4">
          <p className="text-xs text-muted">Volume</p>
          <p className="mt-1 font-black text-white">{market.volume}</p>
        </div>
        <div className="p-4">
          <p className="text-xs text-muted">Liquidity</p>
          <p className="mt-1 font-black text-white">{market.liquidity}</p>
        </div>
      </div>
    </Link>
  );
}
