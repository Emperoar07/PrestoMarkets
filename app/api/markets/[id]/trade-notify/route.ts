import { NextResponse } from 'next/server';

// Creator trade alerts used to trust a browser-supplied amount and outcome.
// Keep the endpoint explicit until receipt-backed server-side dispatch is added.
export async function POST() {
  return NextResponse.json(
    { error: 'Trade notifications are dispatched only from verified server-side receipts.' },
    { status: 410 },
  );
}
