'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SiteHeader } from './SiteHeader';
import { MarketCard } from './MarketCard';
import { currentRails, plannedRails } from '@/lib/productRails';
import { useAppState } from '@/lib/appState';

const pillars = [
  {
    title: 'Prediction markets',
    copy: 'Forecast objective outcomes with USDC-backed YES and NO positions.',
  },
  {
    title: 'Opinion markets',
    copy: 'Turn sentiment, taste, and community conviction into visible market signals.',
  },
  {
    title: 'Opportunity markets',
    copy: 'Surface public Arc opportunities and let builders vote with capital.',
  },
];

export function HomeExperience() {
  const { markets } = useAppState();
  const featuredMarkets = markets.slice(0, 3);
  const createdCount = markets.filter((market) => market.source === 'created').length;

  return (
    <>
      <SiteHeader />
      <main className="overflow-hidden">
        <section className="relative flex min-h-screen items-center pb-20 pt-[120px]">
          <div className="relative z-10 mx-auto w-full max-w-[1140px] px-4 text-center md:px-7">
            <div className="mb-7 inline-flex items-center gap-2 rounded-[20px] border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[11.5px] font-semibold text-[#94a3b8]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
              Arc Testnet
            </div>
            <h1
              className="mb-6 font-black leading-none tracking-tight text-white"
              style={{ fontSize: 'clamp(44px,7vw,80px)', letterSpacing: '-0.045em' }}
            >
              Presto
              <span className="block presto-outline-text">Predict. Signal. Resolve.</span>
              <span className="block presto-gradient-text">Markets.</span>
            </h1>
            <p className="mx-auto mb-10 max-w-[560px] text-[16px] leading-[1.7] text-[#94a3b8]">
              A clean, fast prediction market surface built on Arc testnet. Create public markets, trade stablecoin-backed outcomes, and track transparent resolution signals.
            </p>
            <div className="mb-16 flex flex-wrap justify-center gap-3">
              <Link
                href="/markets"
                className="inline-flex items-center gap-2 rounded-[10px] bg-[#25c0f4] px-8 py-3.5 text-[14px] font-extrabold text-[#090e1a] transition-all hover:-translate-y-px hover:opacity-90"
                style={{ boxShadow: '0 8px 28px rgba(37,192,244,0.20)' }}
              >
                Launch App
              </Link>
              <Link
                href="/markets/create"
                className="inline-flex items-center rounded-[10px] border border-white/10 px-6 py-3.5 text-[14px] font-semibold text-[#94a3b8] transition-all hover:border-white/20 hover:text-[#f1f5f9]"
              >
                Create Market
              </Link>
            </div>

            <div className="mx-auto grid max-w-[600px] grid-cols-3 overflow-hidden rounded-[14px] border border-white/10 bg-[#141e30]">
              {[
                { value: markets.length.toLocaleString(), label: 'Live Markets' },
                { value: createdCount.toLocaleString(), label: 'Created Locally' },
                { value: 'USDC', label: 'First Settlement' },
              ].map((stat, index) => (
                <div key={stat.label} className={`px-4 py-4 text-center ${index < 2 ? 'border-r border-white/[0.06]' : ''}`}>
                  <div className="text-[17px] font-extrabold tracking-tight text-[#25c0f4] md:text-[20px]">{stat.value}</div>
                  <div className="mt-1 text-[10px] font-medium text-[#4b6280] md:text-[11px]">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1140px] px-4 py-20 md:px-7">
          <div className="mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#25c0f4]">What you get</div>
          <div className="mb-2 text-[clamp(24px,3.5vw,38px)] font-extrabold tracking-tight text-white">Prediction markets with the Presto feel.</div>
          <div className="mb-10 max-w-[520px] text-[14px] leading-[1.65] text-[#94a3b8]">
            The Markets app now follows the DEX visual system: compact cyan actions, quiet dark surfaces, and readable Arc-native market data.
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {pillars.map((pillar) => (
              <div key={pillar.title} className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6 transition-transform hover:-translate-y-1">
                <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-[#25c0f4]/10 text-[18px] font-black text-[#25c0f4]">
                  {pillar.title.slice(0, 1)}
                </div>
                <h2 className="text-[17px] font-extrabold tracking-tight text-[#f1f5f9]">{pillar.title}</h2>
                <p className="mt-3 text-[14px] leading-[1.7] text-[#94a3b8]">{pillar.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[1140px] px-4 py-6 md:px-7">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-[24px] font-extrabold tracking-tight text-white">Featured markets</h2>
            <Link href="/markets" className="flex items-center gap-2 text-[13px] font-bold text-cyan">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {featuredMarkets.map((market) => <MarketCard key={market.id} market={market} />)}
          </div>
        </section>

        <section className="mx-auto mb-20 mt-12 max-w-[1140px] rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6 md:px-7">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#25c0f4]">Build rails</p>
              <h2 className="mt-2 text-[24px] font-extrabold tracking-tight text-white">USDC markets first, richer rails when ready</h2>
              <p className="mt-3 max-w-3xl text-[14px] leading-[1.7] text-muted">
                Presto Markets starts with USDC and custom market contracts. Paymaster, Wallets, Bridge Kit, CCTP, and Gateway stay on the roadmap until each flow is live-tested.
              </p>
            </div>
            <Link href="/roadmap" className="flex items-center gap-2 text-[13px] font-bold text-cyan">
              View roadmap <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Current</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {currentRails.map((rail) => (
                  <span key={rail.name} className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-black text-mint">
                    {rail.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
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
