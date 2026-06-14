'use client';

import { memo, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import type { Market } from '@/lib/markets';
import { getOutcomeColor } from '@/lib/outcomeColors';
import { useAppState } from '@/lib/appState';
import { prefetchMarketDetail } from '@/lib/marketPrefetch';
import { deriveDisplayType } from '@/lib/marketDisplay';
import { detectCountryFlagUrl } from '@/lib/marketSubjectImage';
import { Countdown } from './Countdown';
import { ChanceMeter } from './ChanceMeter';

function generateSparklinePath(marketId: string, odds: number): string {
  const seed = marketId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const points = [];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1)) * 120;
    const factor = Math.sin(seed + i * 1.5) * 12;
    const targetY = 30 - (odds / 100) * 20; // odds 0-100 -> height 10-30
    const y = targetY + factor * (1 - i / (count - 1));
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M ${points.join(' L ')}`;
}

type MarketCardMarket = Market & {
  source?: 'onchain';
  closeDate?: string;
};

function getTeamCode(team: string): string {
  return team
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 3)
    .toUpperCase() || team.slice(0, 3).toUpperCase();
}

function TeamBadge({ team, image, fallbackImage }: { team: string; image?: string; fallbackImage?: string }) {
  // Prefer an explicit per-outcome image (user-uploaded or agent-resolved crest), then the derived
  // country flag, then any provided fallback, then the letter code.
  const src = image || detectCountryFlagUrl(team) || fallbackImage;
  if (src) {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[7px] border border-white/[0.05] bg-[#070e17]">
        <img src={src} alt="" width={32} height={32} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-white/[0.05] bg-[#070e17] text-[9px] font-black text-cyan/70">
      {getTeamCode(team)}
    </span>
  );
}

function MarketCardComponent({
  market,
  onQuickBuy,
}: {
  market: MarketCardMarket;
  onQuickBuy?: (market: MarketCardMarket, outcome: string) => void;
}) {
  const [imageError, setImageError] = useState(false);
  const { refreshAccountPortfolio } = useAppState();
  const yes = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
  const yesOdds = yes?.odds ?? 50;
  const isClosingSoon = market.status === 'Closing soon';
  const isLive = market.status === 'Open' || isClosingSoon;
  const isResolved = market.status === 'Resolved';
  const displayType = deriveDisplayType(market);
  const isListLayout = displayType === 'multi_outcome' || displayType === 'date_ladder';
  const isPulse = displayType === 'pulse_gauge';
  // A binary YES/NO market must never render through the sports-fixture layout — that turns
  // "YES"/"NO" into "Y"/"N" team-code buttons with flag badges (the broken card). Only treat
  // it as a fixture when it actually has team-style outcomes.
  const isBinaryYesNo = market.outcomes.length === 2
    && market.outcomes.every((o) => /^(yes|no)$/i.test(o.label));
  const isSportsFixture = displayType === 'sports_live' && !isBinaryYesNo;
  const isOpinion = market.type === 'Opinion';

  const handleQuickBuy = (outcome: string) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (onQuickBuy) onQuickBuy(market, outcome);
    else window.location.href = `/markets/${market.id}?buy=${encodeURIComponent(outcome)}`;
  };

  const iconTile = (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-white/[0.04] bg-[#070e17]">
      {market.imageURI && !imageError ? (
        <img
          src={market.imageURI}
          alt={market.title}
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setImageError(true)}
        />
      ) : (
        <span className="text-[10px] font-black text-cyan/70">{market.category.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );

  const footer = (
    <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/[0.04] pt-1.5">
      <span className="text-[10px] font-semibold text-[#475569]">{market.volume} Vol.</span>
      <div className="flex items-center gap-2">
        {isLive ? (
          <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider ${isClosingSoon ? 'text-amber-400 animate-pulse' : 'text-[#475569]'}`}>
            <span className={`h-1 w-1 rounded-full ${isClosingSoon ? 'bg-amber-400 animate-pulse' : 'bg-red-500'}`} />
            {market.closeDate ? <Countdown closeDate={market.closeDate} /> : 'LIVE'}
          </span>
        ) : (
          <span className="text-[9px] font-black uppercase tracking-wider text-[#475569]">{isResolved ? 'Resolved' : market.closeLabel || 'Closed'}</span>
        )}
      </div>
    </div>
  );

  // ── Pulse / directional market: gauge top-right, full-width Yes/No (only card with a gauge) ──
  if (isPulse) {
    return (
      <Link
        href={`/markets/${market.id}`}
        onMouseEnter={() => prefetchMarketDetail(market.id, refreshAccountPortfolio)}
        className="group flex min-h-[156px] min-w-0 flex-col rounded-[10px] border border-white/[0.05] bg-[#0c121d] p-2.5 transition-all hover:border-white/[0.09] hover:bg-[#101929]"
      >
        <div className="grid grid-cols-[40px_minmax(0,1fr)_64px] items-start gap-2.5">
          {iconTile}
          <h3 className="line-clamp-3 text-[12.5px] font-bold leading-[1.35] text-[#cbd5e1] transition-colors group-hover:text-white">{market.title}</h3>
          <ChanceMeter percent={yesOdds} />
        </div>
        {isLive ? (
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <button type="button" onClick={handleQuickBuy('YES')} className="rounded-[7px] bg-[#132d21] py-2 text-[11px] font-black uppercase text-emerald-400 transition-all hover:bg-[#183929] hover:text-emerald-300 active:scale-95">Yes</button>
            <button type="button" onClick={handleQuickBuy('NO')} className="rounded-[7px] bg-[#381515] py-2 text-[11px] font-black uppercase text-rose-400 transition-all hover:bg-[#4c1c1c] hover:text-rose-300 active:scale-95">No</button>
          </div>
        ) : (
          <div className="mt-2.5 rounded-[7px] border border-white/[0.06] py-2 text-center text-[10px] font-bold text-[#475569]">Closed</div>
        )}
        {footer}
      </Link>
    );
  }

  if (isSportsFixture) {
    const drawOutcome = market.outcomes.find((outcome) => /^draw$/i.test(outcome.label));
    const homeOutcome = market.outcomes[0];
    const awayOutcome = market.outcomes.find((outcome, index) => index > 0 && outcome.label !== drawOutcome?.label) ?? market.outcomes[2] ?? market.outcomes[1];
    const homeLabel = homeOutcome?.label ?? 'Home';
    const awayLabel = awayOutcome?.label ?? 'Away';
    const buttonOutcomes = [homeOutcome, drawOutcome, awayOutcome]
      .filter((outcome): outcome is Market['outcomes'][number] => Boolean(outcome))
      .filter((outcome, index, list) => list.findIndex((item) => item.label === outcome.label) === index);

    return (
      <Link
        href={`/markets/${market.id}`}
        onMouseEnter={() => prefetchMarketDetail(market.id, refreshAccountPortfolio)}
        className="group flex h-[156px] min-w-0 flex-col rounded-[10px] border border-white/[0.05] bg-[#0c121d] p-2.5 transition-all hover:border-white/[0.09] hover:bg-[#101929]"
      >
        <div className="space-y-1.5">
          {[
            { label: homeLabel, odds: homeOutcome?.odds ?? 0, image: market.imageURI },
            { label: awayLabel, odds: awayOutcome?.odds ?? 0, image: undefined },
          ].map((team) => (
            <div key={team.label} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <TeamBadge team={team.label} image={team.image} />
                <span className="truncate text-[12.5px] font-extrabold text-[#e5edf8]">{team.label}</span>
              </span>
              <span className="shrink-0 text-[11.5px] font-black text-white">{Math.round(team.odds)}%</span>
            </div>
          ))}
        </div>

        {isLive ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {buttonOutcomes.map((outcome, index) => {
              const isDraw = /^draw$/i.test(outcome.label);
              const isAway = outcome.label === awayLabel;
              return (
                <button
                  key={outcome.label}
                  type="button"
                  onClick={handleQuickBuy(outcome.label)}
                  className={[
                    'rounded-[8px] px-2 py-2 text-[11px] font-black transition-all active:scale-95',
                    isDraw
                      ? 'bg-[#25322f] text-[#9fb0c8] hover:bg-[#2d3c38] hover:text-white'
                      : isAway || index === 2
                        ? 'bg-[#13283a] text-[#28a8ff] hover:bg-[#17324a]'
                        : 'bg-[#2d2d16] text-[#facc15] hover:bg-[#39391c]',
                  ].join(' ')}
                >
                  {isDraw ? 'Draw' : getTeamCode(outcome.label)}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-[8px] border border-white/[0.06] py-2 text-center text-[10px] font-bold text-[#475569]">Closed</div>
        )}

        {footer}
      </Link>
    );
  }

  return (
    <Link
      href={`/markets/${market.id}`}
      onMouseEnter={() => prefetchMarketDetail(market.id, refreshAccountPortfolio)}
      className="group flex h-[156px] min-w-0 items-stretch gap-2.5 overflow-hidden rounded-[10px] border border-white/[0.05] bg-[#0c121d] p-2.5 transition-all hover:border-white/[0.09] hover:bg-[#101929]"
    >
      {/* Left: Icon logo */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-white/[0.04] bg-[#070e17]">
        {market.imageURI && !imageError ? (
          <img
            src={market.imageURI}
            alt={market.title}
            width={40}
            height={40}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <span className="text-[10px] font-black text-cyan/70">{market.category.slice(0, 2).toUpperCase()}</span>
        )}
      </div>

      {/* Right: Contents column */}
      <div className="flex flex-1 flex-col justify-between h-full min-w-0">
        
        {/* Title row */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {isResolved ? (
              <span className="rounded-full border border-cyan/25 bg-cyan/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-cyan shrink-0">
                {'Resolved'}
              </span>
            ) : null}
            <h3 className="line-clamp-2 text-[12.5px] font-bold leading-snug text-[#cbd5e1] transition-colors group-hover:text-white">
              {market.title}
            </h3>
          </div>
        </div>

        {/* Outcomes layout — chosen by displayType */}
        {isListLayout ? (
          /* ── Multi-outcome / date-ladder: scrollable list without scrollbars ── */
          <div className="scrollbar-hide my-1 max-h-[68px] space-y-0.5 overflow-y-auto pr-1">
            {market.pollOptions?.map((option, index) => {
              const color = getOutcomeColor(index);
              const odds = market.outcomes.find((_, idx) => idx === index)?.odds ?? 0;
              return (
                <div key={`${option}-${index}`} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[10.5px] font-bold text-[#94a3b8]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="truncate">{option}</span>
                    <span className="ml-1 text-[10.5px] font-black text-[#cbd5e1]">{odds}%</span>
                  </span>
                  
                  {isLive ? (
                    <div className="flex items-center gap-1 shrink-0 bg-white/[0.02] border border-white/[0.06] rounded-[6px] p-[2px]">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onQuickBuy) {
                            onQuickBuy(market, option);
                          } else {
                            window.location.href = `/markets/${market.id}?buy=${encodeURIComponent(option)}`;
                          }
                        }}
                        className="px-2 py-0.5 text-[9px] font-black uppercase rounded bg-[#132d21] text-emerald-400 hover:bg-[#183929] hover:text-emerald-300 active:scale-95 transition-all"
                      >
                        {'YES'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onQuickBuy) {
                            onQuickBuy(market, option);
                          } else {
                            window.location.href = `/markets/${market.id}?buy=${encodeURIComponent(option)}`;
                          }
                        }}
                        className="px-2 py-0.5 text-[9px] font-black uppercase rounded bg-[#381515] text-rose-400 hover:bg-[#4c1c1c] hover:text-rose-300 active:scale-95 transition-all"
                      >
                        {'NO'}
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] font-bold text-[#475569]">{'Closed'}</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Binary (YES/NO) Prediction or Opinion markets ── */
          <div className="flex flex-col gap-1.5 my-1">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-bold text-[#94a3b8]">
                {isOpinion ? 'Support' : 'YES'} <span className="font-black text-[#cbd5e1]">{yesOdds}%</span>
              </span>
            </div>

            {isLive ? (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onQuickBuy) {
                      onQuickBuy(market, 'YES');
                    } else {
                      window.location.href = `/markets/${market.id}?buy=yes`;
                    }
                  }}
                  className="rounded-[8px] bg-[#1a2638]/40 border border-white/[0.05] py-1 text-[10px] font-black uppercase text-[#cbd5e1] transition-all hover:bg-[#22324a]/60 hover:text-cyan hover:border-cyan/20 active:scale-95 text-center"
                >
                  {'YES'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onQuickBuy) {
                      onQuickBuy(market, 'NO');
                    } else {
                      window.location.href = `/markets/${market.id}?buy=no`;
                    }
                  }}
                  className="rounded-[8px] bg-[#1a2638]/40 border border-white/[0.05] py-1 text-[10px] font-black uppercase text-[#cbd5e1] transition-all hover:bg-[#22324a]/60 hover:text-cyan hover:border-cyan/20 active:scale-95 text-center"
                >
                  {'NO'}
                </button>
              </div>
            ) : (
              <div className="rounded-[8px] border border-white/[0.06] py-1 text-center text-[10px] font-bold text-[#475569]">
                {'Closed'}
              </div>
            )}
          </div>
        )}

        {/* Metadata row (only volume) */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/[0.04] pt-1.5">
          <span className="text-[10px] font-semibold text-[#475569]">{market.volume} Vol.</span>
          <div className="flex items-center gap-2">
            {isLive ? (
              <span className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider ${isClosingSoon ? 'text-amber-400 animate-pulse' : 'text-[#475569]'}`}>
                <span className={`h-1 w-1 rounded-full ${isClosingSoon ? 'bg-amber-400 animate-pulse' : 'bg-red-500'}`} />
                {market.closeDate ? <Countdown closeDate={market.closeDate} /> : 'LIVE'}
              </span>
            ) : (
              <span className="text-[9px] font-black uppercase tracking-wider text-[#475569]">
                {isResolved ? 'Resolved' : market.closeLabel || 'Closed'}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export const MarketCard = memo(MarketCardComponent);
