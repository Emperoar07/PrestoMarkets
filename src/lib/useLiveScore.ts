'use client';

import { useEffect, useRef, useState } from 'react';

export type LiveScoreState = {
  /** Kicked off and not yet finished (an actual in-play match). */
  isLive: boolean;
  finished: boolean;
  homeScore: string | null;
  awayScore: string | null;
  /** Match clock, e.g. "34'" or "HT", when the provider reports one. */
  clock: string | null;
  status: string | null;
};

const FINISHED_RE = /finished|full.?time|\bft\b|\baet\b|\bpen\b/i;
const LIVE_WORD_RE = /live|half|1st|2nd|in[- ]?play|\d+'/i;
// Only the card-level watcher polls inside this window after kickoff. A fixture whose market is
// still open days after the game ended must not keep pinging the live endpoint.
const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000;
const POLL_MS = 45_000;

/**
 * Lightweight live-score watcher for sports-fixture cards. Reuses the keyless `/api/sports/live`
 * endpoint (ESPN-backed). Fetches only once a match has kicked off, the market is still open, and
 * we're inside the ~4h live window — then polls until full time. Returns null until data arrives.
 */
export function useLiveScore(opts: {
  homeTeam?: string;
  awayTeam?: string;
  kickoffTime?: string;
  trendUrl?: string;
  status?: string;
  enabled?: boolean;
}): LiveScoreState | null {
  const { homeTeam, awayTeam, kickoffTime, trendUrl, status, enabled = true } = opts;
  const [data, setData] = useState<LiveScoreState | null>(null);

  const idEvent = trendUrl?.match(/event\/(\d+)/)?.[1] ?? null;
  const kickoffMs = kickoffTime ? new Date(kickoffTime).getTime() : null;
  const isOpen = status === 'Open' || status === 'Closing soon';

  // Keep the latest names in a ref so the effect deps stay primitive/stable.
  const teamsRef = useRef({ homeTeam, awayTeam });
  teamsRef.current = { homeTeam, awayTeam };

  useEffect(() => {
    if (!enabled || !isOpen || kickoffMs === null) return;
    const haveTeams = Boolean(teamsRef.current.homeTeam && teamsRef.current.awayTeam);
    if (!idEvent && !haveTeams) return;
    const now = Date.now();
    if (now < kickoffMs || now > kickoffMs + LIVE_WINDOW_MS) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function fetchScore() {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const { homeTeam: home, awayTeam: away } = teamsRef.current;
      const params = new URLSearchParams();
      if (idEvent) params.set('id', idEvent);
      if (home) params.set('home', home);
      if (away) params.set('away', away);
      params.set('date', new Date(kickoffMs!).toISOString().slice(0, 10).replace(/-/g, ''));
      try {
        const res = await fetch(`/api/sports/live?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const d = await res.json();
        const text = `${d?.status ?? ''} ${d?.progress ?? ''}`;
        const finished = FINISHED_RE.test(text);
        const hasScore = d?.homeScore != null && d?.awayScore != null;
        const isLive = !finished && (hasScore || LIVE_WORD_RE.test(text));
        setData({
          isLive,
          finished,
          homeScore: d?.homeScore ?? null,
          awayScore: d?.awayScore ?? null,
          clock: d?.time ?? null,
          status: d?.status ?? null,
        });
        if (finished && interval) clearInterval(interval);
      } catch {
        /* best-effort; the card just falls back to the countdown */
      }
    }

    void fetchScore();
    interval = setInterval(fetchScore, POLL_MS);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [enabled, isOpen, idEvent, kickoffMs]);

  return data;
}
