import { memo, useMemo } from 'react';
import type { Market } from '@/lib/markets';
import { getOutcomeColor } from '@/lib/outcomeColors';

type MarketSignalChartMarket = Pick<Market, 'outcomes' | 'volume' | 'liquidity'>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseUsd(value: string) {
  const normalized = value.replace(/[$,\s]/g, '').toUpperCase();
  const multiplier = normalized.endsWith('M') ? 1_000_000 : normalized.endsWith('K') ? 1_000 : 1;
  return (Number(normalized.replace(/[MK]/g, '')) || 0) * multiplier;
}

function buildSignalPoints(baseOdds: number, volume: number, liquidity: number, phase = 0): number[] {
  const depthBias = liquidity > 0 ? clamp(volume / Math.max(liquidity, 1), 0.1, 1.8) : 0.5;
  return Array.from({ length: 110 }, (_, i) => {
    const slow = Math.sin(i * 0.08 + phase) * 4.2;
    const mid = Math.sin(i * 0.27 + phase * 1.3) * 2.1;
    const fast = Math.sin(i * 1.05 + phase * 0.7) * 0.75;
    const drift = (i - 55) * depthBias * 0.035;
    const spike = i > 78 && i < 92 ? Math.sin((i - 78) * 0.62 + phase) * 6.8 : 0;
    return clamp(baseOdds + slow + mid + fast + drift + spike, 1, 99);
  });
}

function chartY(point: number, height: number, paddingY: number) {
  return paddingY + (1 - point / 100) * (height - paddingY * 2);
}

function buildSmoothPath(points: number[], width: number, height: number, offsetX: number, paddingY: number) {
  const coords = points.map((p, i) => ({
    x: offsetX + (i / (points.length - 1)) * width,
    y: chartY(p, height, paddingY),
  }));

  let path = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const cp = (curr.x - prev.x) * 0.42;
    path += ` C ${(prev.x + cp).toFixed(1)} ${prev.y.toFixed(1)}, ${(curr.x - cp).toFixed(1)} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }
  return path;
}

function MarketSignalChartComponent({ market, compact = false }: { market: MarketSignalChartMarket; compact?: boolean }) {
  const volume = parseUsd(market.volume);
  const liquidity = parseUsd(market.liquidity);

  const W = compact ? 460 : 1000;
  const H = compact ? 120 : 420;
  const padL = compact ? 0 : 32;
  const padR = compact ? 0 : 68;
  const padY = compact ? 14 : 48;
  const chartW = W - padL - padR;
  const endX = padL + chartW;

  // Memoize outcome series calculation
  const outcomeSeries = useMemo(() =>
    market.outcomes.map((outcome, index) => {
      const phase = index * (Math.PI / market.outcomes.length);
      const points = buildSignalPoints(outcome.odds, index === 0 ? volume : liquidity, index === 0 ? liquidity : volume, phase);
      return { label: outcome.label, odds: outcome.odds, points, color: getOutcomeColor(index) };
    }),
    [market.outcomes, volume, liquidity]
  );

  // Memoize paths calculation
  const paths = useMemo(
    () => outcomeSeries.map((series) => buildSmoothPath(series.points, chartW, H, padL, padY)),
    [outcomeSeries, chartW, H, padL, padY]
  );

  // Memoize primary area path
  const primaryAreaPath = useMemo(
    () => paths.length > 0 ? `${paths[0]} L ${endX} ${H - padY} L ${padL} ${H - padY} Z` : '',
    [paths, endX, H, padY, padL]
  );

  const gridLines = compact ? [50] : [0, 25, 50, 75, 100];
  const uid = compact ? 'compact' : 'detail';

  return (
    <div className={`rounded-[18px] border border-white/[0.06] bg-[#0d1520] ${compact ? 'p-6' : 'px-6 pb-6 pt-7 sm:px-8 sm:pt-8'}`}>
      {!compact ? (
        <div className="mb-8 flex items-center justify-start">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 text-xs font-semibold">
            {outcomeSeries.map((series) => (
              <span key={series.label} className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: series.color, boxShadow: `0 0 12px ${series.color}66` }} />
                <span style={{ color: series.color }}>{series.label} {series.odds}%</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <svg
        className="w-full overflow-visible"
        viewBox={`0 0 ${W} ${H}`}
        style={{ height: compact ? 120 : 420 }}
        role="img"
        aria-label="Market probability signal chart"
      >
        <defs>
          <linearGradient id={`yes-fill-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={outcomeSeries[0]?.color ?? '#25c0f4'} stopOpacity="0.26" />
            <stop offset="72%" stopColor={outcomeSeries[0]?.color ?? '#25c0f4'} stopOpacity="0.055" />
            <stop offset="100%" stopColor={outcomeSeries[0]?.color ?? '#25c0f4'} stopOpacity="0" />
          </linearGradient>
          <filter id={`yes-glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {!compact ? (
          <g opacity="0.075" transform={`translate(${W / 2 - 112} ${H / 2 - 18})`}>
            <circle cx="22" cy="23" r="20" stroke="#f8fafc" strokeWidth="2" fill="#25c0f4" fillOpacity="0.08" />
            <circle cx="22" cy="23" r="12.5" stroke="#f8fafc" strokeWidth="2" />
            <circle cx="22" cy="23" r="5.2" fill="#f8fafc" />
            <text x="55" y="31" fill="#f8fafc" fontSize="28" fontWeight="900" fontFamily="sans-serif">Presto Markets</text>
          </g>
        ) : null}

        {gridLines.map((pct) => {
          const y = chartY(pct, H, padY);
          const labelY = pct === 100 ? y + 11 : pct === 0 ? y - 3 : y + 4;
          return (
            <g key={pct}>
              <line
                x1={padL}
                x2={endX}
                y1={y}
                y2={y}
                stroke={pct === 0 || pct === 100 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.12)'}
                strokeWidth={pct === 50 ? 1.2 : 1}
                strokeDasharray={pct === 0 || pct === 100 ? '0' : '3 8'}
                strokeLinecap="round"
              />
              {!compact ? (
                <text x={endX + 10} y={labelY} fill="#64748b" fontSize="12" fontWeight="800" fontFamily="sans-serif">
                  {pct}%
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Area fill for primary outcome */}
        {primaryAreaPath ? <path d={primaryAreaPath} fill={`url(#yes-fill-${uid})`} /> : null}

        {/* Render non-primary traces first (behind), then primary on top */}
        {outcomeSeries.slice(1).map((series, idx) => (
          <path
            key={`line-${series.label}`}
            d={paths[idx + 1]}
            fill="none"
            stroke={series.color}
            strokeWidth={compact ? 1.5 : 1.85}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.72"
          />
        ))}
        {paths[0] ? (
          <path
            d={paths[0]}
            fill="none"
            stroke={outcomeSeries[0].color}
            strokeWidth={compact ? 2 : 2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#yes-glow-${uid})`}
          />
        ) : null}

        {/* End dots for non-primary outcomes */}
        {outcomeSeries.slice(1).map((series) => {
          const endPoint = series.points[series.points.length - 1];
          const endY = chartY(endPoint, H, padY);
          return (
            <circle key={`dot-${series.label}`} cx={endX} cy={endY} r={compact ? 3.8 : 5} fill="#0d1520" stroke={series.color} strokeWidth="1.5" />
          );
        })}
        {/* Primary outcome end dot */}
        {outcomeSeries[0] ? (() => {
          const endPoint = outcomeSeries[0].points[outcomeSeries[0].points.length - 1];
          const endY = chartY(endPoint, H, padY);
          return (
            <>
              <circle cx={endX} cy={endY} r={compact ? 4 : 6} fill={outcomeSeries[0].color} filter={`url(#yes-glow-${uid})`} />
              <circle cx={endX} cy={endY} r={compact ? 2.2 : 3} fill="white" />
            </>
          );
        })() : null}
      </svg>

      {!compact ? (
        <div className="mt-6 flex justify-between px-6 pr-12">
          {['30d ago', '20d ago', '10d ago', 'Now'].map((label) => (
            <span key={label} className="text-[11px] font-bold text-[#334155]">{label}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const MarketSignalChart = memo(MarketSignalChartComponent);
