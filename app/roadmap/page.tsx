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
    title: 'Positioning',
    label: 'Stablecoin information markets',
    items: [
      'Treat markets as public signal infrastructure, not only betting flows',
      'Keep USDC as the first collateral and settlement asset',
      'Use predictable stablecoin costs as a core UX advantage',
      'Design rules, evidence, and settlement records for higher trust markets',
    ],
  },
  {
    title: 'Phase 2',
    label: 'Market workflow',
    items: [
      'Typed prediction, opinion, and opportunity markets',
      'Public rules and source of truth metadata',
      'Creator workflow and market detail views',
      'Live Arc factory reads, creation, trading, resolution, claims, and refunds',
      'Circle email OTP, Google, and PIN wallet onboarding',
      'Inline RainbowKit external EVM wallet connectors',
      'Agent-assisted resolver evidence console with human confirmation gates',
      'Agent-badged markets and gated co-admin market creation endpoint',
    ],
  },
  {
    title: 'Phase 3',
    label: 'Protocol hardening',
    items: [
      'Resolver evidence and resolution URI',
      'Fee recipient and protocol fee scaffolding',
      'Claim previews and refund previews',
      'Factory ownership controls before deployment',
      'Production hardening gate and release checklist',
      'Auditable settlement records for higher trust market workflows',
    ],
  },
  {
    title: 'Later',
    label: 'AI and cross chain rails',
    items: [
      'X API and Grok ingestion for autonomous trend discovery',
      'Autonomous agent resolution only after disputes are designed',
      'Persistent account activity indexing',
      'Paymaster support for USDC gas flows',
      'Bridge Kit and CCTP for cross chain market funding',
      'Gateway after the account model is ready',
      'EURC and multi currency markets after USDC V1 is stable',
    ],
  },
];

const statusStyle = {
  Current: 'border-mint/25 bg-mint/10 text-mint',
  Planned: 'border-cyan/25 bg-cyan/10 text-cyan',
  Later: 'border-line bg-panel2 text-muted',
};

const hardeningStatusStyle: Record<HardeningStatus, string> = {
  Current: 'border-mint/25 bg-mint/10 text-mint',
  Required: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
  Later: 'border-line bg-panel2 text-muted',
};

const severityStyle: Record<AuditFinding['severity'], string> = {
  High: 'border-red-400/25 bg-red-400/10 text-red-100',
  Medium: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
  Low: 'border-cyan/25 bg-cyan/10 text-cyan',
};

export default function RoadmapPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-28 md:px-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Roadmap</p>
        <h1 className="mt-3 text-[clamp(34px,5vw,54px)] font-black tracking-tight text-white">Phase 2 and Phase 3 plan</h1>
        <p className="mt-3 max-w-3xl text-[14px] leading-[1.7] text-muted">
          Presto Markets is being built as a public Arc market layer first. The market contracts remain the core product, while Circle and Arc rails are added only where they improve funding, onboarding, or settlement.
        </p>

        <section className="mt-9 grid gap-5 lg:grid-cols-4">
          {phases.map((phase) => (
            <div key={phase.title} className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">{phase.title}</p>
              <h2 className="mt-3 text-2xl font-black text-white">{phase.label}</h2>
              <ul className="mt-5 space-y-3 text-sm leading-6 text-muted">
                {phase.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="mt-10 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
          <div className="border-b border-line p-6">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Circle product rails</p>
            <h2 className="mt-2 text-2xl font-black text-white">Current and planned integrations</h2>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {productRails.map((rail) => (
              <div key={rail.name} className="flex items-start justify-between gap-6 p-6">
                <div>
                  <h3 className="text-lg font-black text-white">{rail.name}</h3>
                  <p className="mt-1 text-sm font-bold text-cyan">{rail.purpose}</p>
                  <p className="mt-3 text-sm leading-6 text-muted">{rail.note}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-black ${statusStyle[rail.status]}`}>
                  {rail.status}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
          <div className="border-b border-line p-6">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Production hardening</p>
            <h2 className="mt-2 text-2xl font-black text-white">Required before real-value markets</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              Arc finality makes settlement clear once a transaction is final, so Presto needs strong market rules before settlement, resolver evidence, and a reviewed failure path before moving beyond testnet value.
            </p>
          </div>

          <div className="border-b border-line">
            <h3 className="px-6 pt-6 text-sm font-black uppercase tracking-[0.18em] text-[#94a3b8]">Internal contract review findings</h3>
            <div className="divide-y divide-white/[0.06]">
              {contractAuditFindings.map((item) => (
                <div key={item.area} className="flex items-start justify-between gap-4 p-6">
                  <div>
                    <h4 className="text-sm font-black text-white">{item.area}</h4>
                    <p className="mt-3 text-sm leading-6 text-muted">{item.finding}</p>
                    <p className="mt-3 text-sm font-bold leading-6 text-[#dbeafe]">{item.requiredAction}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black ${severityStyle[item.severity]}`}>
                    {item.severity}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 p-6 lg:grid-cols-3">
            <HardeningGroup title="Audit readiness" items={auditReadiness} />
            <HardeningGroup title="Failure paths" items={failurePathDesign} />
            <HardeningGroup title="Later hardening" items={laterHardening} />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function HardeningGroup(input: {
  title: string;
  items: Array<{ title: string; status: HardeningStatus; summary: string }>;
}) {
  return (
    <div>
      <h3 className="text-sm font-black uppercase tracking-[0.18em] text-[#94a3b8]">{input.title}</h3>
      <div className="mt-4 divide-y divide-white/[0.06] rounded-[16px] border border-white/[0.06]">
        {input.items.map((item) => (
          <div key={item.title} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-sm font-black text-white">{item.title}</h4>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black ${hardeningStatusStyle[item.status]}`}>
                {item.status}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted">{item.summary}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
