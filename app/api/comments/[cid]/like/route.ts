import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { getSocialSession } from '@/lib/socialSession';
import { likeComment, unlikeComment } from '@/lib/socialDb';

const commentLikeRateLimitStore = new Map<string, { count: number; resetAt: number }>();

function parseCommentId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ cid: string }> }) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(commentLikeRateLimitStore, ip, { max: 30, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const { cid } = await params;
  const id = parseCommentId(cid);
  if (!id) return NextResponse.json({ error: 'Valid comment id is required.' }, { status: 400 });

  try {
    await likeComment(session.address, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not like comment.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ cid: string }> }) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(commentLikeRateLimitStore, ip, { max: 30, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const { cid } = await params;
  const id = parseCommentId(cid);
  if (!id) return NextResponse.json({ error: 'Valid comment id is required.' }, { status: 400 });

  try {
    await unlikeComment(session.address, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not unlike comment.' },
      { status: 500 },
    );
  }
}
