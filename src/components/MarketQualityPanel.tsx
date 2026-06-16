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
export function MarketQualityPanel({ market, isLive }: { market: Market; isLive?: boolean }) {
  const [tab, setTab] = useState<'quality' | 'rules'>('rules');
  const why = market.createdByType === 'agent' ? firstSentence(market.agentReason) : undefined;
  const showQualityTab = !(market.status === 'Resolved' || isLive);
  const activeTab = showQualityTab ? tab : 'rules';

  const tabClass = (active: boolean) =>
    `pb-2 text-xs font-black transition-all border-b-2 -mb-px ${
      active
        ? 'border-cyan text-cyan'
        : 'border-transparent text-[#64748b] hover:text-white'
    }`;

  return (
    <div className="mt-8 min-w-0">
      <div className="flex gap-6 border-b border-white/[0.06]">
        <button type="button" onClick={() => setTab('rules')} className={tabClass(activeTab === 'rules')}>Resolution rules</button>
        {showQualityTab && (
          <button type="button" onClick={() => setTab('quality')} className={tabClass(activeTab === 'quality')}>Market quality</button>
        )}
      </div>

      {activeTab === 'quality' ? (
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
