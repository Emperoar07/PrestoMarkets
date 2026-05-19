import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { productRails } from '@/lib/productRails';
import {
  auditReadiness,
  contractAuditFindings,
  failurePathDesign,
  laterHardening,
  type AuditFinding,
  type HardeningStatus,
} from '@/lib/productionHardening';

const phases = [
  {
    title: 'Shipping now',
    items: [
      'Live Arc factory: create, trade, resolve, claim, refund',
      'Circle user-controlled wallet signing for all Arc transactions',
      'External EVM wallets via RainbowKit',
      'Autonomous agent registered on ERC-8004 (ID 16339)',
      'Incremental localStorage cost-basis indexer',
      'EURC and USDC collateral selector',
    ],
  },
  {
    title: 'Next',
    items: [
      'Persistent activity index (Vercel KV or Postgres)',
      'Dispute window with bonded challenges before payouts finalize',
      'Sell path / AMM exit before settlement',
      'Paymaster so users skip native gas entirely',
    ],
  },
  {
    title: 'Later',
    items: [
      'Bridge Kit + CCTP for cross-chain market funding',
      'Gateway for unified multi-chain USDC balance',
      'Multi-currency markets beyond USDC / EURC',
      'Mainnet launch after audit + dispute design',
    ],
  },
];

const statusDot: Record<'Current' | 'Planned' | 'Later', string> = {
  Current: 'text-mint',
  Planned: 'text-cyan',
  Later: 'text-muted',
};

const hardeningDot: Record<HardeningStatus, string> = {
  Current: 'text-mint',
  Required: 'text-amber-200',
  Later: 'text-muted',
};

const severityDot: Record<AuditFinding['severity'], string> = {
  High: 'text-red-300',
  Medium: 'text-amber-200',
  Low: 'text-cyan',
};

export default function RoadmapPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-28 md:px-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Roadmap</p>
        <h1 className="mt-3 text-[clamp(32px,4vw,46px)] font-black tracking-tight text-white">Where Presto is, and what's next.</h1>
        <p className="mt-4 text-[15px] leading-7 text-muted">
          Markets first, infrastructure after. We add Circle and Arc rails when they meaningfully improve onboarding, funding, or settlement — not before.
        </p>

        {phases.map((phase) => (
          <section key={phase.title} className="mt-12 border-t border-white/[0.06] pt-8">
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">{phase.title}</h2>
            <ul className="mt-5 space-y-3 text-[15px] leading-7 text-white/90">
              {phase.items.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan/60" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Circle &amp; Arc rails</h2>
          <ul className="mt-5 divide-y divide-white/[0.04]">
            {productRails.map((rail) => (
              <li key={rail.name} className="flex items-baseline justify-between gap-6 py-4">
                <div>
                  <h3 className="text-[15px] font-black text-white">{rail.name}</h3>
                  <p className="mt-1 text-[14px] leading-6 text-muted">{rail.note}</p>
                </div>
                <span className={`shrink-0 text-[11px] font-black uppercase tracking-widest ${statusDot[rail.status]}`}>
                  · {rail.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Production hardening</h2>
          <p className="mt-4 text-[14px] leading-7 text-muted">
            Arc finality is fast and final — so the bar lives in market rules, resolver evidence, and failure paths, not in the settlement layer.
          </p>

          <h3 className="mt-8 text-[11px] font-black uppercase tracking-[0.18em] text-white/60">Contract review</h3>
          <ul className="mt-3 divide-y divide-white/[0.04]">
            {contractAuditFindings.map((item) => (
              <li key={item.area} className="py-4">
                <div className="flex items-baseline justify-between gap-4">
                  <h4 className="text-[14px] font-black text-white">{item.area}</h4>
                  <span className={`shrink-0 text-[11px] font-black uppercase tracking-widest ${severityDot[item.severity]}`}>
                    · {item.severity}
                  </span>
                </div>
                <p className="mt-2 text-[14px] leading-6 text-muted">{item.finding}</p>
                <p className="mt-1 text-[13px] leading-6 text-white/70">→ {item.requiredAction}</p>
              </li>
            ))}
          </ul>

          <HardeningList title="Audit readiness" items={auditReadiness} />
          <HardeningList title="Failure paths" items={failurePathDesign} />
          <HardeningList title="Later hardening" items={laterHardening} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function HardeningList(input: { title: string; items: Array<{ title: string; status: HardeningStatus; summary: string }> }) {
  return (
    <>
      <h3 className="mt-8 text-[11px] font-black uppercase tracking-[0.18em] text-white/60">{input.title}</h3>
      <ul className="mt-3 divide-y divide-white/[0.04]">
        {input.items.map((item) => (
          <li key={item.title} className="py-4">
            <div className="flex items-baseline justify-between gap-4">
              <h4 className="text-[14px] font-black text-white">{item.title}</h4>
              <span className={`shrink-0 text-[11px] font-black uppercase tracking-widest ${hardeningDot[item.status]}`}>
                · {item.status}
              </span>
            </div>
            <p className="mt-2 text-[14px] leading-6 text-muted">{item.summary}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
