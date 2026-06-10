import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { getSocialSession } from '@/lib/socialSession';

export const runtime = 'nodejs';

const avatarRateLimitStore = new Map<string, { count: number; resetAt: number }>();
const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(avatarRateLimitStore, ip, { max: 10, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const session = getSocialSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in is required.' }, { status: 401 });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'Avatar uploads are not configured yet. Paste an image URL instead.' },
      { status: 503 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No image file provided.' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Use a PNG, JPG, WEBP or GIF image.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image must be under 3MB.' }, { status: 400 });
  }

  const ext = (file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
  try {
    const blob = await put(`avatars/${session.address}.${ext}`, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (error) {
    console.error('[api] profiles/avatar failed:', error);
    return NextResponse.json(
      { error: 'Avatar upload failed.' },
      { status: 502 },
    );
  }
}
