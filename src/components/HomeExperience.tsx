'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { MarketCard } from './MarketCard';
import { useAppState } from '@/lib/appState';

const pillars = [
  {
    title: 'Prediction markets',
    copy: 'Forecast objective outcomes with USDC-backed YES and NO positions.',
  },
  {
    title: 'Opinion markets',
    copy: 'Turn sentiment, taste, community conviction, and poll choices into visible market signals.',
  },
];

export function HomeExperience() {
  const { markets } = useAppState();
  const featuredMarkets = markets.slice(0, 3);
  return (
    <>
      <SiteHeader />
      <main className="overflow-hidden">
        <section className="relative flex min-h-screen items-center pb-20 pt-[120px]">
          <div className="relative z-10 mx-auto w-full max-w-[1400px] px-4 text-center md:px-7">
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
              A fast prediction market on Arc testnet. Create public markets, trade stablecoin-backed outcomes, and track transparent resolution signals.
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

          </div>
        </section>

        <section className="mx-auto max-w-[1400px] px-4 py-20 md:px-7">
          <div className="mb-2 text-[clamp(24px,3.5vw,38px)] font-extrabold tracking-tight text-white">Prediction markets with the Presto feel.</div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {pillars.map((pillar) => (
              <div key={pillar.title} className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6 transition-transform hover:-translate-y-1">
                <h2 className="text-[17px] font-extrabold tracking-tight text-[#f1f5f9]">{pillar.title}</h2>
                <p className="mt-3 text-[14px] leading-[1.7] text-[#94a3b8]">{pillar.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[1400px] px-4 py-6 md:px-7">
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
      </main>
      <SiteFooter />
    </>
  );
}
