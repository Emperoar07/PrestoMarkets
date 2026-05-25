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

function buildSmoothPath(points: number[], width: number, height: number, offsetX: number) {
  const coords = points.map((p, i) => ({
    x: offsetX + (i / (points.length - 1)) * width,
    y: height - (p / 100) * height,
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

export function MarketSignalChart({ market, compact = false }: { market: MarketSignalChartMarket; compact?: boolean }) {
  const volume = parseUsd(market.volume);
  const liquidity = parseUsd(market.liquidity);

  // Build signal data for every outcome, not just YES/NO
  const outcomeSeries = market.outcomes.map((outcome, index) => {
    const phase = index * (Math.PI / market.outcomes.length);
    const points = buildSignalPoints(outcome.odds, index === 0 ? volume : liquidity, index === 0 ? liquidity : volume, phase);
    return { label: outcome.label, odds: outcome.odds, points, color: getOutcomeColor(index) };
  });

  const W = compact ? 460 : 900;
  const H = compact ? 80 : 320;
  const padL = compact ? 0 : 18;
  const padR = compact ? 0 : 52;
  const chartW = W - padL - padR;
  const endX = padL + chartW;

  const paths = outcomeSeries.map((series) => buildSmoothPath(series.points, chartW, H, padL));
  // Area fill only for the first outcome (primary)
  const primaryAreaPath = paths.length > 0 ? `${paths[0]} L ${endX} ${H} L ${padL} ${H} Z` : '';

  const gridLines = compact ? [50] : [0, 25, 50, 75, 100];
  const uid = compact ? 'compact' : 'detail';

  return (
    <div className={`rounded-[18px] border border-white/[0.06] bg-[#0d1520] ${compact ? 'p-4' : 'p-5 pb-4'}`}>
      {!compact ? (
        <div className="mb-4 flex items-center justify-end gap-4">
          <div className="flex flex-wrap items-center gap-4 text-xs font-black">
            {outcomeSeries.map((series) => (
              <span key={series.label} className="flex items-center gap-1.5">
                <span className="h-2 w-5 rounded-full" style={{ backgroundColor: series.color, boxShadow: series.color === '#25c0f4' ? '0 0 14px rgba(37,192,244,0.45)' : 'none' }} />
                <span style={{ color: series.color }}>{series.label} {series.odds}%</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <svg
        className="w-full overflow-visible"
        viewBox={`0 0 ${W} ${H}`}
        style={{ height: compact ? 80 : 330 }}
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
          const y = H - (pct / 100) * H;
          const labelY = pct === 100 ? y + 11 : pct === 0 ? y - 3 : y + 4;
          return (
            <g key={pct}>
              <line
                x1={padL}
                x2={endX}
                y1={y}
                y2={y}
                stroke={pct === 0 || pct === 100 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.075)'}
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
            strokeWidth={compact ? 1.35 : 1.65}
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
            strokeWidth={compact ? 1.8 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#yes-glow-${uid})`}
          />
        ) : null}

        {/* End dots for non-primary outcomes */}
        {outcomeSeries.slice(1).map((series) => {
          const endPoint = series.points[series.points.length - 1];
          const endY = H - (endPoint / 100) * H;
          return (
            <circle key={`dot-${series.label}`} cx={endX} cy={endY} r={compact ? 3 : 4.5} fill="#0d1520" stroke={series.color} strokeWidth="1.5" />
          );
        })}
        {/* Primary outcome end dot */}
        {outcomeSeries[0] ? (() => {
          const endPoint = outcomeSeries[0].points[outcomeSeries[0].points.length - 1];
          const endY = H - (endPoint / 100) * H;
          return (
            <>
              <circle cx={endX} cy={endY} r={compact ? 3.5 : 5.5} fill={outcomeSeries[0].color} filter={`url(#yes-glow-${uid})`} />
              <circle cx={endX} cy={endY} r={compact ? 2 : 2.6} fill="white" />
            </>
          );
        })() : null}
      </svg>

      {!compact ? (
        <div className="mt-3 flex justify-between px-4 pr-12">
          {['30d ago', '20d ago', '10d ago', 'Now'].map((label) => (
            <span key={label} className="text-[10px] font-bold text-[#334155]">{label}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
