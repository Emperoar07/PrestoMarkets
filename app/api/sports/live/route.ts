import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';

// Live match data with a multi-source chain for accuracy:
//   1. TheSportsDB event lookup (always available, free key) — names, date, baseline score.
//   2. football-data.org (when FOOTBALL_DATA_API_KEY is set) — minute-accurate scores for the
//      World Cup and major competitions; cross-matched by team names + date.
//   3. API-Football / api-sports.io (when API_FOOTBALL_KEY is set) — broadest live coverage
//      incl. internationals & qualifiers; cross-matched by team names + date.
// A source that reports a live/finished score wins over a not-started baseline; later providers
// win ties. The response says which source was used. (Sofascore/Flashscore have no official API
// and scraping them is fragile + ToS-risky, so they're intentionally not used.)

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
  source: 'thesportsdb' | 'football-data' | 'api-football';
}

// A score counts as "settled-or-live" (worth preferring over a not-started baseline) when it
// carries an actual score or a live/finished status word.
function hasLiveScore(s: LiveScore | null): boolean {
  if (!s) return false;
  const status = `${s.status ?? ''} ${s.progress ?? ''}`.toLowerCase();
  return (s.homeScore != null && s.awayScore != null && !(s.homeScore === '0' && s.awayScore === '0' && /not started|ns|sched|timed/.test(status)))
    || /live|half|finished|\bft\b|\baet\b|\bpen\b|1st|2nd|in[ -]?play|\d+'/.test(status);
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

async function fetchApiFootball(base: LiveScore, signal: AbortSignal): Promise<LiveScore | null> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey || !base.homeTeam || !base.awayTeam) return null;

  const day = (base.timestamp ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const res = await fetch(
    `https://v3.football.api-sports.io/fixtures?date=${day}`,
    { headers: { 'x-apisports-key': apiKey }, next: { revalidate: 15 }, signal },
  );
  if (!res.ok) return null;
  const data = await res.json() as {
    response?: Array<{
      fixture?: { status?: { short?: string; long?: string; elapsed?: number | null } };
      teams?: { home?: { name?: string }; away?: { name?: string } };
      goals?: { home?: number | null; away?: number | null };
    }>;
  };

  const match = (data.response ?? []).find((m) =>
    teamsMatch(m.teams?.home?.name, base.homeTeam) && teamsMatch(m.teams?.away?.name, base.awayTeam));
  if (!match) return null;

  const short = match.fixture?.status?.short ?? '';
  const liveCodes = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE']);
  const longStatus = match.fixture?.status?.long
    ?? (short === 'FT' || short === 'AET' || short === 'PEN' ? 'Match Finished' : liveCodes.has(short) ? 'Live' : base.status);
  return {
    ...base,
    homeScore: match.goals?.home != null ? String(match.goals.home) : base.homeScore,
    awayScore: match.goals?.away != null ? String(match.goals.away) : base.awayScore,
    status: longStatus,
    time: typeof match.fixture?.status?.elapsed === 'number' ? `${match.fixture.status.elapsed}'` : base.time,
    source: 'api-football',
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

    // Query the keyed providers in parallel; each is best-effort and never fails the request.
    const [footballData, apiFootball] = await Promise.all([
      fetchFootballData(base, controller.signal).catch(() => null),
      fetchApiFootball(base, controller.signal).catch(() => null),
    ]);

    // Prefer a source that actually reports a live/finished score over the not-started baseline;
    // among those, later providers (richer live coverage) win. Otherwise the baseline stands.
    const result = [apiFootball, footballData].find(hasLiveScore)
      ?? (hasLiveScore(base) ? base : (apiFootball ?? footballData ?? base));

    return NextResponse.json(result);
  } catch (err) {
    console.error('[api] sports/live failed:', err);
    return NextResponse.json({ error: 'Live score lookup failed.' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
