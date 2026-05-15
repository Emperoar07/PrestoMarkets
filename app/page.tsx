import Link from 'next/link';
import { ArrowRight, BrainCircuit, Sparkles, TrendingUp } from 'lucide-react';
import { SiteHeader } from '@/components/SiteHeader';
import { MarketCard } from '@/components/MarketCard';
import { markets } from '@/lib/markets';
import { currentRails, plannedRails } from '@/lib/productRails';

const pillars = [
  {
    icon: TrendingUp,
    title: 'Prediction markets',
    copy: 'Forecast objective outcomes with USDC-backed YES and NO positions.',
  },
  {
    icon: BrainCircuit,
    title: 'Opinion markets',
    copy: 'Turn sentiment, taste, and community conviction into visible market signals.',
  },
  {
    icon: Sparkles,
    title: 'Opportunity markets',
    copy: 'Surface public Arc opportunities and let builders vote with capital.',
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-16">
        <section className="mx-auto max-w-4xl text-center">
          <div className="mx-auto w-fit rounded-full border border-cyan/25 bg-cyan/10 px-4 py-2 text-sm font-bold text-cyan">
            Public Arc Testnet markets
          </div>
          <h1 className="mt-8 text-5xl font-black tracking-tight text-white md:text-7xl">
            Your opinions. Your opportunities. Your predictions.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted">
            Create and trade public markets on Arc. Forecast outcomes, surface opportunities, and turn conviction into stablecoin native market signals.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-4">
            <Link href="/markets" className="rounded-2xl bg-cyan px-6 py-4 font-black text-ink">
              Explore Markets
            </Link>
            <Link href="/markets/create" className="rounded-2xl border border-line bg-panel px-6 py-4 font-black text-white">
              Create Market
            </Link>
          </div>
        </section>

        <section className="mt-20 grid gap-5 md:grid-cols-3">
          {pillars.map((pillar) => (
            <div key={pillar.title} className="rounded-3xl border border-line bg-panel p-6">
              <pillar.icon className="h-8 w-8 text-cyan" />
              <h2 className="mt-5 text-xl font-black text-white">{pillar.title}</h2>
              <p className="mt-3 leading-7 text-muted">{pillar.copy}</p>
            </div>
          ))}
        </section>

        <section className="mt-12 rounded-3xl border border-line bg-panel p-6">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-cyan">Why Arc</p>
          <h2 className="mt-2 text-2xl font-black text-white">Built for credible stablecoin markets</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-line bg-ink p-5">
              <h3 className="font-black text-white">Predictable participation</h3>
              <p className="mt-2 text-sm leading-6 text-muted">Stablecoin gas and USDC collateral make small trades and public signals easier to reason about.</p>
            </div>
            <div className="rounded-2xl border border-line bg-ink p-5">
              <h3 className="font-black text-white">Auditable settlement</h3>
              <p className="mt-2 text-sm leading-6 text-muted">Every market needs clear rules, resolver evidence, and claimable outcomes that can be checked onchain.</p>
            </div>
            <div className="rounded-2xl border border-line bg-ink p-5">
              <h3 className="font-black text-white">Multi currency path</h3>
              <p className="mt-2 text-sm leading-6 text-muted">USDC comes first, with EURC and other stable settlement paths planned after V1 is safe.</p>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-2xl font-black text-white">Featured markets</h2>
            <Link href="/markets" className="flex items-center gap-2 font-bold text-cyan">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {markets.map((market) => <MarketCard key={market.id} market={market} />)}
          </div>
        </section>

        <section className="mt-12 rounded-3xl border border-line bg-panel p-6">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.22em] text-cyan">Build rails</p>
              <h2 className="mt-2 text-2xl font-black text-white">USDC markets first, richer rails when ready</h2>
              <p className="mt-3 max-w-3xl leading-7 text-muted">
                Presto Markets starts with USDC and custom market contracts. Paymaster, Wallets, Bridge Kit, CCTP, and Gateway stay on the roadmap until each flow is live-tested.
              </p>
            </div>
            <Link href="/roadmap" className="flex items-center gap-2 font-bold text-cyan">
              View roadmap <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-line bg-ink p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Current</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {currentRails.map((rail) => (
                  <span key={rail.name} className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-black text-mint">
                    {rail.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-ink p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Planned</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {plannedRails.map((rail) => (
                  <span key={rail.name} className="rounded-full border border-line bg-panel2 px-3 py-1 text-xs font-black text-muted">
                    {rail.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
