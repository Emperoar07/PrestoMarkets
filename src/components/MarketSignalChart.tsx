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

function buildSignalPoints(baseOdds: number, volume: number, liquidity: number, phase = 0) {
  const depthBias = liquidity > 0 ? clamp(volume / Math.max(liquidity, 1), 0.15, 2.2) : 0.6;

  return Array.from({ length: 72 }, (_, index) => {
    const jitter = Math.sin((index + 1) * 1.7 + phase) * 1.4;
    const pulse = Math.sin((index + 1) * 0.21 + phase) * 3.2;
    const ramp = (index - 36) * depthBias * 0.08;
    const spike = index > 52 && index < 60 ? Math.sin(index * 2.1 + phase) * 8 : 0;
    return clamp(baseOdds + jitter + pulse + ramp + spike, 4, 96);
  });
}

function buildPath(points: number[], width: number, height: number) {
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - (point / 100) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export function MarketSignalChart({ market, compact = false }: { market: MarketSignalChartMarket; compact?: boolean }) {
  const yesOdds = market.outcomes.find((outcome) => outcome.label === 'YES')?.odds ?? 50;
  const noOdds = market.outcomes.find((outcome) => outcome.label === 'NO')?.odds ?? 100 - yesOdds;
  const volume = parseUsd(market.volume);
  const liquidity = parseUsd(market.liquidity);
  const yesPoints = buildSignalPoints(yesOdds, volume, liquidity);
  const noPoints = buildSignalPoints(noOdds, liquidity, volume, Math.PI);
  const width = 360;
  const height = compact ? 96 : 150;
  const yesPath = buildPath(yesPoints, width, height);
  const noPath = buildPath(noPoints, width, height);
  const areaPath = `${yesPath} L ${width} ${height} L 0 ${height} Z`;
  const yesEnd = yesPoints[yesPoints.length - 1];
  const noEnd = noPoints[noPoints.length - 1];

  return (
    <div className={`rounded-[14px] border border-white/[0.06] bg-[#0f172a] ${compact ? 'p-3' : 'p-5'}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Signal chart</p>
          {!compact ? (
            <p className="mt-1 text-sm leading-6 text-muted">YES and NO probability signals from live share ratios.</p>
          ) : null}
        </div>
      </div>

      {!compact ? (
        <div className="mt-4 flex flex-wrap gap-4 text-xs font-bold text-[#8fa0b4]">
          <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-mint" />YES {yesOdds}%</span>
          <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-400" />NO {noOdds}%</span>
        </div>
      ) : null}

      <svg className="mt-4 h-auto w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Market YES and NO signal chart">
        <defs>
          <linearGradient id={`signal-fill-${compact ? 'compact' : 'detail'}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#25c0f4" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#25c0f4" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[25, 50, 75, 100].map((line) => {
          const y = height - (line / 100) * height;
          return (
            <g key={line}>
              <line x1="0" x2={width} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="2 7" />
              {!compact ? (
                <text x={width + 7} y={y + 4} fill="#8fa0b4" fontSize="10" fontWeight="700">
                  {line}%
                </text>
              ) : null}
            </g>
          );
        })}
        <path d={areaPath} fill={`url(#signal-fill-${compact ? 'compact' : 'detail'})`} />
        <path d={yesPath} fill="none" stroke="#22c55e" strokeLinecap="round" strokeLinejoin="round" strokeWidth={compact ? 1.6 : 2} />
        <path d={noPath} fill="none" stroke="#ef4444" strokeLinecap="round" strokeLinejoin="round" strokeWidth={compact ? 1.6 : 2} />
        <circle cx={width} cy={height - (yesEnd / 100) * height} r={compact ? 2.6 : 4} fill="#22c55e" />
        <circle cx={width} cy={height - (noEnd / 100) * height} r={compact ? 2.6 : 4} fill="#ef4444" />
      </svg>

      <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-[12px] border border-white/[0.06]">
        <div className="bg-cyan/10 p-3">
          <p className="text-[11px] font-bold text-muted">YES</p>
          <p className="mt-1 text-xl font-black text-mint">{yesOdds}%</p>
        </div>
        <div className="border-l border-white/[0.06] bg-white/[0.03] p-3">
          <p className="text-[11px] font-bold text-muted">NO</p>
          <p className="mt-1 text-xl font-black text-red-300">{noOdds}%</p>
        </div>
      </div>
    </div>
  );
}
