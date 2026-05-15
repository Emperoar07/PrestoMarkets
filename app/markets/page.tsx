import { SiteHeader } from '@/components/SiteHeader';
import { MarketCard } from '@/components/MarketCard';
import { markets } from '@/lib/markets';
import { marketCategories } from '@/lib/marketTemplates';

const filters = ['All', 'Predictions', 'Opinions', 'Opportunities', 'Active', 'Closing soon'];
const totalVolume = markets.reduce((sum, market) => sum + Number(market.volume.replace(/[$K]/g, '')) * 1000, 0);
const totalLiquidity = markets.reduce((sum, market) => sum + Number(market.liquidity.replace(/[$K]/g, '')) * 1000, 0);

function formatUsd(value: number) {
  return `$${(value / 1000).toFixed(1)}K`;
}

export default function MarketsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-12">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.22em] text-cyan">Explore</p>
            <h1 className="mt-3 text-4xl font-black text-white">Markets</h1>
            <p className="mt-3 max-w-2xl text-muted">
              Browse public Arc markets across predictions, opinions, and opportunity discovery.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <button key={filter} className="rounded-full border border-line bg-panel px-4 py-2 text-sm font-bold text-muted first:bg-cyan first:text-ink">
                {filter}
              </button>
            ))}
          </div>
        </div>
        <section className="mt-9 grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-line bg-panel p-6">
            <p className="text-sm text-muted">Open volume</p>
            <p className="mt-2 text-3xl font-black text-white">{formatUsd(totalVolume)}</p>
            <p className="mt-1 text-sm font-bold text-mint">USDC market activity</p>
          </div>
          <div className="rounded-3xl border border-line bg-panel p-6">
            <p className="text-sm text-muted">Liquidity</p>
            <p className="mt-2 text-3xl font-black text-white">{formatUsd(totalLiquidity)}</p>
            <p className="mt-1 text-sm font-bold text-mint">Across featured markets</p>
          </div>
          <div className="rounded-3xl border border-line bg-panel p-6">
            <p className="text-sm text-muted">Templates</p>
            <p className="mt-2 text-3xl font-black text-white">{marketCategories.length}</p>
            <p className="mt-1 text-sm font-bold text-mint">Ready creator categories</p>
          </div>
        </section>
        <section className="mt-5 flex flex-wrap gap-2">
          {marketCategories.map((category) => (
            <span key={category} className="rounded-full border border-line bg-panel px-4 py-2 text-sm font-bold text-muted">
              {category}
            </span>
          ))}
        </section>
        <div className="mt-9 grid gap-5 lg:grid-cols-3">
          {markets.map((market) => <MarketCard key={market.id} market={market} />)}
        </div>
      </main>
    </>
  );
}
