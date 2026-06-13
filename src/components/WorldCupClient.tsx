'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { QuickBuyModal } from './QuickBuyModal';
import { useAppState, type AppMarket } from '@/lib/appState';
import { detectCountryFlagUrl } from '@/lib/marketSubjectImage';
import { getOutcomeColor } from '@/lib/outcomeColors';

const LIVE_WINDOW_MS = 2.6 * 60 * 60 * 1000;

type Fixture = { market: AppMarket; home: string; away: string; kickoffMs: number };

function parseTeams(title: string): { home: string; away: string } | null {
  const beat = /^will\s+(.+?)\s+beat\s+(.+?)\??$/i.exec(title.trim());
  if (beat) return { home: beat[1], away: beat[2] };
  const vs = /^(.+?)\s+vs\.?\s+(.+?)$/i.exec(title.replace(/^who will win:?\s*/i, '').replace(/\?$/, '').trim());
  if (vs) return { home: vs[1], away: vs[2] };
  return null;
}

function TeamFlag({ team, size = 'h-5 w-7' }: { team: string; size?: string }) {
  const url = detectCountryFlagUrl(team);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`${size} shrink-0 rounded-[4px] object-cover ring-1 ring-white/10`} />;
  }
  return <span className={`${size} flex shrink-0 items-center justify-center rounded-[4px] bg-white/[0.06] text-[10px]`}>⚽</span>;
}

function isWorldCupMarket(market: AppMarket): boolean {
  return /world\s*cup/i.test(`${market.title} ${market.categories?.join(' ') ?? ''}`);
}

function formatKickoffCountdown(kickoffMs: number, nowMs: number): string {
  const diff = kickoffMs - nowMs;
  if (diff <= 0) return '0s';
  const seconds = Math.floor((diff / 1000) % 60);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(' ');
}

export function WorldCupClient() {
  const { markets } = useAppState();
  const [now, setNow] = useState(() => Date.now());
  const [quickBuy, setQuickBuy] = useState<{ market: AppMarket; outcome: string } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fixtures = useMemo<Fixture[]>(() => (
    markets
      .filter((market) => market.kickoffTime && isWorldCupMarket(market)
        && market.status !== 'Canceled' && market.status !== 'Resolved')
      .map((market) => {
        const kickoffMs = new Date(market.kickoffTime as string).getTime();
        const teams = parseTeams(market.title);
        return teams && Number.isFinite(kickoffMs) ? { market, kickoffMs, ...teams } : null;
      })
      .filter((f): f is Fixture => f !== null)
      .filter((f) => now < f.kickoffMs + LIVE_WINDOW_MS)
      .sort((a, b) => a.kickoffMs - b.kickoffMs)
  ), [markets, now]);

  // Tournament-level (non-fixture) World Cup markets: winner, props, milestones.
  const propMarkets = useMemo(() => (
    markets.filter((market) => isWorldCupMarket(market) && !market.kickoffTime
      && market.status !== 'Canceled' && market.status !== 'Resolved').slice(0, 8)
  ), [markets]);

  const groups = useMemo(() => {
    const byDay = new Map<string, Fixture[]>();
    for (const fixture of fixtures) {
      const label = new Date(fixture.kickoffMs).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' });
      byDay.set(label, [...(byDay.get(label) ?? []), fixture]);
    }
    return Array.from(byDay.entries());
  }, [fixtures]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1100px] px-4 pb-16 pt-28 md:px-7 md:pt-28">

        {/* ── Hero (No Wrapper, Elegant Flat Pitch & Trophy SVG) ── */}
        <section className="relative overflow-visible pb-12 border-b border-white/[0.06]">
          {/* Humane World Cup Graphics: SVG background illustration */}
          <div className="absolute right-0 top-0 -z-10 w-full md:w-[600px] h-[260px] pointer-events-none opacity-85 select-none" aria-hidden>
            <svg viewBox="0 0 600 300" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <style>{`
                @keyframes trophyGlow {
                  0%, 100% { opacity: 0.22; transform: scale(1); }
                  50% { opacity: 0.38; transform: scale(1.06); }
                }
                @keyframes pitchFade {
                  0%, 100% { opacity: 0.25; }
                  50% { opacity: 0.45; }
                }
                @keyframes traverseDash {
                  to { stroke-dashoffset: -40; }
                }
                @keyframes starSparkle {
                  0%, 100% { opacity: 0.15; transform: scale(0.6) rotate(0deg); }
                  50% { opacity: 0.9; transform: scale(1.15) rotate(180deg); }
                }
                .animate-trophy-glow {
                  animation: trophyGlow 5s ease-in-out infinite;
                  transform-origin: 390px 120px;
                }
                .animate-pitch-lines {
                  animation: pitchFade 6s ease-in-out infinite;
                }
                .animate-dash-flow {
                  stroke-dasharray: 8 4;
                  animation: traverseDash 3s linear infinite;
                }
                .animate-star-1 {
                  animation: starSparkle 4.5s ease-in-out infinite;
                  transform-origin: center;
                }
                .animate-star-2 {
                  animation: starSparkle 5.5s ease-in-out infinite 1.8s;
                  transform-origin: center;
                }
                .animate-star-3 {
                  animation: starSparkle 3.8s ease-in-out infinite 0.8s;
                  transform-origin: center;
                }
              `}</style>
              <defs>
                <radialGradient id="goldGlow" cx="65%" cy="40%" r="50%">
                  <stop offset="0%" stopColor="#d97706" stopOpacity="0.25" />
                  <stop offset="60%" stopColor="#d97706" stopOpacity="0.05" />
                  <stop offset="100%" stopColor="transparent" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="mintGlow" cx="35%" cy="65%" r="45%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="transparent" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.8" />
                  <stop offset="50%" stopColor="#d97706" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#b45309" stopOpacity="0.6" />
                </linearGradient>
                <linearGradient id="pitchLines" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#059669" stopOpacity="0.05" />
                </linearGradient>
              </defs>

              {/* Ambient glows */}
              <circle cx="390" cy="120" r="150" fill="url(#goldGlow)" className="animate-trophy-glow" />
              <circle cx="210" cy="180" r="130" fill="url(#mintGlow)" />

              {/* Pitch outline in perspective */}
              <path d="M 50,260 L 550,260 L 450,130 L 150,130 Z" stroke="url(#pitchLines)" strokeWidth="1.5" strokeDasharray="3 3" fill="none" className="animate-pitch-lines" />
              <line x1="300" y1="260" x2="300" y2="130" stroke="url(#pitchLines)" strokeWidth="1.5" strokeDasharray="3 3" className="animate-pitch-lines" />
              <ellipse cx="300" cy="195" rx="50" ry="18" stroke="url(#pitchLines)" strokeWidth="1.5" strokeDasharray="3 3" fill="none" className="animate-pitch-lines" />
              <path d="M 220,130 L 230,165 L 370,165 L 380,130" stroke="url(#pitchLines)" strokeWidth="1.5" strokeDasharray="3 3" fill="none" className="animate-pitch-lines" />
              <path d="M 120,260 L 160,210 L 440,210 L 480,260" stroke="url(#pitchLines)" strokeWidth="1.5" strokeDasharray="3 3" fill="none" className="animate-pitch-lines" />

              {/* Artistic flowing curves representing the stadium / energy */}
              <path d="M 10,240 C 150,270 450,270 590,240" stroke="#f1f5f9" strokeOpacity="0.08" strokeWidth="2" fill="none" />
              <path d="M 10,220 C 150,250 450,250 590,220" stroke="#f1f5f9" strokeOpacity="0.04" strokeWidth="1.5" fill="none" />
              <path d="M 30,100 C 180,50 420,50 570,100" stroke="#fbbf24" strokeOpacity="0.12" strokeWidth="2" className="animate-dash-flow" fill="none" />
              <path d="M 60,70 C 200,35 400,35 540,70" stroke="#10b981" strokeOpacity="0.06" strokeWidth="1.5" fill="none" />

              {/* Star group highlights */}
              <g transform="translate(220, 80)" className="animate-star-1">
                <path d="M 0,-4 L 1.2,-1.2 L 4,-1.2 L 2,0.8 L 2.8,3.6 L 0,2 L -2.8,3.6 L -2,0.8 L -4,-1.2 L -1.2,-1.2 Z" fill="#fbbf24" />
              </g>
              <g transform="translate(480, 140)" className="animate-star-2">
                <path d="M 0,-4 L 1.2,-1.2 L 4,-1.2 L 2,0.8 L 2.8,3.6 L 0,2 L -2.8,3.6 L -2,0.8 L -4,-1.2 L -1.2,-1.2 Z" fill="#fbbf24" />
              </g>
              <g transform="translate(320, 40)" className="animate-star-3">
                <path d="M 0,-3 L 0.9,-0.9 L 3,-0.9 L 1.5,0.6 L 2.1,2.7 L 0,1.5 L -2.1,2.7 L -1.5,0.6 L -3,-0.9 L -0.9,-0.9 Z" fill="#fbbf24" />
              </g>

              {/* Stylized vector representation of the World Cup Trophy */}
              <g transform="translate(375, 50) scale(0.85)" className="opacity-90">
                {/* Base of the trophy */}
                <path d="M 20,130 L 60,130 L 55,145 L 25,145 Z" fill="url(#goldGrad)" />
                <path d="M 15,145 L 65,145 L 62,152 L 18,152 Z" fill="url(#goldGrad)" opacity="0.8" />
                <rect x="23" y="115" width="34" height="15" rx="2" fill="#141e30" stroke="url(#goldGrad)" strokeWidth="1.5" />
                <line x1="30" y1="122" x2="50" y2="122" stroke="#fbbf24" strokeWidth="1" opacity="0.6" />
                
                {/* Stem & abstract figures holding the globe */}
                <path d="M 27,115 C 27,95 35,80 30,60 C 35,65 45,65 50,60 C 45,80 53,95 53,115 Z" fill="url(#goldGrad)" />
                <path d="M 33,60 C 33,52 37,45 40,45 C 43,45 47,52 47,60 Z" fill="url(#goldGrad)" />
                
                {/* Wings / upward spirals */}
                <path d="M 20,95 C 10,80 15,55 30,60 C 23,55 18,70 24,85 Z" fill="url(#goldGrad)" opacity="0.75" />
                <path d="M 60,95 C 70,80 65,55 50,60 C 57,55 62,70 56,85 Z" fill="url(#goldGrad)" opacity="0.75" />

                {/* The Globe at the top */}
                <circle cx="40" cy="30" r="18" fill="url(#goldGrad)" />
                {/* Globe lines/details */}
                <path d="M 24,24 C 30,30 30,40 24,46" stroke="#78350f" strokeWidth="1" fill="none" opacity="0.5" />
                <path d="M 56,24 C 50,30 50,40 56,46" stroke="#78350f" strokeWidth="1" fill="none" opacity="0.5" />
                <path d="M 22,30 L 58,30" stroke="#78350f" strokeWidth="1" fill="none" opacity="0.5" />
                <path d="M 40,12 A 18,18 0 0 0 40,48" stroke="#78350f" strokeWidth="1" fill="none" opacity="0.5" />
              </g>
            </svg>
          </div>

          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">
              <Trophy className="h-3.5 w-3.5" /> FIFA World Cup 2026
            </span>
            <h1 className="mt-4 text-[clamp(40px,7vw,72px)] font-black leading-none tracking-tight text-white">World Cup</h1>
            <p className="mt-4 max-w-[500px] text-sm font-bold text-[#8fa0b4] leading-relaxed">
              Live prediction pools on Arc. Every fixture gets its own agent-created 3-way prediction market backed by USDC.
            </p>
          </div>
        </section>

        {/* ── Games (No Wrapper Flat Row Layout) ── */}
        <section className="mt-8">
          <div className="flex items-center justify-between border-b border-white/[0.04] pb-3">
            <h2 className="text-lg font-black text-white">Games</h2>
            <span className="text-[11px] font-bold text-[#64748b]">{fixtures.length} upcoming &amp; live</span>
          </div>

          {groups.length === 0 ? (
            <div className="mt-6 border border-dashed border-white/[0.08] rounded-xl bg-white/[0.01] px-8 py-16 text-center text-sm text-muted">
              No upcoming fixtures right now — the agent opens each match&apos;s market up to a week before kickoff.
            </div>
          ) : groups.map(([day, dayFixtures]) => (
            <div key={day} className="mt-8">
              <p className="text-xs font-black uppercase tracking-widest text-[#64748b]">{day}</p>
              <div className="mt-2 divide-y divide-white/[0.04]">
                {dayFixtures.map(({ market, home, away, kickoffMs }) => {
                  const isLive = now >= kickoffMs && now < kickoffMs + LIVE_WINDOW_MS;
                  const isLocked = now >= kickoffMs - 60_000;
                  const homeOutcome = market.outcomes[0];
                  const drawOutcome = market.outcomes.find((outcome) => /^draw$/i.test(outcome.label));
                  const awayOutcome = market.outcomes.find((outcome, index) => index > 0 && outcome.label !== drawOutcome?.label) ?? market.outcomes[2] ?? market.outcomes[1];
                  const yes = homeOutcome;
                  const no = awayOutcome;
                  return (
                    <div key={market.id} className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-5 transition-all duration-300 hover:translate-x-1.5 hover:bg-white/[0.01] px-1">
                      
                      {/* Left side: Time & Vol info */}
                      <div className="flex items-center md:flex-col items-start gap-3 md:gap-1 min-w-[100px] shrink-0">
                        <span className="text-sm font-black text-white">
                          {new Date(kickoffMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </span>
                        <span className="text-xs font-bold text-[#475569]">
                          {market.volume} Vol.
                        </span>
                      </div>

                      {/* Middle: Teams vs Matchup & starts in Live countdown */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <TeamFlag team={home} />
                            <span className="truncate text-base font-extrabold text-white">{home}</span>
                          </div>
                          <span className="text-xs font-black text-[#475569] shrink-0">vs</span>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <TeamFlag team={away} />
                            <span className="truncate text-base font-extrabold text-white">{away}</span>
                          </div>
                        </div>
                        {now < kickoffMs && (
                          <div className="mt-2 flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                              Starts in {formatKickoffCountdown(kickoffMs, now)}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Right side: Action pills / status */}
                      {isLive ? (
                        <Link href={`/markets/${market.id}`} className="flex shrink-0 items-center gap-1.5 self-start rounded-full border border-red-400/30 bg-red-400/10 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-red-300 md:self-auto">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                          </span>
                          Live — view match
                        </Link>
                      ) : isLocked ? (
                        <span className="shrink-0 self-start rounded-full border border-yellow-400/25 bg-yellow-400/10 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-yellow-200 md:self-auto">
                          Locked
                        </span>
                      ) : (
                        <div className="flex shrink-0 items-center gap-2 self-start md:self-auto">
                          <button
                            type="button"
                            onClick={() => setQuickBuy({ market, outcome: yes?.label ?? 'YES' })}
                            className="rounded-full border border-mint/20 bg-mint/5 px-3.5 py-1.5 text-[11px] font-black text-mint transition-colors hover:bg-mint/15 active:scale-95"
                          >
                            {home.split(' ')[0].toUpperCase().slice(0, 3)} {yes ? `${yes.odds}%` : ''}
                          </button>
                          {drawOutcome ? (
                            <button
                              type="button"
                              onClick={() => setQuickBuy({ market, outcome: drawOutcome.label })}
                              className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[11px] font-black text-[#9fb0c8] transition-colors hover:bg-white/[0.08] hover:text-white active:scale-95"
                            >
                              DRAW {drawOutcome.odds}%
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setQuickBuy({ market, outcome: no?.label ?? 'NO' })}
                            className="rounded-full border border-red-400/20 bg-red-400/5 px-3.5 py-1.5 text-[11px] font-black text-red-300 transition-colors hover:bg-red-400/15 active:scale-95"
                          >
                            {away.split(' ')[0].toUpperCase().slice(0, 3)} {no ? `${no.odds}%` : ''}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {/* ── Tournament markets (No Wrapper Flat Row Layout) ── */}
        {propMarkets.length > 0 ? (
          <section className="mt-12">
            <div className="flex items-center justify-between border-b border-white/[0.04] pb-3">
              <h2 className="text-lg font-black text-white">Tournament markets</h2>
            </div>
            
            <div className="mt-3 divide-y divide-white/[0.04]">
              {propMarkets.map((market) => {
                const yes = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
                const awayOutcome = market.outcomes.find((o, index) => index > 0 && o.label !== 'DRAW') ?? market.outcomes[1];
                const no = awayOutcome;
                const isLive = market.status === 'Open' || market.status === 'Closing soon';
                
                return (
                  <div key={market.id} className="flex flex-col md:flex-row md:items-center justify-between gap-4 py-5 transition-all duration-300 hover:translate-x-1.5 hover:bg-white/[0.01] px-1">
                    
                    {/* Left Column: Title, Category & Vol */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-cyan">{market.category}</span>
                        <span className="text-[10px] font-bold text-[#475569]">{market.volume} Vol.</span>
                      </div>
                      <Link href={`/markets/${market.id}`} className="mt-1.5 block text-[15px] font-black leading-snug text-white hover:text-cyan transition-colors">
                        {market.title}
                      </Link>
                    </div>

                    {/* Right Column: Predictive options */}
                    {market.outcomes.length <= 2 ? (
                      <div className="flex items-center gap-2 shrink-0 self-start md:self-auto">
                        <button
                          type="button"
                          disabled={!isLive}
                          onClick={() => setQuickBuy({ market, outcome: 'YES' })}
                          className="rounded-full border border-mint/20 bg-mint/5 px-3.5 py-1.5 text-[11px] font-black text-mint transition-colors hover:bg-mint/15 active:scale-95 disabled:opacity-40"
                        >
                          YES {yes ? `${yes.odds}%` : ''}
                        </button>
                        <button
                          type="button"
                          disabled={!isLive}
                          onClick={() => setQuickBuy({ market, outcome: 'NO' })}
                          className="rounded-full border border-red-400/20 bg-red-400/5 px-3.5 py-1.5 text-[11px] font-black text-red-300 transition-colors hover:bg-red-400/15 active:scale-95 disabled:opacity-40"
                        >
                          NO {no ? `${no.odds}%` : ''}
                        </button>
                      </div>
                    ) : (
                      /* Multi-outcome: show top 3 outcomes horizontally with percentages, plus a "Predict" link */
                      <div className="flex items-center gap-3 shrink-0 flex-wrap self-start md:self-auto">
                        <div className="flex items-center gap-2.5">
                          {market.outcomes.slice(0, 3).map((outcome, idx) => {
                            const color = getOutcomeColor(idx);
                            return (
                              <span key={outcome.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.02] border border-white/[0.04] px-2.5 py-1 text-[11px] font-bold text-white/80">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                                <span className="truncate max-w-[80px]">{outcome.label}</span>
                                <span className="font-extrabold text-[#9fb0c8]">{outcome.odds}%</span>
                              </span>
                            );
                          })}
                        </div>
                        <Link href={`/markets/${market.id}`} className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[11px] font-black text-white hover:bg-white/[0.08] active:scale-95 transition-all">
                          Predict
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />

      {quickBuy ? (
        <QuickBuyModal market={quickBuy.market} initialOutcome={quickBuy.outcome} onClose={() => setQuickBuy(null)} />
      ) : null}
    </>
  );
}
