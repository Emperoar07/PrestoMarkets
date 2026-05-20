import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { currentRails, plannedRails } from '@/lib/productRails';

const done = [
  'Live Arc factory: reads, market creation, buy, resolve, claim, refund.',
  'Circle user-controlled wallets sign live Arc transactions via contract-execution challenges.',
  'External EVM wallets (MetaMask, WalletConnect) work inline through RainbowKit.',
  'Agent registered on ERC-8004 (ID 16339) with daily cron-driven market drafting.',
  'EURC + USDC collateral selector at market creation.',
  'Incremental localStorage cost-basis indexer replaces from-block-0 log scans.',
];

const next = [
  'Persistent activity index. KV or Postgres backing the portfolio reads.',
  'Dispute window with bonded challenges before payouts finalize.',
  'Sell / AMM exit path before settlement.',
  'Paymaster so users skip native gas entirely.',
];

export default function BuildRailsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-36 md:px-7 md:pt-40">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] font-bold text-muted transition-colors hover:text-cyan">
          <span>←</span> Back home
        </Link>
        <p className="mt-6 text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Build rails</p>
        <h1 className="mt-3 text-[clamp(32px,4vw,46px)] font-black tracking-tight text-white">USDC markets first. Rails when ready.</h1>
        <p className="mt-4 text-[15px] leading-7 text-muted">
          Presto reads from the deployed Arc factory and submits live transactions through whichever wallet you sign in with: Circle or an external EVM wallet.
        </p>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Current</h2>
          <p className="mt-5 text-[15px] leading-7 text-white/90">
            {currentRails.map((r) => r.name).join(' · ')}
          </p>
        </section>

        <section className="mt-10 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Planned</h2>
          <p className="mt-5 text-[15px] leading-7 text-muted">
            {plannedRails.map((r) => r.name).join(' · ')}
          </p>
        </section>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Done</h2>
          <ul className="mt-5 space-y-3 text-[15px] leading-7 text-white/90">
            {done.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-mint" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Next</h2>
          <ul className="mt-5 space-y-3 text-[15px] leading-7 text-white/90">
            {next.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan/60" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
