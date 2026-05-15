import { SiteHeader } from '@/components/SiteHeader';
import { productRails } from '@/lib/productRails';

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
      'USDC collateral only for simple settlement',
      'Templates for macro, policy, governance, product, and opportunity markets',
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
      'Auditable settlement records for higher trust market workflows',
    ],
  },
  {
    title: 'Later',
    label: 'AI and cross chain rails',
    items: [
      'Agent assisted resolution after disputes are designed',
      'Paymaster support for USDC gas flows',
      'Bridge Kit and CCTP for cross chain market funding',
      'Gateway or wallet rails after onboarding choices are final',
      'EURC and multi currency markets after USDC V1 is stable',
    ],
  },
];

const statusStyle = {
  Current: 'border-mint/25 bg-mint/10 text-mint',
  Planned: 'border-cyan/25 bg-cyan/10 text-cyan',
  Later: 'border-line bg-panel2 text-muted',
};

export default function RoadmapPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-12">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-cyan">Roadmap</p>
        <h1 className="mt-3 text-4xl font-black text-white">Phase 2 and Phase 3 plan</h1>
        <p className="mt-3 max-w-3xl text-muted">
          Presto Markets is being built as a public Arc market layer first. The market contracts remain the core product, while Circle and Arc rails are added only where they improve funding, onboarding, or settlement.
        </p>

        <section className="mt-9 grid gap-5 lg:grid-cols-4">
          {phases.map((phase) => (
            <div key={phase.title} className="rounded-3xl border border-line bg-panel p-6">
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

        <section className="mt-10 rounded-3xl border border-line bg-panel">
          <div className="border-b border-line p-6">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Circle product rails</p>
            <h2 className="mt-2 text-2xl font-black text-white">Current and planned integrations</h2>
          </div>
          <div className="grid gap-4 p-6 md:grid-cols-2">
            {productRails.map((rail) => (
              <div key={rail.name} className="rounded-2xl border border-line bg-ink p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-black text-white">{rail.name}</h3>
                    <p className="mt-1 text-sm font-bold text-cyan">{rail.purpose}</p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusStyle[rail.status]}`}>
                    {rail.status}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted">{rail.note}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
