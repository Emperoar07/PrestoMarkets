import { NextResponse } from 'next/server';

export async function POST() {
  if (process.env.NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Circle User-Controlled Wallets are not enabled for this deployment.' },
      { status: 501 },
    );
  }

  return NextResponse.json(
    {
      error: 'Circle User-Controlled Wallets require the Web SDK social/email/PIN flow plus server endpoints for device tokens, user initialization, challenges, and wallet listing.',
    },
    { status: 501 },
  );
}
