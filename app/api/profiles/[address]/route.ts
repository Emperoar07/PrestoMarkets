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
    // Public endpoint — never expose PII (email / email opt-in).
    return NextResponse.json({
      profile: {
        address,
        handle: profile?.handle ?? null,
        bio: profile?.bio ?? '',
        avatarUrl: profile?.avatarUrl ?? '',
        optInLeaderboard: profile?.optInLeaderboard ?? false,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Profile is unavailable.' },
      { status: 503 },
    );
  }
}
