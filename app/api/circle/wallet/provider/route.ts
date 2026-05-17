import { NextResponse } from 'next/server';

export async function POST() {
  if (process.env.NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'Circle Wallets are not enabled for this deployment.' },
      { status: 501 },
    );
  }

  return NextResponse.json(
    {
      error: 'Circle Wallet provider requires server-side Circle API credentials and user session storage before issuing a managed Arc wallet.',
    },
    { status: 501 },
  );
}
