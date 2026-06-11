import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';

// Live match data with a multi-source chain for accuracy:
//   1. TheSportsDB event lookup (always available, free key) — names, date, baseline score.
//   2. football-data.org (when FOOTBALL_DATA_API_KEY is set) — faster, minute-accurate scores
//      for the FIFA World Cup and major competitions; cross-matched by team names + date.
// The freshest authoritative source wins; the response says which one was used.

const liveScoreRateLimitStore = new Map<string, { count: number; resetAt: number }>();

type LiveScore = {
  id?: string;
  event?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeScore: string | null;
  awayScore: string | null;
  status: string | null;
  progress: string | null;
  time: string | null;
  timestamp?: string | null;
  thumbnail?: string | null;
  source: 'thesportsdb' | 'football-data';
};

function normalizeTeam(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

function teamsMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  return na.length > 2 && nb.length > 2 && (na.includes(nb) || nb.includes(na));
}

async function fetchSportsDb(id: string, signal: AbortSignal): Promise<LiveScore | null> {
  const apiKey = process.env.THESPORTSDB_API_KEY || '123';
  const res = await fetch(
    `https://www.thesportsdb.com/api/v1/json/${apiKey}/lookupevent.php?id=${id}`,
    { next: { revalidate: 15 }, signal },
  );
  if (!res.ok) return null;
  const data = await res.json() as {
    events?: Array<{
      idEvent?: string; strEvent?: string; strHomeTeam?: string; strAwayTeam?: string;
      intHomeScore?: string | null; intAwayScore?: string | null; strStatus?: string | null;
      strProgress?: string | null; strTime?: string | null; dateEvent?: string;
      strTimestamp?: string; strThumb?: string | null;
    }>;
  };
  const event = data.events?.[0];
  if (!event) return null;
  return {
    id: event.idEvent,
    event: event.strEvent,
    homeTeam: event.strHomeTeam,
    awayTeam: event.strAwayTeam,
    homeScore: event.intHomeScore ?? null,
    awayScore: event.intAwayScore ?? null,
    status: event.strStatus ?? null,
    progress: event.strProgress ?? null,
    time: event.strTime ?? null,
    timestamp: event.strTimestamp ?? null,
    thumbnail: event.strThumb ?? null,
    source: 'thesportsdb',
  };
}

async function fetchFootballData(base: LiveScore, signal: AbortSignal): Promise<LiveScore | null> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey || !base.homeTeam || !base.awayTeam) return null;

  // Query only the match's UTC date so the list stays tiny and the free tier isn't burned.
  const day = (base.timestamp ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const res = await fetch(
    `https://api.football-data.org/v4/matches?dateFrom=${day}&dateTo=${day}`,
    { headers: { 'X-Auth-Token': apiKey }, next: { revalidate: 15 }, signal },
  );
  if (!res.ok) return null;
  const data = await res.json() as {
    matches?: Array<{
      status?: string; minute?: number | null;
      homeTeam?: { name?: string; shortName?: string };
      awayTeam?: { name?: string; shortName?: string };
      score?: { fullTime?: { home?: number | null; away?: number | null } };
    }>;
  };

  const match = (data.matches ?? []).find((m) =>
    (teamsMatch(m.homeTeam?.name, base.homeTeam) || teamsMatch(m.homeTeam?.shortName, base.homeTeam))
    && (teamsMatch(m.awayTeam?.name, base.awayTeam) || teamsMatch(m.awayTeam?.shortName, base.awayTeam)));
  if (!match) return null;

  const statusMap: Record<string, string> = {
    IN_PLAY: 'Live', PAUSED: 'Half Time', FINISHED: 'Match Finished',
    TIMED: 'Not Started', SCHEDULED: 'Not Started', SUSPENDED: 'Suspended', POSTPONED: 'Postponed',
  };
  return {
    ...base,
    homeScore: match.score?.fullTime?.home != null ? String(match.score.fullTime.home) : base.homeScore,
    awayScore: match.score?.fullTime?.away != null ? String(match.score.fullTime.away) : base.awayScore,
    status: statusMap[match.status ?? ''] ?? base.status,
    time: typeof match.minute === 'number' ? `${match.minute}'` : base.time,
    source: 'football-data',
  };
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(liveScoreRateLimitStore, ip, { max: 30, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Valid sports event id is required' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const base = await fetchSportsDb(id, controller.signal);
    if (!base) {
      return NextResponse.json({ error: 'Sports event not found' }, { status: 404 });
    }

    // Secondary source wins when it found the match (it updates faster and carries the minute);
    // otherwise the baseline stands. Never fails the request — accuracy upgrade is best-effort.
    const enriched = await fetchFootballData(base, controller.signal).catch(() => null);
    const result = enriched ?? base;

    return NextResponse.json(result);
  } catch (err) {
    console.error('[api] sports/live failed:', err);
    return NextResponse.json({ error: 'Live score lookup failed.' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
