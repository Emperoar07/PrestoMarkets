import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { getSportsDbApiKey } from '@/lib/sportsProvider';

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
  source: 'thesportsdb' | 'football-data' | 'api-football' | 'espn';
}

// ESPN's public scoreboard API needs no key and covers global soccer. We scan international + top
// club competitions for the fixture's date and match by team name — this is the source that makes
// live scores work out of the box (no THESPORTSDB/FOOTBALL_DATA/API_FOOTBALL key required).
const ESPN_SOCCER_LEAGUES = [
  'fifa.world', 'fifa.worldq.uefa', 'fifa.worldq.conmebol', 'fifa.worldq.concacaf',
  'fifa.worldq.afc', 'fifa.worldq.caf', 'fifa.worldq.ofc', 'fifa.friendly', 'fifa.cwc',
  'uefa.euro', 'uefa.nations', 'conmebol.america', 'concacaf.gold',
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1', 'uefa.champions',
];
// ESPN uses the SAME scoreboard shape for basketball, just different sport path + league slugs.
const ESPN_BASKETBALL_LEAGUES = ['nba', 'wnba', 'mens-college-basketball', 'womens-college-basketball'];

type LiveSport = 'soccer' | 'basketball';

async function fetchEspnLive(home: string, away: string, dateYmd: string, signal: AbortSignal, sport: LiveSport = 'soccer'): Promise<LiveScore | null> {
  if (!home || !away || !/^\d{8}$/.test(dateYmd)) return null;
  const leagues = sport === 'basketball' ? ESPN_BASKETBALL_LEAGUES : ESPN_SOCCER_LEAGUES;
  const results = await Promise.all(
    leagues.map((slug) =>
      fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${slug}/scoreboard?dates=${dateYmd}`,
        { next: { revalidate: 15 }, signal })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)),
  );

  type EspnComp = { homeAway?: string; score?: string; team?: { displayName?: string; name?: string; shortDisplayName?: string } };
  type EspnEvent = { id?: string; name?: string; competitions?: Array<{ competitors?: EspnComp[] }>;
    status?: { displayClock?: string; type?: { state?: string; description?: string; detail?: string; shortDetail?: string } } };

  for (const data of results as Array<{ events?: EspnEvent[] } | null>) {
    for (const event of data?.events ?? []) {
      const competitors = event.competitions?.[0]?.competitors ?? [];
      const eHome = competitors.find((c) => c.homeAway === 'home');
      const eAway = competitors.find((c) => c.homeAway === 'away');
      const eHomeName = eHome?.team?.displayName ?? eHome?.team?.name;
      const eAwayName = eAway?.team?.displayName ?? eAway?.team?.name;
      const direct = teamsMatch(eHomeName, home) && teamsMatch(eAwayName, away);
      const swapped = teamsMatch(eHomeName, away) && teamsMatch(eAwayName, home);
      if (!direct && !swapped) continue;

      const state = event.status?.type?.state; // 'pre' | 'in' | 'post'
      const statusText = event.status?.type?.description ?? event.status?.type?.detail ?? null;
      // Orient ESPN's scores onto the market's home/away (the title order), flipping if reversed.
      const homeScore = direct ? eHome?.score : eAway?.score;
      const awayScore = direct ? eAway?.score : eHome?.score;
      return {
        id: event.id,
        event: event.name,
        homeTeam: home,
        awayTeam: away,
        homeScore: homeScore != null ? String(homeScore) : null,
        awayScore: awayScore != null ? String(awayScore) : null,
        status: statusText,
        progress: state === 'in' ? (statusText ?? 'Live') : state === 'post' ? 'Match Finished' : 'Not Started',
        time: state === 'in' ? (event.status?.displayClock || null) : null,
        source: 'espn',
      };
    }
  }
  return null;
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
  // Strip diacritics first (Curaçao -> curacao, Türkiye -> turkiye) so names match across sources.
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

function teamsMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  return na.length > 2 && nb.length > 2 && (na.includes(nb) || nb.includes(na));
}

async function fetchSportsDb(id: string, signal: AbortSignal): Promise<LiveScore | null> {
  const apiKey = getSportsDbApiKey();
  if (!apiKey) return null;
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
  const home = searchParams.get('home')?.trim() || undefined;
  const away = searchParams.get('away')?.trim() || undefined;
  const dateParam = searchParams.get('date')?.trim() || undefined; // YYYYMMDD or YYYY-MM-DD
  const sport: LiveSport = searchParams.get('sport')?.trim().toLowerCase() === 'basketball' ? 'basketball' : 'soccer';
  const hasId = Boolean(id && /^\d+$/.test(id));

  // Need either a TheSportsDB event id OR home+away team names (for the keyless ESPN lookup).
  if (!hasId && !(home && away)) {
    return NextResponse.json({ error: 'A sports event id or home & away team names are required' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    // Baseline (names/date): TheSportsDB when a key + id are present, otherwise synthesize one from
    // the passed teams so ESPN and the keyed providers can match the fixture.
    let base = hasId ? await fetchSportsDb(id as string, controller.signal).catch(() => null) : null;
    if (!base && home && away) {
      const iso = dateParam
        ? (dateParam.includes('-') ? dateParam : `${dateParam.slice(0, 4)}-${dateParam.slice(4, 6)}-${dateParam.slice(6, 8)}`)
        : null;
      base = {
        homeTeam: home, awayTeam: away, homeScore: null, awayScore: null,
        status: null, progress: null, time: null, timestamp: iso, source: 'thesportsdb',
      };
    }
    if (!base) {
      return NextResponse.json({ error: 'Sports event not found' }, { status: 404 });
    }

    const espnDate = (dateParam?.replace(/-/g, '') || (base.timestamp ?? '').slice(0, 10).replace(/-/g, '')) || '';

    // All sources best-effort and parallel; none fails the request. ESPN is keyless and covers
    // both soccer and basketball. football-data.org / API-Football are soccer-only, so they're
    // skipped for basketball (they'd only add latency and never match).
    const isSoccer = sport === 'soccer';
    const [espn, footballData, apiFootball] = await Promise.all([
      (base.homeTeam && base.awayTeam)
        ? fetchEspnLive(base.homeTeam, base.awayTeam, espnDate, controller.signal, sport).catch(() => null)
        : Promise.resolve(null),
      isSoccer ? fetchFootballData(base, controller.signal).catch(() => null) : Promise.resolve(null),
      isSoccer ? fetchApiFootball(base, controller.signal).catch(() => null) : Promise.resolve(null),
    ]);

    // Prefer a source actually reporting a live/finished score over the not-started baseline.
    const result = [apiFootball, footballData, espn].find(hasLiveScore)
      ?? (hasLiveScore(base) ? base : (espn ?? apiFootball ?? footballData ?? base));

    return NextResponse.json(result);
  } catch (err) {
    console.error('[api] sports/live failed:', err);
    return NextResponse.json({ error: 'Live score lookup failed.' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
