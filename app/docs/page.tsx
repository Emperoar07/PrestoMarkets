import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

const guideSections = [
  {
    title: 'Create a Market',
    copy: 'Write a clear title, pick a category and close date, set a resolver address, describe the source of truth, and define the resolution rules. A review modal shows the full record before the live Arc transaction goes out.',
  },
  {
    title: 'Trade Outcomes',
    copy: 'Presto V1 uses fixed YES and NO shares backed by USDC. A buy deposits USDC and mints outcome shares. There is no sell path or automated market maker in this version — positions are held until settlement.',
  },
  {
    title: 'Resolve and Settle',
    copy: 'After close, only the configured resolver can resolve or cancel. The resolver page includes an agent-assisted evidence console, but settlement buttons stay locked until the resolver verifies the source of truth, confirms rule alignment, and accepts human accountability.',
  },
  {
    title: 'Portfolio',
    copy: 'Portfolio values show actual cost basis, signal marks for open positions, claim previews, refund previews, and realized settlement state. Activity is read from live Arc event logs over a 30 day window.',
  },
];

const liquidityPlan = [
  'Keep the fixed share V1 model as the safety baseline with transparent YES and NO share ratios and no implied exit liquidity.',
  'Add indexed historical trades and maker intent records so liquidity can be measured before it is routed.',
  'Introduce a limit order book style liquidity layer with resting bids and asks, visible spread, depth, minimum order size, and cancelable maker orders.',
  'Only after audits, route market buys through resting liquidity first, then expose maker rewards or fees once the economics have been reviewed.',
];

const terms = [
  'Presto Markets is a testnet application on Arc. It is not financial, legal, tax, or investment advice.',
  'Markets can resolve only according to the written rules, source of truth, and resolver evidence recorded for that market.',
  'Agent-generated evidence is advisory. The configured resolver remains responsible for verifying sources before signing a settlement transaction.',
  'Users are responsible for wallet security, transaction review, and understanding that testnet assets have no guaranteed value.',
  'Do not use real value markets until audit findings, dispute paths, resolver operations, and production risk controls are complete.',
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
              Polymarket style markets make liquidity visible through bids, asks, spreads, and depth. Presto should follow that direction with a limit order book layer later, not an invisible pool that hides execution quality from traders.
            </p>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {liquidityPlan.map((item, index) => (
              <div key={item} className="flex gap-5 p-6">
                <span className="mt-0.5 shrink-0 text-xs font-black uppercase tracking-[0.18em] text-cyan">Phase {index + 1}</span>
                <p className="text-sm leading-6 text-white">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Market charts</p>
          <h2 className="mt-2 text-2xl font-black text-white">What the charts mean</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-5">
              <h3 className="font-black text-white">YES signal</h3>
              <p className="mt-3 text-sm leading-6 text-muted">The chart visualizes the live YES share ratio as a probability signal. It is not a guaranteed exit price and should be read as market sentiment, not a tradeable quote.</p>
            </div>
            <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-5">
              <h3 className="font-black text-white">Liquidity context</h3>
              <p className="mt-3 text-sm leading-6 text-muted">Volume and collateral help show how much activity backs the signal, but V1 liquidity is fixed share settlement. The number reflects participation, not available exit depth.</p>
            </div>
            <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-5">
              <h3 className="font-black text-white">Future depth</h3>
              <p className="mt-3 text-sm leading-6 text-muted">A future order book can add bid and ask depth, spread, marketable orders, and maker liquidity controls once the protocol has been audited and reviewed.</p>
            </div>
          </div>
        </section>

        <section id="terms-of-use" className="mt-10 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
          <div className="border-b border-line p-6">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Terms and risk</p>
            <h2 className="mt-2 text-2xl font-black text-white">Terms of Use</h2>
          </div>
          <div className="divide-y divide-white/[0.06]">
            {terms.map((item) => (
              <p key={item} className="p-6 text-sm leading-6 text-muted">{item}</p>
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
            Presto may use local storage or provider managed browser storage for wallet sessions, UI preferences, and app state. The app does not require tracking cookies for core market reads, but connected providers may use their own browser storage.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
