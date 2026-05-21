import type { Market } from '@/lib/markets';

type MarketSignalChartMarket = Pick<Market, 'outcomes' | 'status' | 'volume' | 'liquidity'>;

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
  return Array.from({ length: 80 }, (_, i) => {
    const slow = Math.sin(i * 0.11 + phase) * 5.5;
    const mid = Math.sin(i * 0.38 + phase * 1.3) * 2.8;
    const fast = Math.sin(i * 1.2 + phase * 0.7) * 1.1;
    const drift = (i - 40) * depthBias * 0.06;
    const spike = i > 58 && i < 68 ? Math.sin((i - 58) * 0.55 + phase) * 9 : 0;
    return clamp(baseOdds + slow + mid + fast + drift + spike, 3, 97);
  });
}

function buildSmoothPath(points: number[], width: number, height: number): string {
  const coords = points.map((p, i) => ({
    x: (i / (points.length - 1)) * width,
    y: height - (p / 100) * height,
  }));

  let path = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const cp = (curr.x - prev.x) * 0.4;
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

  const W = 460;
  const H = compact ? 80 : 260;
  const PAD_R = compact ? 0 : 38;
  const chartW = W - PAD_R;

  const yesPath = buildSmoothPath(yesPoints, chartW, H);
  const noPath = buildSmoothPath(noPoints, chartW, H);
  const yesAreaPath = `${yesPath} L ${chartW} ${H} L 0 ${H} Z`;

  const yesEnd = yesPoints[yesPoints.length - 1];
  const noEnd = noPoints[noPoints.length - 1];
  const yesEndY = H - (yesEnd / 100) * H;
  const noEndY = H - (noEnd / 100) * H;

  const gridLines = compact ? [50] : [0, 25, 50, 75, 100];
  const uid = compact ? 'c' : 'd';

  return (
    <div className={`rounded-[16px] border border-white/[0.06] bg-[#0d1520] ${compact ? 'p-4' : 'p-5 pb-4'}`}>
      {!compact ? (
        <div className="mb-5 flex items-center justify-end gap-4">
          <div className="flex items-center gap-4 text-xs font-bold">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-5 rounded-full bg-[#25c0f4]" />
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
        style={{ height: compact ? 80 : 260 }}
        role="img"
        aria-label="Market probability signal chart"
      >
        <defs>
          {/* YES gradient fill */}
          <linearGradient id={`yes-fill-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#25c0f4" stopOpacity="0.22" />
            <stop offset="75%" stopColor="#25c0f4" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#25c0f4" stopOpacity="0" />
          </linearGradient>
          {/* NO gradient fill */}
          <linearGradient id={`no-fill-${uid}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f87171" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
          </linearGradient>
          {/* YES glow filter */}
          <filter id={`yes-glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* NO glow filter */}
          <filter id={`no-glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {gridLines.map((pct) => {
          const y = H - (pct / 100) * H;
          const labelY = pct === 100 ? y + 11 : pct === 0 ? y - 3 : y + 4;
          return (
            <g key={pct}>
              <line
                x1="0" x2={chartW} y1={y} y2={y}
                stroke={pct === 0 || pct === 100 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.07)'}
                strokeDasharray={pct === 0 || pct === 100 ? '0' : '3 8'}
                strokeLinecap="round"
              />
              {!compact ? (
                <text x={chartW + 8} y={labelY} fill="#475569" fontSize="10" fontWeight="700" fontFamily="sans-serif">
                  {pct}%
                </text>
              ) : null}
            </g>
          );
        })}

        {/* YES area fill */}
        <path d={yesAreaPath} fill={`url(#yes-fill-${uid})`} />

        {/* NO line */}
        <path
          d={noPath}
          fill="none"
          stroke="#f87171"
          strokeWidth={compact ? 1.4 : 1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.6"
        />

        {/* YES line — primary, glowing */}
        <path
          d={yesPath}
          fill="none"
          stroke="#25c0f4"
          strokeWidth={compact ? 1.8 : 2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#yes-glow-${uid})`}
        />

        {/* Endpoint dots */}
        {/* NO dot */}
        <circle cx={chartW} cy={noEndY} r={compact ? 3 : 4} fill="#0d1520" stroke="#f87171" strokeWidth="1.5" />
        {/* YES dot — larger, glowing */}
        <circle cx={chartW} cy={yesEndY} r={compact ? 3.5 : 5} fill="#25c0f4" filter={`url(#yes-glow-${uid})`} />
        <circle cx={chartW} cy={yesEndY} r={compact ? 2 : 3} fill="white" />
      </svg>

      {/* Bottom time axis */}
      {!compact ? (
        <div className="mt-3 flex justify-between pr-9">
          {['30d ago', '20d ago', '10d ago', 'Now'].map((label) => (
            <span key={label} className="text-[10px] font-bold text-[#334155]">{label}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
