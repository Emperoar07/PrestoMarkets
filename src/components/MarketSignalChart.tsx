import type { Market } from '@/lib/markets';

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
  const yesOdds = market.outcomes.find((o) => o.label === 'YES')?.odds ?? 50;
  const noOdds = market.outcomes.find((o) => o.label === 'NO')?.odds ?? 100 - yesOdds;
  const volume = parseUsd(market.volume);
  const liquidity = parseUsd(market.liquidity);

  const yesPoints = buildSignalPoints(yesOdds, volume, liquidity);
  const noPoints = buildSignalPoints(noOdds, liquidity, volume, Math.PI);

  const W = compact ? 460 : 900;
  const H = compact ? 80 : 320;
  const padL = compact ? 0 : 18;
  const padR = compact ? 0 : 52;
  const chartW = W - padL - padR;
  const endX = padL + chartW;

  const yesPath = buildSmoothPath(yesPoints, chartW, H, padL);
  const noPath = buildSmoothPath(noPoints, chartW, H, padL);
  const yesAreaPath = `${yesPath} L ${endX} ${H} L ${padL} ${H} Z`;

  const yesEnd = yesPoints[yesPoints.length - 1];
  const noEnd = noPoints[noPoints.length - 1];
  const yesEndY = H - (yesEnd / 100) * H;
  const noEndY = H - (noEnd / 100) * H;
  const gridLines = compact ? [50] : [0, 25, 50, 75, 100];
  const uid = compact ? 'compact' : 'detail';

  return (
    <div className={`rounded-[18px] border border-white/[0.06] bg-[#0d1520] ${compact ? 'p-4' : 'p-5 pb-4'}`}>
      {!compact ? (
        <div className="mb-4 flex items-center justify-end gap-4">
          <div className="flex items-center gap-4 text-xs font-black">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-5 rounded-full bg-[#25c0f4] shadow-[0_0_14px_rgba(37,192,244,0.45)]" />
              <span className="text-[#25c0f4]">YES {yesOdds}%</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-5 rounded-full bg-red-400" />
              <span className="text-red-300">NO {noOdds}%</span>
            </span>
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
            <stop offset="0%" stopColor="#25c0f4" stopOpacity="0.26" />
            <stop offset="72%" stopColor="#25c0f4" stopOpacity="0.055" />
            <stop offset="100%" stopColor="#25c0f4" stopOpacity="0" />
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

        <path d={yesAreaPath} fill={`url(#yes-fill-${uid})`} />

        <path
          d={noPath}
          fill="none"
          stroke="#f87171"
          strokeWidth={compact ? 1.35 : 1.65}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.72"
        />
        <path
          d={yesPath}
          fill="none"
          stroke="#25c0f4"
          strokeWidth={compact ? 1.8 : 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#yes-glow-${uid})`}
        />

        <circle cx={endX} cy={noEndY} r={compact ? 3 : 4.5} fill="#0d1520" stroke="#f87171" strokeWidth="1.5" />
        <circle cx={endX} cy={yesEndY} r={compact ? 3.5 : 5.5} fill="#25c0f4" filter={`url(#yes-glow-${uid})`} />
        <circle cx={endX} cy={yesEndY} r={compact ? 2 : 2.6} fill="white" />
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
