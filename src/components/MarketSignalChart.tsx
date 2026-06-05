import { memo, useEffect, useMemo, useState } from 'react';
import type { Market } from '@/lib/markets';
import { getOutcomeColor } from '@/lib/outcomeColors';

type MarketSignalChartMarket = Pick<Market, 'id' | 'outcomes' | 'volume' | 'liquidity'>;

const DETAIL_TABS = ['1D', '1W', '1M', 'All'];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getChartColor(index: number, count: number) {
  return getOutcomeColor(index);
}

function getAxis(points: number[][], outcomeCount: number) {
  return { max: 100, ticks: [100, 75, 50, 25, 0] };
}

function chartY(point: number, height: number, paddingY: number, max: number) {
  return paddingY + (1 - point / max) * (height - paddingY * 2);
}

function buildStepPath(points: number[], width: number, height: number, offsetX: number, paddingY: number, max: number) {
  const coords = points.map((p, i) => ({
    x: offsetX + (i / Math.max(1, points.length - 1)) * width,
    y: chartY(p, height, paddingY, max),
  }));

  let path = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const midX = (prev.x + curr.x) / 2;
    path += ` L ${midX.toFixed(1)} ${prev.y.toFixed(1)} L ${midX.toFixed(1)} ${curr.y.toFixed(1)} L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }
  return path;
}

function MarketSignalChartComponent({ market, compact = false, live = false }: { market: MarketSignalChartMarket; compact?: boolean; live?: boolean }) {
  const [activeTab, setActiveTab] = useState<string>('1D');
  const [rawHistory, setRawHistory] = useState<Array<{ t: number; probabilities: number[] }> | null>(null);

  useEffect(() => {
    if (!live || !market.id) return undefined;
    let cancelled = false;
    fetch(`/api/markets/${market.id}/history`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const history: Array<{ t: number; probabilities: number[] }> = data?.history ?? [];
        if (cancelled) return;
        setRawHistory(history);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live, market.id]);

  const filteredHistory = useMemo(() => {
    if (!rawHistory || rawHistory.length === 0) return null;
    const now = Date.now();
    const rangeMs =
      activeTab === '1D'
        ? 24 * 60 * 60 * 1000
        : activeTab === '1W'
        ? 7 * 24 * 60 * 60 * 1000
        : activeTab === '1M'
        ? 30 * 24 * 60 * 60 * 1000
        : Infinity;

    const filtered = rawHistory.filter((point) => now - point.t <= rangeMs);
    if (filtered.length < 2) return null;
    return filtered;
  }, [rawHistory, activeTab]);

  const realSeries = useMemo(() => {
    if (!filteredHistory) return null;
    return market.outcomes.map((_, index) =>
      filteredHistory.map((point) => (point.probabilities[index] ?? 0) * 100)
    );
  }, [filteredHistory, market.outcomes.length]);

  const timeLabels = useMemo(() => {
    if (activeTab === '1D') return ['24h ago', '16h ago', '8h ago', 'Now'];
    if (activeTab === '1W') return ['7d ago', '5d ago', '3d ago', 'Now'];
    return ['30d ago', '20d ago', '10d ago', 'Now'];
  }, [activeTab]);

  const W = compact ? 460 : 1000;
  const H = compact ? 120 : 336;
  const padL = compact ? 0 : 32;
  const padR = compact ? 0 : 68;
  const padY = compact ? 14 : 32;
  const chartW = W - padL - padR;
  const endX = padL + chartW;
  const uid = compact ? 'compact' : 'detail';

  const outcomeSeries = useMemo(
    () =>
      market.outcomes.map((outcome, index) => {
        const real = realSeries?.[index];
        const useReal = Boolean(real && real.length >= 2);
        const points = useReal
          ? (real as number[]).map((point) => clamp(point, 1, 99))
          : [outcome.odds, outcome.odds].map((point) => clamp(point, 1, 99));
        const odds = useReal ? Math.round(points[points.length - 1]) : outcome.odds;
        return {
          label: outcome.label,
          odds,
          points,
          color: getChartColor(index, market.outcomes.length),
        };
      }),
    [market.outcomes, realSeries]
  );
  const hasRealHistory = Boolean(realSeries);

  const axis = useMemo(() => getAxis(outcomeSeries.map((series) => series.points), outcomeSeries.length), [outcomeSeries]);
  const paths = useMemo(
    () => outcomeSeries.map((series) => buildStepPath(series.points, chartW, H, padL, padY, axis.max)),
    [outcomeSeries, chartW, H, padL, padY, axis.max]
  );

  if (compact) {
    return (
      <div className="rounded-[18px] border border-white/[0.06] bg-[#0d1520] p-6">
        <svg className="w-full overflow-visible" viewBox={`0 0 ${W} ${H}`} style={{ height: H }} role="img" aria-label="Market probability signal chart">
          <defs>
            <filter id={`presto-glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <line x1={padL} x2={endX} y1={chartY(axis.max / 2, H, padY, axis.max)} y2={chartY(axis.max / 2, H, padY, axis.max)} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 8" strokeLinecap="round" />
          {outcomeSeries.map((series, index) => (
            <path
              key={series.label}
              d={paths[index]}
              fill="none"
              stroke={series.color}
              strokeWidth={index === 0 ? 2 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={index === 0 ? 1 : 0.76}
              filter={index === 0 ? `url(#presto-glow-${uid})` : undefined}
            />
          ))}
        </svg>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap gap-2">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-full px-4 py-2 text-sm font-black transition-all ${
              tab === activeTab
                ? 'bg-cyan/15 text-cyan'
                : 'bg-white/[0.06] text-[#d6e2f2] hover:bg-white/[0.1]'
            }`}
            aria-pressed={tab === activeTab}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="relative">
        {!compact && live && !hasRealHistory ? (
          <p className="absolute right-0 top-0 z-20 text-[11px] font-black uppercase tracking-[0.14em] text-muted">
            Current odds only
          </p>
        ) : null}
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center gap-4 text-[clamp(28px,4vw,54px)] font-black text-white/[0.07]">
          <span className="relative h-[58px] w-[58px] rounded-full border-[5px] border-cyan/15 shadow-[inset_0_0_0_11px_rgba(37,200,255,0.04)] after:absolute after:inset-4 after:rounded-full after:bg-cyan/15" />
          <span>Presto Markets</span>
        </div>

        <svg
          className="relative z-10 w-full overflow-visible"
          viewBox={`0 0 ${W} ${H}`}
          style={{ height: H }}
          role="img"
          aria-label="Market probability signal chart"
        >
          <defs>
            <filter id={`presto-glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {axis.ticks.map((pct) => {
            const y = chartY(pct, H, padY, axis.max);
            const labelY = pct === axis.max ? y + 11 : pct === 0 ? y - 3 : y + 4;
            return (
              <g key={pct}>
                <line
                  x1={padL}
                  x2={endX}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
                <text x={endX + 10} y={labelY} fill="#7f92ad" fontSize="13" fontWeight="800" fontFamily="sans-serif">
                  {pct}%
                </text>
              </g>
            );
          })}

          {outcomeSeries.map((series, index) => (
            <path
              key={`line-${series.label}`}
              d={paths[index]}
              fill="none"
              stroke={series.color}
              strokeWidth={index === 0 ? 2.6 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={index === 0 ? 1 : 0.95}
              filter={index === 0 ? `url(#presto-glow-${uid})` : undefined}
            />
          ))}

          {outcomeSeries.map((series) => {
            const endPoint = series.points[series.points.length - 1];
            const endY = chartY(endPoint, H, padY, axis.max);
            return (
              <circle
                key={`dot-${series.label}`}
                cx={endX}
                cy={endY}
                r="4.8"
                fill={series.color}
                stroke="#0d1520"
                strokeWidth="2"
              />
            );
          })}

          {timeLabels.map((label, index, labels) => {
            const x = padL + (chartW * index) / Math.max(1, labels.length - 1);
            return (
              <text key={label} x={x - 10} y={H - 12} fill="#7f92ad" fontSize="13" fontWeight="800" fontFamily="sans-serif">
                {label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export const MarketSignalChart = memo(MarketSignalChartComponent);
