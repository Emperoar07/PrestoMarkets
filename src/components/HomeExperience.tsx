'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Trophy, Calendar, Clock, Sparkles } from 'lucide-react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { MarketCard } from './MarketCard';
import { useAppState } from '@/lib/appState';

const mockWorldCupFixtures = [
  { teamA: 'Argentina', teamB: 'France', date: 'Today, 20:00 UTC', flagA: '🇦🇷', flagB: '🇫🇷', group: 'Group D • Match 1' },
  { teamA: 'Brazil', teamB: 'Croatia', date: 'Tomorrow, 18:00 UTC', flagA: '🇧🇷', flagB: '🇭🇷', group: 'Group G • Match 2' },
  { teamA: 'England', teamB: 'Senegal', date: 'Friday, 15:00 UTC', flagA: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', flagB: '🇸🇳', group: 'Group B • Match 3' }
];

const upcomingWeeklyFixtures = [
  { teamA: 'Germany', teamB: 'Spain', date: 'June 14, 18:00 UTC', flagA: '🇩🇪', flagB: '🇪🇸', group: 'Group E • Match 4' },
  { teamA: 'Portugal', teamB: 'Uruguay', date: 'June 15, 20:00 UTC', flagA: '🇵🇹', flagB: '🇺🇾', group: 'Group H • Match 5' },
  { teamA: 'Belgium', teamB: 'Morocco', date: 'June 16, 14:00 UTC', flagA: '🇧🇪', flagB: '🇲🇦', group: 'Group F • Match 6' }
];

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
  const [activeTab, setActiveTab] = useState<'worldcup' | 'all'>('worldcup');
  const featuredMarkets = markets.slice(0, 3);

  const hasInactiveMarket = featuredMarkets.some(
    (m) => m.status === 'Resolved' || m.status === 'Closed' || m.status === 'Canceled'
  );

  const worldCupFixtures = featuredMarkets.map((market, index) => {
    const mock = mockWorldCupFixtures[index % mockWorldCupFixtures.length];
    
    let teamA = mock.teamA;
    let teamB = mock.teamB;
    let flagA = mock.flagA;
    let flagB = mock.flagB;
    
    if (market.title.toLowerCase().includes('vs')) {
      const parts = market.title.split(/vs/i);
      if (parts.length === 2) {
        teamA = parts[0].replace(/will|would|beat/gi, '').trim();
        teamB = parts[1].replace(/\?|to win|in regulation|win/gi, '').trim();
        flagA = '⚽';
        flagB = '⚽';
      }
    }
    
    const yesOutcome = market.outcomes.find(o => o.label === 'YES') ?? market.outcomes[0];
    const noOutcome = market.outcomes.find(o => o.label === 'NO') ?? market.outcomes[1];
    
    return {
      id: market.id,
      market,
      teamA,
      teamB,
      flagA,
      flagB,
      date: market.closeLabel ? `Closes in ${market.closeLabel}` : mock.date,
      group: mock.group,
      yesOutcome,
      noOutcome,
      volume: market.volume,
      liquidity: market.liquidity,
      status: market.status,
    };
  });

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
          {!hasInactiveMarket ? (
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.06] pb-4">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-cyan" />
                <h2 className="text-[22px] font-extrabold tracking-tight text-white">Featured tournaments & markets</h2>
              </div>
              <div className="inline-flex rounded-lg bg-[#070e17] p-0.5 border border-white/[0.04] shrink-0">
                <button
                  onClick={() => setActiveTab('worldcup')}
                  className={`rounded-md px-4 py-1.5 text-[12px] font-bold transition-all ${
                    activeTab === 'worldcup'
                      ? 'bg-cyan text-[#090e1a]'
                      : 'text-[#94a3b8] hover:text-[#f1f5f9]'
                  }`}
                >
                  🏆 FIFA World Cup
                </button>
                <button
                  onClick={() => setActiveTab('all')}
                  className={`rounded-md px-4 py-1.5 text-[12px] font-bold transition-all ${
                    activeTab === 'all'
                      ? 'bg-cyan text-[#090e1a]'
                      : 'text-[#94a3b8] hover:text-[#f1f5f9]'
                  }`}
                >
                  🔮 All Featured
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[24px] font-extrabold tracking-tight text-white">Featured markets</h2>
              <Link href="/markets" className="flex items-center gap-2 text-[13px] font-bold text-cyan">
                View all <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}

          {activeTab === 'worldcup' && !hasInactiveMarket ? (
            <div className="space-y-8">
              <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#0c1524] via-[#090e1a] to-[#0a1f1d] p-6 md:p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-cyan/5 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
                
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 pb-6 border-b border-white/[0.06]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-400">
                        <Sparkles className="h-3 w-3 animate-pulse" /> Agent Orchestrated
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-cyan/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-cyan">
                        Live Match Center
                      </span>
                    </div>
                    <h3 className="text-2xl font-black text-white tracking-tight">FIFA World Cup Fixtures</h3>
                    <p className="text-[13px] text-[#94a3b8] mt-1">
                      Predict match outcomes with stablecoin positions. Fixtures resolve exactly 1 hour after the official match whistle.
                    </p>
                  </div>
                  <Link
                    href="/markets?cat=Sports"
                    className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-white/[0.04] border border-white/10 hover:border-white/20 px-4 py-2.5 text-[12px] font-bold text-white transition-all"
                  >
                    Explore Sports <ArrowRight className="h-4 w-4 text-cyan" />
                  </Link>
                </div>

                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3 relative z-10">
                  {worldCupFixtures.map((fixture) => (
                    <div
                      key={fixture.id}
                      className="group flex flex-col rounded-xl border border-white/[0.06] bg-[#0d1626]/40 p-5 hover:border-cyan/35 transition-all duration-300 hover:shadow-[0_0_20px_rgba(6,182,212,0.06)]"
                    >
                      <div className="mb-4 flex items-center justify-between text-[11px] font-bold text-[#64748b]">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-cyan" /> {fixture.date}
                        </span>
                        <span className="rounded-full bg-white/[0.03] px-2 py-0.5 border border-white/[0.02] text-[10px]">
                          {fixture.group}
                        </span>
                      </div>

                      <div className="flex items-center justify-between py-3">
                        <div className="flex flex-col items-center flex-1 text-center">
                          <span className="text-3xl mb-1 filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] select-none">
                            {fixture.flagA}
                          </span>
                          <span className="text-[13px] font-extrabold text-[#f1f5f9] tracking-tight truncate max-w-[90px] uppercase">
                            {fixture.teamA}
                          </span>
                        </div>

                        <div className="px-2 shrink-0">
                          <span className="inline-flex items-center justify-center h-6 w-9 rounded-md border border-white/[0.08] bg-[#070e17] text-[10px] font-black text-cyan shadow-sm">
                            VS
                          </span>
                        </div>

                        <div className="flex flex-col items-center flex-1 text-center">
                          <span className="text-3xl mb-1 filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] select-none">
                            {fixture.flagB}
                          </span>
                          <span className="text-[13px] font-extrabold text-[#f1f5f9] tracking-tight truncate max-w-[90px] uppercase">
                            {fixture.teamB}
                          </span>
                        </div>
                      </div>

                      <div className="my-3 text-center border-y border-white/[0.04] py-1">
                        <span className="inline-flex items-center gap-1 text-[9.5px] font-bold text-[#64748b] uppercase tracking-wider">
                          <Clock className="h-3 w-3" /> Resolves 1h post-match
                        </span>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Link
                          href={`/markets/${fixture.id}?buy=${encodeURIComponent(fixture.yesOutcome?.label ?? 'YES')}`}
                          className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#070e17]/80 hover:bg-cyan/[0.03] hover:border-cyan/40 px-3 py-2.5 text-left transition-all"
                        >
                          <span className="text-[11px] font-black text-emerald-400 uppercase tracking-tight truncate max-w-[55px]">
                            {fixture.yesOutcome?.label ?? 'YES'}
                          </span>
                          <span className="text-[12px] font-extrabold text-white">
                            {fixture.yesOutcome?.odds ?? 50}%
                          </span>
                        </Link>
                        
                        <Link
                          href={`/markets/${fixture.id}?buy=${encodeURIComponent(fixture.noOutcome?.label ?? 'NO')}`}
                          className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#070e17]/80 hover:bg-rose-500/[0.03] hover:border-rose-500/40 px-3 py-2.5 text-left transition-all"
                        >
                          <span className="text-[11px] font-black text-rose-400 uppercase tracking-tight truncate max-w-[55px]">
                            {fixture.noOutcome?.label ?? 'NO'}
                          </span>
                          <span className="text-[12px] font-extrabold text-white">
                            {fixture.noOutcome?.odds ?? 50}%
                          </span>
                        </Link>
                      </div>

                      <div className="mt-4 flex items-center justify-between text-[10px] font-semibold text-[#475569] border-t border-white/[0.04] pt-2">
                        <span>{fixture.volume} Vol.</span>
                        <span>{fixture.liquidity} Liq.</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-8 pt-6 border-t border-white/[0.06] relative z-10">
                  <h4 className="text-[13px] font-black text-white uppercase tracking-wider mb-4 flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-cyan" /> Upcoming Weekly Fixtures
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {upcomingWeeklyFixtures.map((up, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-xl border border-white/[0.04] bg-white/[0.01] p-3 text-[12px]"
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <span className="text-xl filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)] select-none">
                            {up.flagA}
                          </span>
                          <span className="font-extrabold text-[#f1f5f9] tracking-tight truncate max-w-[70px] uppercase">
                            {up.teamA}
                          </span>
                          <span className="text-[10px] font-black text-[#64748b]">VS</span>
                          <span className="text-xl filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.2)] select-none">
                            {up.flagB}
                          </span>
                          <span className="font-extrabold text-[#f1f5f9] tracking-tight truncate max-w-[70px] uppercase">
                            {up.teamB}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 pl-2 shrink-0">
                          <span className="text-[10px] font-bold text-[#64748b]">
                            {up.date.split(',')[0]}
                          </span>
                          <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-black text-cyan uppercase tracking-wider">
                            Scheduled
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-3">
              {featuredMarkets.map((market) => (
                <MarketCard key={market.id} market={market} />
              ))}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
