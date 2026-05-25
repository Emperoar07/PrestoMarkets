import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

const guide = [
  {
    h: 'Create a market',
    p: 'Pick a market type, add up to four categories, choose a close date, write the rules, point to the source of truth, set a resolver, and the form turns that into a live Arc market with clean public metadata.',
  },
  {
    h: 'Trade outcomes',
    p: 'Buy an outcome with USDC or EURC. Binary markets offer YES or NO, while poll markets offer every listed choice. The trade panel shows your expected share count and settlement preview before the wallet signs.',
  },
  {
    h: 'Add liquidity',
    p: 'Add balanced depth by splitting one amount evenly across every outcome. Binary and poll markets both begin without favoring one available choice.',
  },
  {
    h: 'Resolve and settle',
    p: 'The resolver follows the written rules, gathers evidence, posts an evidence URI to the contract, and signs the final outcome. Agent assisted resolution gives the resolver a research oracle for faster sourcing while keeping the human in the loop.',
  },
  {
    h: 'Track your position',
    p: 'Portfolio and activity pages show wallet specific positions, cost basis, claim previews, refund previews, and the agent’s creation and resolve history pulled directly from Arc.',
  },
];

const buildRails = [
  { h: 'Arc Testnet, USDC native gas', p: 'Every market is its own contract deployed by the Presto factory. Settlement is in USDC. EURC bought through Circle App Kit auto swaps into USDC at signing time.' },
  { h: 'Next.js 14 + viem', p: 'Server components handle trend ingestion and onchain reads. Client components own the trading flow, wallet state, and live odds.' },
  { h: 'Circle App Kit wallets', p: 'Email and PIN onboarding for first time users, external EVM wallets for everyone else, session tokens that auto refresh so traders are never bumped mid flow.' },
  { h: 'LLM fallback chain', p: 'Anthropic Claude leads, with Groq, OpenRouter, Cerebras, and Together standing by so the agent keeps running through any single provider outage.' },
  { h: 'Trend ingestion mesh', p: 'Cointelegraph, Decrypt, The Block, CoinDesk, BBC, TechCrunch, Hacker News, ESPN, TheSportsDB, LiveScore, X via Grok, and live CoinGecko prices feed the agent.' },
  { h: 'ERC-8004 agent identity', p: 'The agent has its own onchain identity and wallet, so every market it creates is signed against a verifiable track record.' },
];

const pipeline = [
  'Read live trend signals across news, sports, crypto prices, and X chatter on every cron tick.',
  'Cluster headlines by fuzzy title fingerprint so one story covered by many outlets ranks higher than many separate stories.',
  'Classify each trend against the platform context, assigning momentum, safety, suggested market type, and category set.',
  'Pick weighted random from the top half by momentum so the agent diversifies across topics instead of repeating the same outlet.',
  'Draft the market with a close date matched to the topic horizon, anywhere from six hours to ninety days.',
  'Gate on composite signal (momentum times safety) before deploying. Skipping a tick is preferred when the bar is not cleared.',
];

const liquidity = [
  'Seed each new market with balanced purchases across every listed outcome.',
  'Show visible share counts so traders understand how much exposure they receive.',
  'Record activity clearly so market depth, volume, and resolver history are easy to inspect.',
  'Extend liquidity with richer maker flows as the order book contract phase comes online.',
];

const roadmap = [
  { h: 'Order book phase', p: 'A native onchain matching engine that turns the Limit toggle in the trade panel into a live order book against the share contract.' },
  { h: 'Cross market liquidity rebalancer', p: 'A scheduled rebalance pass that moves depth toward the busiest agent created markets so live odds stay responsive.' },
  { h: 'Paid agent endpoints', p: 'x402 wrapped resolution oracle so other agents can pay USDC to query Presto research as a service.' },
  { h: 'Multi chain expansion', p: 'Arc Mainnet ships, then a clean parity port to one additional Circle stablecoin chain so the same market contracts run wherever USDC is native.' },
  { h: 'Agent tweet rationale', p: 'Every agent market posts its rationale, trend link, momentum, and safety to X automatically. Same audit trail, broader reach.' },
  { h: 'Opinion baskets', p: 'Bundle positions across linked opinion markets so a thesis can be expressed with a single signed transaction.' },
  { h: 'Resolution court', p: 'A dispute window after every resolver signs so high stakes markets can be flagged, re evaluated, and corrected before claims open.' },
];

const terms = [
  'Presto provides market creation, trading, and settlement tools for Arc based prediction markets.',
  'Each market is governed by its own rules, source of truth, resolver, close time, and evidence record.',
  'You are responsible for reviewing wallet prompts, transaction details, and market terms before signing.',
  'Agent created markets carry an Agent label and a full reasoning trace so the source of every market is clear.',
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
          Presto Markets is a prediction market app on Arc, Circle’s stablecoin native L1. The rails are USDC at the center, Circle wallets for onboarding, a live agent for daily market creation, and a calm editorial surface so public signals can be created, traded, and settled with confidence.
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
            Presto sits on a small set of well chosen rails. Each one maps cleanly to a part of the product story and avoids hiding what the chain is actually doing.
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
            The Presto Markets agent has its own onchain identity, its own wallet, and its own track record. It runs on a regular cadence, reads what the world is talking about, and creates the few markets that clear a composite signal threshold.
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
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Liquidity plan</h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            Presto treats liquidity as readable market depth. The goal is to make every share purchase, balanced depth action, and settlement path understandable from the UI.
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
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Charts and signals</h2>
          <div className="mt-5 space-y-5 text-[15px] leading-7 text-muted">
            <p><span className="font-black text-white">YES signal.</span> The green line tracks YES share strength over time.</p>
            <p><span className="font-black text-white">NO signal.</span> The red line tracks NO share strength over time.</p>
            <p><span className="font-black text-white">Volume.</span> Volume helps users see how much activity supports the signal.</p>
            <p><span className="font-black text-white">News tie in.</span> Agent created markets bound to a trending story carry an inline summary so traders can read the source without leaving the market.</p>
          </div>
        </section>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Roadmap</h2>
          <p className="mt-4 text-[15px] leading-7 text-muted">
            Where Presto is going next. These are the rails we are building toward, in roughly the order we expect to ship them.
          </p>
          <div className="mt-6 space-y-5">
            {roadmap.map((item) => (
              <div key={item.h} className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-5">
                <h3 className="text-[15px] font-black text-white">{item.h}</h3>
                <p className="mt-2 text-[14px] leading-7 text-muted">{item.p}</p>
              </div>
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
            Wallet connection state and selected UI preferences live in your browser. Circle, wallet providers, and connected services process their own data under their own policies. Market metadata stays public, clear, and safe to display.
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
