import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

const guide = [
  {
    h: 'Open a market',
    p: 'Pick a type, add up to four categories, choose a close date, write the rules, point to the source of truth, set a resolver, and the form turns that into a live Arc market with clean public metadata.',
  },
  {
    h: 'Trade outcomes',
    p: 'Buy an outcome with USDC. Binary markets offer YES or NO, and poll markets offer every listed choice. The panel shows your implied odds, your shares, and a payout estimate before the wallet signs.',
  },
  {
    h: 'Settle with evidence',
    p: 'The resolver follows the written rules, gathers evidence, posts it to the contract, and signs the final outcome. Crypto price markets settle straight from the live price. Other agent markets settle from their declared sources once the evidence is clear, and anything uncertain waits for review.',
  },
  {
    h: 'Track your position',
    p: 'The portfolio and activity pages show your positions, cost basis, claim and refund previews, and the full creation and resolve history, read directly from Arc.',
  },
  {
    h: 'Follow a live match',
    p: 'Sports markets show both team flags, the kickoff time, and the live score once the match starts, pulled from a keyless feed. The final score stays with the market through settlement.',
  },
  {
    h: 'Cover institutional workflows',
    p: 'Beyond consumer questions, the agent favors event driven and operational markets: macro releases like CPI, central bank rate decisions, GDP and labor data, plus geopolitical and operational risk. Each one is bound to an official or measurable source, never a marketing post, so it stays settleable.',
  },
];

const buildRails = [
  { h: 'Arc Testnet, USDC as gas', p: 'Every market is its own contract from the Presto factory. Trades and payouts settle in USDC, or in EURC for euro markets.' },
  { h: 'Next.js 16 and viem', p: 'Server components handle trend ingestion and onchain reads. Client components own the trading flow, wallet state, and live odds.' },
  { h: 'Sign in your way', p: 'Use a device passkey, an app wallet PIN, email, or Google, or connect an external EVM wallet. Passkey and app wallet trades are sponsored through the Circle bundler, so you never need gas, and sessions refresh on their own so traders are never interrupted.' },
  { h: 'Fund from any chain', p: 'Move USDC to your Arc balance from Base, Ethereum, Arbitrum, or Avalanche through Circle Gateway, right inside the wallet panel.' },
  { h: 'Public agent API', p: 'Read markets, the leaderboard, and the agent profile at /api/v1. The data endpoints can accept tiny USDC payments through x402, so other agents can pay per call.' },
  { h: 'Verifiable identity', p: 'The agent has its own ERC-8004 identity and wallet on Arc, so every market it opens is signed against a track record anyone can check.' },
];

const pipeline = [
  'Read live trends across news, sports, crypto prices, and X on every run.',
  'Cluster headlines so one story covered by many outlets ranks higher than many separate ones.',
  'Classify each trend for momentum, safety, type, and category.',
  'Pick from the strongest by a weighted draw, so topics stay varied instead of repeating one outlet.',
  'Draft the market with a close date that fits the event, then open it onchain once it clears the bar.',
];

const charts = [
  { h: 'YES signal', p: 'The green line tracks YES share strength over time.' },
  { h: 'NO signal', p: 'The red line tracks NO share strength over time.' },
  { h: 'Volume', p: 'Volume shows how much activity stands behind the signal.' },
  { h: 'News tie in', p: 'Agent markets bound to a trending story carry an inline summary, so you can read the source without leaving the market.' },
];

const terms = [
  'Presto provides market creation, trading, and settlement tools for Arc prediction markets.',
  'Each market is governed by its own rules, source of truth, resolver, close time, and evidence record.',
  'You are responsible for reviewing wallet prompts, transaction details, and market terms before signing.',
  'Agent markets carry an Agent label and a full reasoning trace, so the source of every market is clear.',
  'Circle, Arc, wallet providers, hosting providers, and connected services apply their own terms where used.',
];

export default function DocsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-36 md:px-7 md:pt-40">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] font-bold text-muted transition-colors hover:text-cyan">
          <span>{'←'}</span> Back home
        </Link>
        <p className="mt-6 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Docs</p>
        <h1 className="mt-3 text-[clamp(32px,4vw,46px)] font-black tracking-tight text-white">Presto Markets guide.</h1>
        <p className="mt-4 text-[15px] leading-7 text-muted">
          Presto Markets is an institutional grade prediction market on Arc, Circle&apos;s stablecoin native L1. USDC is both the unit of account and the gas, every trade is final in under a second, Circle wallets handle onboarding, and a live agent opens fresh markets every day, from consumer questions to event driven and operational ones like macro releases, rate decisions, and geopolitical risk. The surface stays calm and readable so public signals can be created, traded, and settled with confidence.
        </p>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">How it works</h2>
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
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Build rails</h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            Presto runs on a small set of well chosen rails. Each one maps to a part of the product and keeps what the chain is doing in plain view.
          </p>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {buildRails.map((rail) => (
              <div key={rail.h} className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-5">
                <h3 className="text-[14px] font-black text-white">{rail.h}</h3>
                <p className="mt-2 text-[13.5px] leading-6 text-muted">{rail.p}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">The agent pipeline</h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            The Presto agent has its own onchain identity, its own wallet, and its own track record. It runs on a regular cadence, reads what the world is talking about, and opens the few markets that clear its bar.
          </p>
          <ol className="mt-5 space-y-3 text-[15px] leading-7 text-white/90">
            {pipeline.map((item, i) => (
              <li key={item} className="flex gap-4">
                <span className="shrink-0 text-[11px] font-black uppercase tracking-widest text-cyan/70">{i + 1}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Charts and signals</h2>
          <div className="mt-5 space-y-5 text-[15px] leading-7 text-muted">
            {charts.map((c) => (
              <p key={c.h}><span className="font-black text-white">{c.h}.</span> {c.p}</p>
            ))}
          </div>
        </section>

        <section id="terms-of-use" className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Legal</h2>
          <div className="mt-5 space-y-3 text-[15px] leading-7 text-muted">
            {terms.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </section>

        <section id="privacy-policy" className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Privacy Policy</h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            Wallet connection state and your interface preferences live in your browser. Circle, wallet providers, and connected services process their own data under their own policies. Market metadata stays public, clear, and safe to display.
          </p>
        </section>

        <section id="cookie-policy" className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Cookie Policy</h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            Presto uses browser storage for wallet sessions and interface state. Connected providers may use cookies or similar storage for authentication and security.
          </p>
        </section>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Terms of Use</h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            By using Presto, you agree to review market rules, source material, resolver evidence, wallet prompts, and transaction details before taking action.
          </p>
          <p className="mt-8 text-[13px] font-bold text-muted">{'©'} 2026 Presto. All rights reserved.</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
