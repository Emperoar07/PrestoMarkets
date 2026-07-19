'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import type { AppMarket } from '@/lib/appState';
import { isWorldCupActive } from '@/lib/worldCup';

// How long after kickoff a fixture counts as "in play" for panel display (regulation + ET buffer).
const LIVE_WINDOW_MS = 2.6 * 60 * 60 * 1000;
const MAX_FIXTURES = 9;

type Fixture = {
  market: AppMarket;
  home: string;
  away: string;
  kickoffMs: number;
};

function parseTeams(title: string): { home: string; away: string } | null {
  const beat = /^will\s+(.+?)\s+beat\s+(.+?)\??$/i.exec(title.trim());
  if (beat) return { home: beat[1], away: beat[2] };
  const vs = /^(.+?)\s+vs\.?\s+(.+?)$/i.exec(title.replace(/^who will win:?\s*/i, '').replace(/\?$/, '').trim());
  if (vs) return { home: vs[1], away: vs[2] };
  return null;
}

function dayLabel(kickoffMs: number, now: number): string {
  const day = new Date(kickoffMs); const today = new Date(now);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(day) - startOf(today)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function WorldCupFixturesPanel({ markets, onQuickBuy }: {
  markets: AppMarket[];
  onQuickBuy: (market: AppMarket, outcome: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const fixtures = useMemo<Fixture[]>(() => {
    return markets
      .filter((market) =>
        market.kickoffTime
        && /world\s*cup/i.test(`${market.title} ${market.categories?.join(' ') ?? ''}`)
        && market.status !== 'Canceled' && market.status !== 'Resolved')
      .map((market) => {
        const kickoffMs = new Date(market.kickoffTime as string).getTime();
        const teams = parseTeams(market.title);
        return teams && Number.isFinite(kickoffMs) ? { market, kickoffMs, ...teams } : null;
      })
      .filter((f): f is Fixture => f !== null)
      // Keep upcoming + in-play; drop fixtures long finished.
      .filter((f) => now < f.kickoffMs + LIVE_WINDOW_MS)
      .sort((a, b) => a.kickoffMs - b.kickoffMs)
      .slice(0, MAX_FIXTURES);
  }, [markets, now]);

  // Self-hides when no live fixtures remain; the retirement gate also drops it the moment the
  // tournament window ends, even if a stale unresolved fixture lingers.
  if (fixtures.length === 0 || !isWorldCupActive()) return null;

  let lastDay = '';

  return (
    <div className="sm:col-span-2 lg:col-span-2 xl:col-span-2 h-[156px] flex flex-col justify-between overflow-hidden rounded-[10px] border border-white/[0.06] bg-[#0c121d]/90 hover:border-cyan/20 hover:bg-[#101929]/95 backdrop-blur-md transition-all duration-300 shadow-lg shadow-black/10">
      {/* Header ribbon */}
      <div className="flex items-center justify-between gap-2.5 border-b border-white/[0.06] bg-white/[0.01] px-3.5 py-1.5 shrink-0">
        <Link href="/world-cup" className="flex min-w-0 items-center gap-2 transition-opacity hover:opacity-85">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-[#141e30] border border-cyan/15">
            <svg viewBox="10 10 60 145" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-auto">
              <defs>
                <linearGradient id="goldGradPanel" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#fbbf24" />
                  <stop offset="50%" stopColor="#d97706" />
                  <stop offset="100%" stopColor="#b45309" />
                </linearGradient>
              </defs>
              {/* Base of the trophy */}
              <path d="M 20,130 L 60,130 L 55,145 L 25,145 Z" fill="url(#goldGradPanel)" />
              <path d="M 15,145 L 65,145 L 62,152 L 18,152 Z" fill="url(#goldGradPanel)" opacity="0.8" />
              <rect x="23" y="115" width="34" height="15" rx="2" fill="#0c121d" stroke="url(#goldGradPanel)" strokeWidth="1.5" />
              
              {/* Stem & abstract figures holding the globe */}
              <path d="M 27,115 C 27,95 35,80 30,60 C 35,65 45,65 50,60 C 45,80 53,95 53,115 Z" fill="url(#goldGradPanel)" />
              <path d="M 33,60 C 33,52 37,45 40,45 C 43,45 47,52 47,60 Z" fill="url(#goldGradPanel)" />
              
              {/* Wings / spirals */}
              <path d="M 20,95 C 10,80 15,55 30,60 C 23,55 18,70 24,85 Z" fill="url(#goldGradPanel)" opacity="0.75" />
              <path d="M 60,95 C 70,80 65,55 50,60 C 57,55 62,70 56,85 Z" fill="url(#goldGradPanel)" opacity="0.75" />

              {/* The Globe at the top */}
              <circle cx="40" cy="30" r="18" fill="url(#goldGradPanel)" />
              <path d="M 24,24 C 30,30 30,40 24,46" stroke="#78350f" strokeWidth="1" fill="none" opacity="0.5" />
              <path d="M 56,24 C 50,30 50,40 56,46" stroke="#78350f" strokeWidth="1" fill="none" opacity="0.5" />
              <path d="M 22,30 L 58,30" stroke="#78350f" strokeWidth="1" fill="none" opacity="0.5" />
              <path d="M 40,12 A 18,18 0 0 0 40,48" stroke="#78350f" strokeWidth="1" fill="none" opacity="0.5" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-black text-white">FIFA World Cup 2026</p>
            <p className="text-[9px] font-black uppercase tracking-[0.12em] text-cyan/70">Fixtures</p>
          </div>
        </Link>
        <Link
          href="/world-cup"
          className="shrink-0 rounded-full border border-cyan/25 bg-cyan/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-cyan transition-colors hover:bg-cyan/20"
        >
          View all
        </Link>
      </div>

      {/* Fixture rows */}
      <div className="scrollbar-hide flex-1 divide-y divide-white/[0.04] overflow-y-auto">
        {fixtures.map((fixture) => {
          const { market, home, away, kickoffMs } = fixture;
          const isLive = now >= kickoffMs && now < kickoffMs + LIVE_WINDOW_MS;
          const isLocked = now >= kickoffMs - 60_000;
          const day = dayLabel(kickoffMs, now);
          const showDay = day !== lastDay;
          lastDay = day;
          const yes = market.outcomes[0];
          const no = market.outcomes[1];

          return (
            <div key={market.id}>
              {showDay ? (
                <p className="bg-white/[0.015] px-3.5 py-[1px] text-[8px] font-black uppercase tracking-[0.15em] text-[#5b7290]">{day}</p>
              ) : null}
              <div className="flex items-center gap-3 px-3.5 py-1.5 transition-colors hover:bg-white/[0.02]">
                <Link href={`/markets/${market.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-extrabold text-white">
                    {home} <span className="font-bold text-[#516179]">vs</span> {away}
                  </p>
                  <p className="mt-0.5 text-[9.5px] font-bold text-[#64748b]">
                    {isLive ? 'In play' : isLocked ? 'Locked — kickoff imminent' : (
                      <>
                        {new Date(kickoffMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        <span className="text-[#3f5067]"> · in {countdown(kickoffMs - now)}</span>
                      </>
                    )}
                  </p>
                </Link>

                {isLive ? (
                  <Link
                    href={`/markets/${market.id}`}
                    className="flex shrink-0 items-center gap-1 rounded-full border border-red-400/30 bg-red-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-300"
                  >
                    <span className="relative flex h-1.2 w-1.2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex h-1.2 w-1.2 rounded-full bg-red-500" />
                    </span>
                    Live
                  </Link>
                ) : isLocked ? (
                  <span className="shrink-0 rounded-full border border-yellow-400/25 bg-yellow-400/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-yellow-200">
                    Locked
                  </span>
                ) : (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onQuickBuy(market, yes?.label ?? 'YES')}
                      className="rounded-full border border-mint/20 bg-mint/5 px-2.5 py-0.5 text-[10px] font-black text-mint transition-colors hover:bg-mint/15 active:scale-95"
                    >
                      {home.split(' ')[0]} {yes ? `${yes.odds}¢` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => onQuickBuy(market, no?.label ?? 'NO')}
                      className="rounded-full border border-red-400/20 bg-red-400/5 px-2.5 py-0.5 text-[10px] font-black text-red-300 transition-colors hover:bg-red-400/15 active:scale-95"
                    >
                      {no ? `${no.odds}¢` : 'NO'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
