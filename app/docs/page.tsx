import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

const guide = [
  {
    h: 'Create a market',
    p: 'Choose a market type, category, close date, rules, source of truth, resolver, and optional image. The form turns that into a live Arc market with clear public metadata.',
  },
  {
    h: 'Trade outcomes',
    p: 'Buy YES or NO with stablecoin collateral. The app shows the outcome, amount, expected shares, wallet, and contract call before you sign.',
  },
  {
    h: 'Add liquidity',
    p: 'Add balanced depth by splitting your amount into YES and NO shares. This gives each market a cleaner starting signal while keeping the settlement math easy to read.',
  },
  {
    h: 'Resolve and settle',
    p: 'The resolver follows the written rules and source of truth, adds evidence, and signs the final result. Agent evidence can help the resolver move faster while keeping the outcome auditable.',
  },
  {
    h: 'Track your position',
    p: 'Portfolio and activity pages show wallet specific positions, cost basis, claim previews, refund previews, and recent market actions from Arc.',
  },
];

const liquidity = [
  'Seed each new market with a balanced YES and NO share purchase.',
  'Show visible share counts so traders understand how much exposure they receive.',
  'Record activity clearly so market depth, volume, and resolver history are easy to inspect.',
  'Extend liquidity with richer maker flows once the current share model is stable and reviewed.',
];

const terms = [
  'Presto provides market creation, trading, and settlement tools for Arc based prediction markets.',
  'Each market is governed by its own rules, source of truth, resolver, close time, and evidence record.',
  'You are responsible for reviewing wallet prompts, transaction details, and market terms before signing.',
  'Agent created markets are labeled so users can understand when automation helped create the market.',
  'Circle, Arc, wallet providers, hosting providers, and connected services apply their own terms where used.',
];

export default function DocsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-36 md:px-7 md:pt-40">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] font-bold text-muted transition-colors hover:text-cyan">
          <span>←</span> Back home
        </Link>
        <p className="mt-6 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Docs</p>
        <h1 className="mt-3 text-[clamp(32px,4vw,46px)] font-black tracking-tight text-white">Presto Markets guide.</h1>
        <p className="mt-4 text-[15px] leading-7 text-muted">
          Presto Markets is a fast prediction market app on Arc. It uses stablecoin native rails, Circle powered onboarding, and clear market rules so public signals can be created, traded, and settled with confidence.
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
            Wallet connection state and selected UI preferences may live in your browser. Circle, wallet providers, and connected services process their own data under their own policies. Market metadata should stay public, clear, and safe to display.
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
          <p className="mt-8 text-[13px] font-bold text-muted">© 2026 Presto. All rights reserved.</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
