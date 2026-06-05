import { NextRequest, NextResponse } from 'next/server';
import { getSocialSession } from '@/lib/socialSession';
import { markNotificationsRead } from '@/lib/socialDb';

// Mark notifications read. Body { ids?: number[] } — omit ids to mark all as read.
export async function POST(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  let body: { ids?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body = mark all */
  }
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((n): n is number => Number.isInteger(n))
    : undefined;

  try {
    await markNotificationsRead(session.address, ids);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update notifications.' },
      { status: 503 },
    );
  }
}
