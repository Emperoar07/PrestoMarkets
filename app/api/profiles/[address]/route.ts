import { NextRequest, NextResponse } from 'next/server';
import { getProfile } from '@/lib/socialDb';
import { normalizeSocialAddress } from '@/lib/socialAuth';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address: rawAddress } = await params;
  const address = normalizeSocialAddress(rawAddress);
  if (!address) {
    return NextResponse.json({ error: 'Valid address is required.' }, { status: 400 });
  }

  try {
    const profile = await getProfile(address);
    return NextResponse.json({
      profile: profile ?? {
        address,
        handle: null,
        bio: '',
        avatarUrl: '',
        optInLeaderboard: false,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Profile is unavailable.' },
      { status: 503 },
    );
  }
}
