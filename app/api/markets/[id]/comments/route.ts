import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/requestGuards';
import { checkRateLimit } from '@/lib/rateLimitRedis';
import { createComment, listComments, editComment, hideComment, getCommentById } from '@/lib/socialDb';
import { getSocialSession } from '@/lib/socialSession';
import { notifyUser } from '@/lib/notifications';
import { normalizeMarketId, sanitizeCommentBody } from '@/lib/socialValidation';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const marketId = normalizeMarketId(id);
  if (!marketId) {
    return NextResponse.json({ error: 'Valid market id is required.' }, { status: 400 });
  }

  try {
    const session = getSocialSession(request);
    const viewerAddress = session?.address;
    const comments = await listComments(marketId, viewerAddress);
    return NextResponse.json({ comments });
  } catch (error) {
    console.error('[api] markets/[id]/comments failed:', error);
    return NextResponse.json(
      { error: 'Comments are unavailable.' },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request.headers);
  if (!(await checkRateLimit('comments-write', ip, { limit: 12, windowSec: 60 }))) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) {
    return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  }

  const { id } = await params;
  const marketId = normalizeMarketId(id);
  if (!marketId) {
    return NextResponse.json({ error: 'Valid market id is required.' }, { status: 400 });
  }

  let body: { body?: string; parentId?: number | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const commentBody = sanitizeCommentBody(body.body);
  if (!commentBody) {
    return NextResponse.json({ error: 'Comment body is required.' }, { status: 400 });
  }

  try {
    const parentId = typeof body.parentId === 'number' ? body.parentId : null;
    const comment = await createComment({
      marketId,
      authorAddress: session.address,
      body: commentBody,
      parentId,
    });

    // Notify the parent comment's author of a reply (not for self-replies). Best-effort.
    if (parentId) {
      const parent = await getCommentById(parentId).catch(() => null);
      if (parent && parent.authorAddress.toLowerCase() !== session.address.toLowerCase()) {
        void notifyUser({
          address: parent.authorAddress,
          type: 'comment_reply',
          title: 'New reply to your comment',
          body: commentBody.slice(0, 140),
          marketId,
        });
      }
    }

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Reply parent')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[api] markets/[id]/comments failed:', error);
    return NextResponse.json(
      { error: 'Comment could not be saved.' },
      { status: 503 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) {
    return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  }

  let body: { commentId?: number; body?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const commentId = Number(body.commentId);
  if (isNaN(commentId)) {
    return NextResponse.json({ error: 'Valid comment id is required.' }, { status: 400 });
  }

  const commentBody = sanitizeCommentBody(body.body);
  if (!commentBody) {
    return NextResponse.json({ error: 'Comment body is required.' }, { status: 400 });
  }

  try {
    const updated = await editComment({
      id: commentId,
      authorAddress: session.address,
      body: commentBody,
    });
    if (!updated) {
      return NextResponse.json({ error: 'Comment not found or unauthorized.' }, { status: 404 });
    }
    return NextResponse.json({ comment: updated });
  } catch (error) {
    console.error('[api] markets/[id]/comments failed:', error);
    return NextResponse.json(
      { error: 'Comment could not be edited.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = getSocialSession(request);
  if (!session) {
    return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });
  }

  let body: { commentId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const commentId = Number(body.commentId);
  if (isNaN(commentId)) {
    return NextResponse.json({ error: 'Valid comment id is required.' }, { status: 400 });
  }

  try {
    const deleted = await hideComment({
      id: commentId,
      authorAddress: session.address,
    });
    if (!deleted) {
      return NextResponse.json({ error: 'Comment not found or unauthorized.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api] markets/[id]/comments failed:', error);
    return NextResponse.json(
      { error: 'Comment could not be deleted.' },
      { status: 500 },
    );
  }
}
