import { SiteHeader } from '@/components/SiteHeader';
import { getMarket } from '@/lib/markets';

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const market = getMarket(id);
  const yesOutcome = market.outcomes.find((outcome) => outcome.label === 'YES') ?? market.outcomes[0];
  const noOutcome = market.outcomes.find((outcome) => outcome.label === 'NO') ?? market.outcomes[1] ?? yesOutcome;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <section className="rounded-3xl border border-line bg-panel p-7">
            <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-cyan">
              {market.type}
            </span>
            <h1 className="mt-5 text-4xl font-black leading-tight text-white">{market.title}</h1>
            <p className="mt-4 text-lg leading-8 text-muted">{market.description}</p>
            <div className="mt-8 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-line bg-ink p-5">
                <p className="text-sm text-muted">Volume</p>
                <p className="mt-2 text-2xl font-black text-white">{market.volume}</p>
              </div>
              <div className="rounded-2xl border border-line bg-ink p-5">
                <p className="text-sm text-muted">Liquidity</p>
                <p className="mt-2 text-2xl font-black text-white">{market.liquidity}</p>
              </div>
              <div className="rounded-2xl border border-line bg-ink p-5">
                <p className="text-sm text-muted">Close</p>
                <p className="mt-2 text-2xl font-black text-white">{market.closeLabel}</p>
              </div>
              <div className="rounded-2xl border border-line bg-ink p-5">
                <p className="text-sm text-muted">Collateral</p>
                <p className="mt-2 text-2xl font-black text-white">{market.collateral}</p>
              </div>
            </div>
            <div className="mt-8 rounded-2xl border border-line bg-ink p-6">
              <h2 className="text-xl font-black text-white">Resolution rules</h2>
              <p className="mt-3 leading-7 text-muted">
                {market.rules}
              </p>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-line bg-panel2 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Source of truth</p>
                  <p className="mt-2 text-sm leading-6 text-white">{market.sourceOfTruth}</p>
                </div>
                <div className="rounded-2xl border border-line bg-panel2 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Resolver</p>
                  <p className="mt-2 text-sm leading-6 text-white">{market.resolver}</p>
                  <p className="mt-1 text-sm text-cyan">{market.resolutionMode}</p>
                </div>
              </div>
            </div>
            <div className="mt-8 rounded-2xl border border-line bg-ink p-6">
              <h2 className="text-xl font-black text-white">Market activity</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {market.activity.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-line bg-panel2 p-4">
                    <p className="text-sm text-muted">{item.label}</p>
                    <p className="mt-1 text-2xl font-black text-white">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="rounded-3xl border border-line bg-panel p-6">
            <h2 className="text-xl font-black text-white">Trade outcome</h2>
            <div className="mt-5 grid gap-3">
              <button className="rounded-2xl border border-cyan/35 bg-cyan/10 p-5 text-left">
                <span className="text-sm font-bold text-muted">Buy YES</span>
                <span className="mt-2 block text-3xl font-black text-cyan">{yesOutcome.odds}%</span>
                <span className="mt-1 block text-sm text-muted">{yesOutcome.liquidity} liquidity</span>
              </button>
              <button className="rounded-2xl border border-line bg-ink p-5 text-left">
                <span className="text-sm font-bold text-muted">Buy NO</span>
                <span className="mt-2 block text-3xl font-black text-white">{noOutcome.odds}%</span>
                <span className="mt-1 block text-sm text-muted">{noOutcome.liquidity} liquidity</span>
              </button>
            </div>
            <div className="mt-5 rounded-2xl border border-line bg-ink p-4">
              <label className="text-sm font-bold text-muted">Amount USDC</label>
              <input className="mt-2 w-full bg-transparent text-3xl font-black text-white outline-none" placeholder="0.00" />
            </div>
            <button className="mt-5 w-full rounded-2xl bg-cyan px-6 py-4 font-black text-ink">Connect Wallet</button>
          </aside>
        </div>
      </main>
    </>
  );
}
