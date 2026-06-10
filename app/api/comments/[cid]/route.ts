import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { editComment, hideComment } from '@/lib/socialDb';
import { getSocialSession } from '@/lib/socialSession';
import { sanitizeCommentBody } from '@/lib/socialValidation';

const commentEditRateLimitStore = new Map<string, { count: number; resetAt: number }>();

function parseCommentId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ cid: string }> }) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(commentEditRateLimitStore, ip, { max: 20, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const { cid } = await params;
  const id = parseCommentId(cid);
  if (!id) return NextResponse.json({ error: 'Valid comment id is required.' }, { status: 400 });

  let body: { body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const commentBody = sanitizeCommentBody(body.body);
  if (!commentBody) return NextResponse.json({ error: 'Comment body is required.' }, { status: 400 });

  try {
    const comment = await editComment({ id, authorAddress: session.address, body: commentBody });
    if (!comment) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 });
    return NextResponse.json({ comment });
  } catch (error) {
    console.error('[api] comments/[cid] failed:', error);
    return NextResponse.json(
      { error: 'Comment could not be edited.' },
      { status: 503 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ cid: string }> }) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(commentEditRateLimitStore, ip, { max: 20, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  const { cid } = await params;
  const id = parseCommentId(cid);
  if (!id) return NextResponse.json({ error: 'Valid comment id is required.' }, { status: 400 });

  try {
    const comment = await hideComment({ id, authorAddress: session.address });
    if (!comment) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api] comments/[cid] failed:', error);
    return NextResponse.json(
      { error: 'Comment could not be deleted.' },
      { status: 503 },
    );
  }
}
