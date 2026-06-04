'use client';

import type { Market } from '@/lib/markets';

function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.trim().match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}

/**
 * Public trust box shown at the top of a market.
 */
export function MarketQualityPanel({ market }: { market: Market }) {
  const why = market.createdByType === 'agent' ? firstSentence(market.agentReason) : undefined;

  return (
    <div className="mt-6 min-w-0 overflow-hidden rounded-[14px] border border-white/[0.06] bg-[#141e30] p-5">
      <h2 className="text-base font-black text-white">Market quality</h2>
      {why ? <p className="mt-3 text-sm leading-7 text-muted [overflow-wrap:anywhere]">{why}</p> : null}
    </div>
  );
}
