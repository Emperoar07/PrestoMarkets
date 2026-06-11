import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id || !/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Valid sports event id is required' }, { status: 400 });
  }

  const apiKey = process.env.THESPORTSDB_API_KEY || '123';
  const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/lookupevent.php?id=${id}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      next: { revalidate: 15 }, // Cache live match data for 15 seconds to avoid hammering API
      signal: controller.signal,
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch live sports data from origin (status ${res.status})` }, { status: 502 });
    }

    const data = await res.json() as {
      events?: Array<{
        idEvent?: string;
        strEvent?: string;
        strHomeTeam?: string;
        strAwayTeam?: string;
        intHomeScore?: string | null;
        intAwayScore?: string | null;
        strStatus?: string | null;
        strProgress?: string | null;
        strTime?: string | null;
        dateEvent?: string;
        strTimestamp?: string;
        strThumb?: string | null;
      }>;
    };

    const event = data.events?.[0];
    if (!event) {
      return NextResponse.json({ error: 'Sports event not found' }, { status: 404 });
    }

    return NextResponse.json({
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Sports lookup request failed: ${message}` }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
