import Link from 'next/link';
import type { Market } from '@/lib/markets';

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

export function MarketCard({ market }: { market: Market }) {
  const yesOutcome = market.outcomes.find((outcome) => outcome.label === 'YES') ?? market.outcomes[0];

  return (
    <Link
      href={`/markets/${market.id}`}
      className="block rounded-3xl border border-line bg-panel p-6 transition-transform hover:-translate-y-1 hover:border-cyan/35"
    >
      <div className="flex items-start justify-between gap-4">
        <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.18em] ${typeStyle[market.type]}`}>
          {market.type}
        </span>
        <span className={`text-sm font-semibold ${statusStyle[market.status]}`}>{market.status}</span>
      </div>
      <h3 className="mt-5 text-xl font-black leading-snug text-white">{market.title}</h3>
      <p className="mt-3 min-h-12 text-sm leading-6 text-muted">{market.description}</p>
      <div className="mt-6 grid grid-cols-3 overflow-hidden rounded-2xl border border-line">
        <div className="p-4">
          <p className="text-xs text-muted">Yes</p>
          <p className="mt-1 text-2xl font-black text-cyan">{yesOutcome.odds}%</p>
        </div>
        <div className="border-x border-line p-4">
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
