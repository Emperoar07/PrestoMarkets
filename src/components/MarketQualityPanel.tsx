'use client';

import { useState } from 'react';
import type { Market } from '@/lib/markets';

function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.trim().match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}

/**
 * One panel with a side-by-side switch between Market quality (why the market exists) and
 * Resolution rules (the bettor-facing settlement rules + resolver mode).
 */
export function MarketQualityPanel({ market }: { market: Market }) {
  const [tab, setTab] = useState<'quality' | 'rules'>('rules');
  const why = market.createdByType === 'agent' ? firstSentence(market.agentReason) : undefined;

  const tabClass = (active: boolean) =>
    `rounded-[7px] px-3 py-1.5 text-xs font-black transition-colors ${active ? 'bg-white/[0.07] text-white' : 'text-muted hover:text-white'}`;

  return (
    <div className="mt-6 min-w-0 overflow-hidden rounded-[14px] border border-white/[0.06] bg-[#141e30] p-5">
      <div className="inline-flex rounded-[10px] border border-white/[0.06] bg-[#0d1520] p-1">
        <button type="button" onClick={() => setTab('rules')} className={tabClass(tab === 'rules')}>Resolution rules</button>
        <button type="button" onClick={() => setTab('quality')} className={tabClass(tab === 'quality')}>Market quality</button>
      </div>

      {tab === 'quality' ? (
        <p className="mt-4 text-sm leading-7 text-muted [overflow-wrap:anywhere]">
          {why ?? 'Created by a user.'}
        </p>
      ) : (
        <div className="mt-4">
          <p className="break-words text-sm leading-7 text-muted [overflow-wrap:anywhere]">{market.rules}</p>
          {market.resolverVerified ? (
            <span className="mt-4 inline-flex rounded-full border border-mint/30 bg-mint/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-mint">
              ✓ Verified Presto oracle
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
