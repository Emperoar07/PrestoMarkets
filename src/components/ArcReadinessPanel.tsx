'use client';

import { CheckCircle2, Circle, PlugZap, ShieldCheck } from 'lucide-react';
import { getArcReadinessItems } from '@/lib/arcConfig';

export function ArcReadinessPanel() {
  const readinessItems = getArcReadinessItems();

  const steps = [
    {
      label: 'USDC allowance',
      ready: false,
      icon: ShieldCheck,
    },
    {
      label: 'Factory address',
      ready: readinessItems.find((item) => item.label === 'Market factory')?.ready ?? false,
      icon: PlugZap,
    },
  ];

  return (
    <section className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-5">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan">Arc readiness</p>
      <div className="mt-4 grid gap-3">
        {readinessItems.map((item) => (
          <div key={item.label} className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-white">{item.label}</p>
                <p className="mt-1 break-all text-xs leading-5 text-muted">{item.value}</p>
              </div>
              {item.ready ? <CheckCircle2 className="h-5 w-5 shrink-0 text-mint" /> : <Circle className="h-5 w-5 shrink-0 text-muted" />}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center justify-between rounded-[14px] border border-white/[0.06] bg-[#0f172a] px-4 py-3">
            <span className="flex items-center gap-3 text-sm font-bold text-white">
              <step.icon className="h-4 w-4 text-cyan" />
              {step.label}
            </span>
            <span className={step.ready ? 'text-xs font-black text-mint' : 'text-xs font-black text-muted'}>
              {step.ready ? 'Ready' : 'Pending'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
