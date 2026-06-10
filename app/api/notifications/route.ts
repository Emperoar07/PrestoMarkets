import { NextRequest, NextResponse } from 'next/server';
import { getSocialSession } from '@/lib/socialSession';
import { countUnreadNotifications, listNotifications } from '@/lib/socialDb';

export async function GET(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  try {
    const [notifications, unreadCount] = await Promise.all([
      listNotifications(session.address, 30),
      countUnreadNotifications(session.address),
    ]);
    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error('[api] notifications failed:', error);
    return NextResponse.json(
      { error: 'Notifications are unavailable.' },
      { status: 503 },
    );
  }
}
