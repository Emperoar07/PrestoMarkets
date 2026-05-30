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
];

const buildRails = [
  { h: 'Arc Testnet, USDC as gas', p: 'Every market is its own contract from the Presto factory, and settlement is in USDC.' },
  { h: 'Next.js 16 and viem', p: 'Server components handle trend ingestion and onchain reads. Client components own the trading flow, wallet state, and live odds.' },
  { h: 'Circle wallets', p: 'Email, Google, and PIN onboarding for new users, external EVM wallets for everyone else, and sessions that refresh on their own so traders are never interrupted.' },
  { h: 'Model rotation', p: 'Claude leads, with Groq, OpenRouter, Cerebras, and Together standing by, so the agent keeps running through any single provider hiccup.' },
  { h: 'Trend ingestion', p: 'Cointelegraph, Decrypt, The Block, CoinDesk, BBC, TechCrunch, Hacker News, ESPN, TheSportsDB, LiveScore, X via Grok, and live CoinGecko prices feed the agent.' },
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
          Presto Markets is a prediction market app on Arc, Circle&apos;s stablecoin native L1. USDC sits at the center, Circle wallets handle onboarding, and a live agent opens fresh markets every day. The surface stays calm and readable so public signals can be created, traded, and settled with confidence.
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
