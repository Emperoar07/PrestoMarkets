'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Trophy } from 'lucide-react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { MarketCard } from './MarketCard';
import { QuickBuyModal } from './QuickBuyModal';
import { useAppState, type AppMarket } from '@/lib/appState';
import { detectCountryFlagUrl } from '@/lib/marketSubjectImage';

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

export function WorldCupClient() {
  const { markets } = useAppState();
  const [now, setNow] = useState(() => Date.now());
  const [quickBuy, setQuickBuy] = useState<{ market: AppMarket; outcome: string } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
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

  // Floating hero flags from the next fixtures' teams (deduped).
  const heroTeams = useMemo(() => {
    const seen = new Set<string>();
    const teams: Array<{ team: string; odds?: number }> = [];
    for (const fixture of fixtures) {
      for (const [team, outcome] of [[fixture.home, fixture.market.outcomes[0]], [fixture.away, fixture.market.outcomes[1]]] as const) {
        const key = team.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        teams.push({ team, odds: outcome ? Number(outcome.odds) : undefined });
        if (teams.length >= 7) return teams;
      }
    }
    return teams;
  }, [fixtures]);

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

        {/* ── Hero ── */}
        <section className="relative overflow-hidden rounded-[20px] border border-white/[0.06] bg-[radial-gradient(700px_280px_at_80%_-60px,rgba(37,192,244,0.16),transparent_60%),linear-gradient(165deg,#0c1626_0%,#0b1322_55%,#0d2030_100%)] px-6 py-10 md:px-10">
          {/* floating flag tiles */}
          <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden>
            {heroTeams.map((entry, index) => {
              const positions = [
                'right-[8%] top-6 rotate-[14deg]', 'right-[22%] top-16 -rotate-[10deg]', 'right-[34%] top-4 rotate-[6deg]',
                'right-[16%] bottom-8 -rotate-[16deg]', 'right-[40%] bottom-4 rotate-[12deg]', 'right-[4%] bottom-16 -rotate-[6deg]',
                'right-[30%] top-1/2 rotate-[20deg]',
              ];
              return (
                <div key={entry.team} className={`absolute ${positions[index % positions.length]} flex flex-col items-center gap-1 opacity-90`}>
                  <div className="rounded-[8px] shadow-lg shadow-black/40">
                    <TeamFlag team={entry.team} size="h-9 w-13 md:h-10 md:w-14" />
                  </div>
                  {Number.isFinite(entry.odds) ? (
                    <span className="text-[10px] font-black text-white/35">{entry.odds}%</span>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">
              <Trophy className="h-3.5 w-3.5" /> FIFA World Cup 2026
            </span>
            <h1 className="mt-4 text-[clamp(40px,7vw,72px)] font-black leading-none tracking-tight text-white">World Cup</h1>
            <p className="mt-3 text-sm font-bold text-[#8fa0b4]">
              Live World Cup predictions &amp; odds
              <span className="text-[#46586f]"> · Updated {new Date(now).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </p>
            <p className="mt-2 max-w-[520px] text-xs leading-5 text-[#64748b]">
              Every fixture gets its own agent-created market. Trading locks one minute before kickoff and settles about an hour after full time.
            </p>
          </div>
        </section>

        {/* ── Games ── */}
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-white">Games</h2>
            <span className="text-[11px] font-bold text-[#64748b]">{fixtures.length} upcoming &amp; live</span>
          </div>

          {groups.length === 0 ? (
            <div className="mt-4 rounded-[16px] border border-dashed border-white/[0.07] bg-[#0d1520] px-8 py-12 text-center text-sm text-muted">
              No upcoming fixtures right now — the agent opens each match&apos;s market up to a week before kickoff.
            </div>
          ) : groups.map(([day, dayFixtures]) => (
            <div key={day} className="mt-5">
              <p className="text-sm font-black text-white">{day}</p>
              <div className="mt-2 space-y-2">
                {dayFixtures.map(({ market, home, away, kickoffMs }) => {
                  const isLive = now >= kickoffMs && now < kickoffMs + LIVE_WINDOW_MS;
                  const isLocked = now >= kickoffMs - 60_000;
                  const yes = market.outcomes[0];
                  const no = market.outcomes[1];
                  return (
                    <div key={market.id} className="rounded-[14px] border border-white/[0.06] bg-[#0f1828] px-4 py-3 transition-colors hover:border-white/[0.12]">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-bold text-[#64748b]">
                          {new Date(kickoffMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                          <span className="text-[#3a4b62]"> · {market.volume} Vol.</span>
                        </span>
                        <Link href={`/markets/${market.id}`} className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] font-black text-[#9fb0c8] transition-colors hover:text-white">
                          Game View <ChevronRight className="h-3 w-3" />
                        </Link>
                      </div>
                      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex items-center gap-2.5">
                            <TeamFlag team={home} />
                            <span className="truncate text-[15px] font-extrabold text-white">{home}</span>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <TeamFlag team={away} />
                            <span className="truncate text-[15px] font-extrabold text-white">{away}</span>
                          </div>
                        </div>
                        {isLive ? (
                          <Link href={`/markets/${market.id}`} className="flex shrink-0 items-center gap-1.5 self-start rounded-full border border-red-400/30 bg-red-400/10 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-red-300 sm:self-auto">
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                            </span>
                            Live — view match
                          </Link>
                        ) : isLocked ? (
                          <span className="shrink-0 self-start rounded-full border border-yellow-400/25 bg-yellow-400/10 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-yellow-200 sm:self-auto">
                            Locked
                          </span>
                        ) : (
                          <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
                            <button
                              type="button"
                              onClick={() => setQuickBuy({ market, outcome: yes?.label ?? 'YES' })}
                              className="rounded-[10px] border border-mint/25 bg-mint/10 px-4 py-2.5 text-xs font-black text-mint transition-colors hover:bg-mint/20"
                            >
                              {home.split(' ')[0].toUpperCase().slice(0, 3)} {yes ? `${yes.odds}¢` : ''}
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuickBuy({ market, outcome: no?.label ?? 'NO' })}
                              className="rounded-[10px] border border-red-400/25 bg-red-400/10 px-4 py-2.5 text-xs font-black text-red-300 transition-colors hover:bg-red-400/20"
                            >
                              {away.split(' ')[0].toUpperCase().slice(0, 3)} {no ? `${no.odds}¢` : ''}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {/* ── Tournament markets ── */}
        {propMarkets.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-lg font-black text-white">Tournament markets</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {propMarkets.map((market) => (
                <MarketCard key={market.id} market={market} onQuickBuy={(_, outcome) => setQuickBuy({ market, outcome })} />
              ))}
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
