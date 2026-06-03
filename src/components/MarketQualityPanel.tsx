'use client';

import type { Market } from '@/lib/markets';
import { isSafeUrl } from '@/lib/marketMetadata';
import { parseConfidence } from '@/lib/marketCalibration';

function hostOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function firstSentence(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.trim().match(/^.*?[.!?](\s|$)/);
  return (match ? match[0] : text).trim();
}

type Tone = 'mint' | 'cyan' | 'amber' | 'muted';

const toneChip: Record<Tone, string> = {
  mint: 'border-mint/30 bg-mint/10 text-mint',
  cyan: 'border-cyan/30 bg-cyan/10 text-cyan',
  amber: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  muted: 'border-white/15 bg-white/[0.04] text-muted',
};

/**
 * Trust box shown at the top of a market: an at-a-glance settlement verdict, the settlement
 * source + resolver, the agent's confidence, explicit risk flags, and a plain-language
 * breakdown of what resolves the market. Complements (does not replace) the detailed
 * agent-reasoning and settlement-record blocks below it.
 */
export function MarketQualityPanel({ market }: { market: Market }) {
  const sourceUrl = [market.sourceOfTruth, market.trendUrl].find((u) => isSafeUrl(u));
  const sourceHost = hostOf(sourceUrl);
  const hasConcreteSource = Boolean(sourceUrl);
  const verifiedResolver = Boolean(market.resolverVerified);
  const confidence = parseConfidence(market.agentConfidence);
  const isAgent = market.createdByType === 'agent';
  const isCanceled = market.status === 'Canceled';

  const flags: string[] = [];
  if (!hasConcreteSource) flags.push('No concrete public source URL — settlement could be ambiguous.');
  if (!verifiedResolver) flags.push('Resolver is not the verified Presto oracle — verify independently.');
  if (market.type === 'Opinion') flags.push('Opinion market — resolves on a stated judgment, not a hard external fact.');
  if (typeof market.safetyScore === 'number' && market.safetyScore < 70) {
    flags.push(`Safety score ${market.safetyScore} is below the usual bar.`);
  }

  const grade = !hasConcreteSource ? 'Low' : verifiedResolver ? 'High' : 'Medium';
  const verdict: { label: string; tone: Tone } = isCanceled
    ? { label: 'Canceled — refunded', tone: 'muted' }
    : hasConcreteSource && verifiedResolver && flags.length === 0
      ? { label: 'Clear & settleable', tone: 'mint' }
      : flags.length >= 2
        ? { label: 'Trade with caution', tone: 'amber' }
        : { label: 'Mostly clear', tone: 'cyan' };

  const outcomes = market.outcomes?.map((o) => o.label).filter(Boolean) ?? [];
  const why = isAgent ? firstSentence(market.agentReason) : undefined;

  return (
    <div className="mt-6 min-w-0 overflow-hidden rounded-[14px] border border-white/[0.06] bg-[#141e30] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-black text-white">Market quality</h2>
        <span className={`rounded-full border px-3 py-1 text-xs font-black ${toneChip[verdict.tone]}`}>{verdict.label}</span>
      </div>

      {why ? <p className="mt-3 text-sm leading-7 text-muted [overflow-wrap:anywhere]">{why}</p> : null}

      <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted">Settlement source</p>
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 block break-all text-sm text-cyan hover:opacity-80">
              {sourceHost} ↗
            </a>
          ) : (
            <p className="mt-1.5 text-sm text-amber-300">No source URL</p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted">Resolver</p>
          <p className={`mt-1.5 text-sm ${verifiedResolver ? 'text-mint' : 'text-amber-300'}`}>
            {verifiedResolver ? '✓ Verified Presto oracle' : 'Custom — verify'}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted">Agent confidence</p>
          <p className="mt-1.5 text-sm text-white">{confidence !== null ? `${Math.round(confidence * 100)}%` : 'Not logged'}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted">Settlement clarity</p>
          <p className="mt-1.5 text-sm text-white">{grade}</p>
        </div>
      </div>

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted">Risk flags</p>
        {flags.length === 0 ? (
          <p className="mt-1.5 text-sm text-mint">No flags — clean, settleable market.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {flags.map((flag) => (
              <li key={flag} className="flex gap-2 text-sm text-muted">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <span className="[overflow-wrap:anywhere]">{flag}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted">How it resolves</p>
        {outcomes.length > 0 ? (
          <p className="mt-1.5 text-sm text-white [overflow-wrap:anywhere]">
            Settles to one of: <span className="font-bold">{outcomes.join(' · ')}</span>.
          </p>
        ) : null}
        <p className="mt-1.5 text-sm text-muted">
          Resolves <span className="font-bold text-white">CANCEL</span> and refunds all participants if the source
          cannot confirm an outcome by close.
        </p>
      </div>
    </div>
  );
}
