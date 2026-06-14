'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import type { AppMarket } from '@/lib/appState';

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

  if (fixtures.length === 0) return null;

  let lastDay = '';

  return (
    <div className="sm:col-span-2 lg:col-span-3 xl:col-span-3 h-[156px] flex flex-col justify-between overflow-hidden rounded-[10px] border border-white/[0.05] bg-[#0c121d] hover:border-white/[0.09] hover:bg-[#101929] transition-all">
      {/* Header ribbon */}
      <div className="flex items-center justify-between gap-2.5 border-b border-white/[0.04] bg-white/[0.01] px-3.5 py-1.5 shrink-0">
        <Link href="/world-cup" className="flex min-w-0 items-center gap-2 transition-opacity hover:opacity-85">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-cyan/15 text-cyan">
            <Trophy className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-black text-white">FIFA World Cup 2026</p>
            <p className="text-[9px] font-black uppercase tracking-[0.12em] text-cyan/70">Fixtures</p>
          </div>
        </Link>
        <Link
          href="/world-cup"
          className="shrink-0 rounded-full border border-cyan/25 bg-cyan/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-cyan transition-colors hover:bg-cyan/20"
        >
          View all →
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
                      className="rounded-[6px] border border-mint/25 bg-mint/10 px-2 py-0.5 text-[9.5px] font-black text-mint transition-colors hover:bg-mint/20"
                    >
                      {home.split(' ')[0]} {yes ? `${yes.odds}¢` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => onQuickBuy(market, no?.label ?? 'NO')}
                      className="rounded-[6px] border border-red-400/25 bg-red-400/10 px-2 py-0.5 text-[9.5px] font-black text-red-300 transition-colors hover:bg-red-400/20"
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
