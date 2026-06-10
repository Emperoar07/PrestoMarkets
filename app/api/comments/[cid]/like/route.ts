import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { getSocialSession } from '@/lib/socialSession';
import { likeComment, unlikeComment, getCommentById } from '@/lib/socialDb';
import { notifyUser } from '@/lib/notifications';

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

    // Notify the comment author of a like (not for self-likes). Best-effort.
    const comment = await getCommentById(id).catch(() => null);
    if (comment && comment.authorAddress.toLowerCase() !== session.address.toLowerCase()) {
      void notifyUser({
        address: comment.authorAddress,
        type: 'comment_like',
        title: 'Someone liked your comment',
        marketId: comment.marketId,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api] comments/[cid]/like failed:', error);
    return NextResponse.json(
      { error: 'Could not like comment.' },
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
    console.error('[api] comments/[cid]/like failed:', error);
    return NextResponse.json(
      { error: 'Could not unlike comment.' },
      { status: 500 },
    );
  }
}
