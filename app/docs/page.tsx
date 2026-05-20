import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

const guide = [
  {
    h: 'Create a market',
    p: 'Anyone can create a market from the app. Pick a type (Prediction, Opinion, Opportunity), set the close date, write the rules + source of truth, assign a resolver. The autonomous agent can also draft and post markets. Those carry an Agent badge.',
  },
  {
    h: 'Trade',
    p: 'V1 mints fixed YES / NO shares against USDC. Buying deposits collateral and mints shares. There is no sell path or AMM. Positions are held to settlement.',
  },
  {
    h: 'Resolve and settle',
    p: 'After close, only the configured resolver can resolve or cancel. The resolver console surfaces agent-assisted evidence, but the settle button stays locked until the resolver verifies the source of truth themselves.',
  },
  {
    h: 'Portfolio',
    p: 'Shows actual cost basis (indexed incrementally in your browser), open-position signal marks, claim previews, refund previews, and realized payouts. Activity reads live Arc logs.',
  },
];

const liquidity = [
  'Keep V1 fixed-share settlement as the honest baseline, with no hidden exit liquidity.',
  'Index historical trades and maker intent so depth is measurable.',
  'Add a limit order book layer: resting bids/asks, visible spread, cancelable maker orders.',
  'After audit, route market buys through resting liquidity first; price in maker rewards.',
];

const terms = [
  'Testnet application. Not financial, legal, tax, or investment advice.',
  'Markets resolve only by the written rules, source of truth, and evidence recorded for that market.',
  'Agent-generated evidence is advisory. The resolver signs settlement and bears responsibility.',
  'Agent-created markets are labeled, but review rules and close time yourself before trading.',
  'You are responsible for wallet security and transaction review. Testnet assets have no guaranteed value.',
  'Do not run real-value markets until audit + dispute paths are complete.',
  'Circle, RainbowKit, Arc, Vercel each have their own terms. They apply.',
];

export default function DocsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-36 md:px-7 md:pt-40">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Docs</p>
        <h1 className="mt-3 text-[clamp(32px,4vw,46px)] font-black tracking-tight text-white">How Presto works.</h1>
        <p className="mt-4 text-[15px] leading-7 text-muted">
          A short guide to the current app, market flow, liquidity plan, and the risk you take on.
        </p>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">The flow</h2>
          <div className="mt-5 space-y-7">
            {guide.map((g) => (
              <div key={g.h}>
                <h3 className="text-[16px] font-black text-white">{g.h}</h3>
                <p className="mt-2 text-[15px] leading-7 text-muted">{g.p}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Liquidity, eventually</h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            Polymarket made depth visible: bids, asks, spread. Presto should follow that, not hide execution quality inside a pool.
          </p>
          <ol className="mt-5 space-y-3 text-[15px] leading-7 text-white/90">
            {liquidity.map((item, i) => (
              <li key={item} className="flex gap-4">
                <span className="shrink-0 text-[11px] font-black uppercase tracking-widest text-cyan/70">{i + 1}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Reading the charts</h2>
          <div className="mt-5 space-y-5 text-[15px] leading-7 text-muted">
            <p><span className="font-black text-white">YES signal.</span> The live YES share ratio as a probability signal. It's market sentiment, not a tradeable quote.</p>
            <p><span className="font-black text-white">Volume / collateral.</span> How much activity backs the signal. Not available exit depth.</p>
            <p><span className="font-black text-white">Future depth.</span> Once the order book ships, you'll see bid/ask depth, spread, and maker liquidity.</p>
          </div>
        </section>

        <section id="terms-of-use" className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Terms &amp; risk</h2>
          <ul className="mt-5 space-y-3 text-[15px] leading-7 text-muted">
            {terms.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted/60" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="privacy-policy" className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Privacy</h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            Wallet connection state lives in your browser. Circle, RainbowKit, Vercel, and your wallet provider each process data under their own policies. Don't put private keys or sensitive personal info into market metadata.
          </p>
        </section>

        <section id="cookie-policy" className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Cookies</h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            Presto uses local / session storage for wallet sessions and UI state. Core market reads don't require tracking cookies, but connected providers may set their own.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
