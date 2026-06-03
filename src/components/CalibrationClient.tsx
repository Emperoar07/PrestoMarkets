'use client';

import { useMemo } from 'react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { useAppState } from '@/lib/appState';
import { computeAgentCalibration } from '@/lib/marketCalibration';

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[14px] border border-white/[0.06] bg-[#141e30] p-5">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted">{label}</p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function CalibrationClient() {
  const { markets, isLoadingMarkets } = useAppState();
  const agentMarkets = useMemo(() => markets.filter((m) => m.createdByType === 'agent'), [markets]);
  const cal = useMemo(() => computeAgentCalibration(agentMarkets), [agentMarkets]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-5 pb-20 pt-32 md:px-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Agent accountability</p>
        <h1 className="mt-3 text-[clamp(28px,4vw,40px)] font-black tracking-tight text-white">Calibration</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted">
          Does the agent&apos;s confidence match reality? This page scores every resolved binary market the
          agent created, treating its logged confidence as the probability of the YES outcome. Non-binary or
          unresolved markets are excluded from the scores but still counted in settlement health.
        </p>

        {isLoadingMarkets ? (
          <p className="mt-10 text-sm text-muted">Loading markets…</p>
        ) : (
          <>
            <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Agent markets" value={String(cal.totalMarkets)} hint={`${cal.resolved} resolved · ${cal.canceled} canceled · ${cal.open} open`} />
              <Stat label="Brier score" value={cal.brier === null ? '—' : cal.brier.toFixed(3)} hint="Lower is better (0 = perfect)" />
              <Stat label="Accuracy" value={pct(cal.accuracy)} hint={`${cal.scored} scored markets`} />
              <Stat label="Resolution rate" value={pct(cal.resolutionRate)} hint="Settled vs cancel-and-refund" />
            </section>

            <section className="mt-10">
              <h2 className="text-base font-black text-white">Reliability by confidence</h2>
              <p className="mt-1.5 text-sm text-muted">Well-calibrated means predicted ≈ observed in each band.</p>
              {cal.buckets.length === 0 ? (
                <p className="mt-4 text-sm text-muted">No resolved binary markets to score yet.</p>
              ) : (
                <div className="mt-4 overflow-hidden rounded-[14px] border border-white/[0.06]">
                  <table className="w-full text-sm">
                    <thead className="bg-[#141e30] text-[10px] font-black uppercase tracking-widest text-muted">
                      <tr>
                        <th className="px-4 py-3 text-left">Confidence band</th>
                        <th className="px-4 py-3 text-right">Predicted</th>
                        <th className="px-4 py-3 text-right">Observed YES</th>
                        <th className="px-4 py-3 text-right">Markets</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cal.buckets.map((bucket) => (
                        <tr key={bucket.label} className="border-t border-white/[0.06]">
                          <td className="px-4 py-3 font-bold text-white">{bucket.label}</td>
                          <td className="px-4 py-3 text-right text-muted">{pct(bucket.predictedAvg)}</td>
                          <td className="px-4 py-3 text-right text-white">{pct(bucket.observedYesRate)}</td>
                          <td className="px-4 py-3 text-right text-muted">{bucket.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {cal.outcomeSplit.length > 0 ? (
              <section className="mt-10">
                <h2 className="text-base font-black text-white">Resolved outcomes</h2>
                <div className="mt-4 flex flex-wrap gap-2">
                  {cal.outcomeSplit.map((entry) => (
                    <span key={entry.label} className="rounded-full border border-white/[0.08] bg-[#141e30] px-3 py-1.5 text-sm text-white">
                      {entry.label} <span className="font-black text-cyan">{entry.count}</span>
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            <p className="mt-10 text-xs leading-6 text-muted">
              Method: confidence parsed from the agent&apos;s logged value; a market is &quot;correct&quot; when the
              side above 50% won. Brier = mean squared error between predicted probability and the realized
              outcome. As more markets resolve, these numbers sharpen.
            </p>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
