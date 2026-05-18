import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

const guideSections = [
  {
    title: 'Create a Market',
    copy: 'Write a clear title, category, close date, resolver address, source of truth, and resolution rules. The review modal appears before the live Arc transaction is submitted.',
  },
  {
    title: 'Trade Outcomes',
    copy: 'Presto V1 uses fixed YES and NO shares backed by USDC. A buy deposits USDC and mints outcome shares; there is no sell path or AMM in this version.',
  },
  {
    title: 'Resolve and Settle',
    copy: 'After close, only the configured resolver can resolve or cancel. Resolved markets expose evidence URI, winning outcome, claim preview, and refund preview from contract state.',
  },
  {
    title: 'Portfolio',
    copy: 'Portfolio values show cost basis, signal marks, claim previews, refund previews, and realized settlement state. Recent activity still depends on recent Arc log reads.',
  },
];

const liquidityPlan = [
  'Phase A: keep fixed-share V1 as the safety baseline, with transparent YES/NO share ratios and no implied exit liquidity.',
  'Phase B: add indexed historical trades and maker intent records so liquidity can be measured before it is routed.',
  'Phase C: introduce a CLOB-style liquidity layer with resting bids and asks, visible spread, depth, minimum order size, and cancelable maker orders.',
  'Phase D: only after audits, route market buys through resting liquidity first, then expose maker rewards or fees if the economics are reviewed.',
];

const terms = [
  'Presto Markets is a testnet application on Arc. It is not financial, legal, tax, or investment advice.',
  'Markets can resolve only according to the written rules, source of truth, and resolver evidence recorded for that market.',
  'Users are responsible for wallet security, transaction review, and understanding that testnet assets have no guaranteed value.',
  'Do not use real-value markets until audit findings, dispute paths, resolver operations, and production risk controls are complete.',
  'Circle Wallets, RainbowKit, Arc, and other product rails remain independent services with their own terms and operational requirements.',
];

export default function DocsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-28 md:px-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Docs</p>
        <h1 className="mt-3 text-[clamp(34px,5vw,54px)] font-black tracking-tight text-white">Presto Markets guide</h1>
        <p className="mt-3 max-w-3xl text-[14px] leading-[1.7] text-muted">
          A practical guide to the current app, market rules, settlement flow, risk terms, and the planned liquidity path for Presto Markets on Arc testnet.
        </p>

        <section className="mt-9 grid gap-5 md:grid-cols-2">
          {guideSections.map((section) => (
            <div key={section.title} className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
              <h2 className="text-2xl font-black text-white">{section.title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted">{section.copy}</p>
            </div>
          ))}
        </section>

        <section className="mt-10 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
          <div className="border-b border-line p-6">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Liquidity design</p>
            <h2 className="mt-2 text-2xl font-black text-white">How Presto should add liquidity</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              Polymarket-style markets make liquidity visible through bids, asks, spreads, and depth. Presto should follow that direction with a CLOB-style layer later, not an invisible pool that hides execution quality.
            </p>
          </div>
          <div className="grid gap-3 p-6">
            {liquidityPlan.map((item, index) => (
              <div key={item} className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan">Step {index + 1}</p>
                <p className="mt-2 text-sm font-bold leading-6 text-white">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
          <div className="border-b border-line p-6">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Market charts</p>
            <h2 className="mt-2 text-2xl font-black text-white">What the charts mean</h2>
          </div>
          <div className="grid gap-4 p-6 md:grid-cols-3">
            <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
              <h3 className="font-black text-white">YES signal</h3>
              <p className="mt-3 text-sm leading-6 text-muted">The chart currently visualizes the live YES share ratio as a probability signal, not a guaranteed exit price.</p>
            </div>
            <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
              <h3 className="font-black text-white">Liquidity context</h3>
              <p className="mt-3 text-sm leading-6 text-muted">Volume and collateral help show how much activity backs the signal, but V1 liquidity is still fixed-share settlement.</p>
            </div>
            <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
              <h3 className="font-black text-white">Future depth</h3>
              <p className="mt-3 text-sm leading-6 text-muted">A future CLOB can add bid/ask depth, spread, marketable orders, and maker liquidity controls after protocol review.</p>
            </div>
          </div>
        </section>

        <section id="terms-of-use" className="mt-10 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
          <div className="border-b border-line p-6">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Terms and risk</p>
            <h2 className="mt-2 text-2xl font-black text-white">Terms of Use</h2>
          </div>
          <div className="grid gap-3 p-6">
            {terms.map((item) => (
              <p key={item} className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5 text-sm leading-6 text-muted">
                {item}
              </p>
            ))}
          </div>
        </section>

        <section id="privacy-policy" className="mt-10 rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Legal</p>
          <h2 className="mt-2 text-2xl font-black text-white">Privacy Policy</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Presto stores wallet connection state locally in the browser so the app can read live Arc market positions. Circle Wallets, RainbowKit, Vercel, and wallet providers may process data under their own policies. Do not enter private keys or sensitive personal information into market metadata.
          </p>
        </section>

        <section id="cookie-policy" className="mt-10 rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Legal</p>
          <h2 className="mt-2 text-2xl font-black text-white">Cookie Policy</h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            Presto may use local storage or provider-managed browser storage for wallet sessions, UI preferences, and app state. The app does not require tracking cookies for core market reads, but connected providers may use their own browser storage.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
