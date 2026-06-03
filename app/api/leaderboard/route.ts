import { NextRequest, NextResponse } from 'next/server';
import { listLeaderboard } from '@/lib/socialDb';
import { parseLeaderboardQuery } from '@/lib/socialValidation';

export async function GET(request: NextRequest) {
  const query = parseLeaderboardQuery(new URL(request.url));

  try {
    const rows = await listLeaderboard(query);
    return NextResponse.json({ ...query, rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Leaderboard is unavailable.' },
      { status: 503 },
    );
  }
}
