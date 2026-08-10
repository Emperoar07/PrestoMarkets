'use client';

import { MarketDetailClient } from './MarketDetailClient';
import { MarketDetailErrorBoundary } from './MarketDetailErrorBoundary';
import type { AppMarket } from '@/lib/appState';

// Static import + no ssr:false: MarketDetailClient is render-safe (every window/document/wagmi touch
// is inside an effect; wallet state comes from context), so the server emits the real title/odds/
// description in the initial HTML. Previously this was a dynamic({ ssr:false }) import — the browser
// saw a skeleton, then had to fetch this component's chunk in a SECOND round-trip and run a data
// call before any content appeared. This component lives only on the markets/[id] route, so Next's
// per-route code-splitting already keeps its bundle off every other page; a plain import here means
// one chunk, server-rendered, hydrated as a unit (no Suspense fallback flashing over the content).
export function MarketDetailLoader({
  marketId,
  initialMarket,
}: {
  marketId: string;
  initialMarket?: AppMarket;
}) {
  // The boundary scopes any per-market render throw to a retryable card (logging the failing field)
  // rather than unwinding to Next's bare global-error page.
  return (
    <MarketDetailErrorBoundary>
      <MarketDetailClient marketId={marketId} initialMarket={initialMarket} />
    </MarketDetailErrorBoundary>
  );
}
