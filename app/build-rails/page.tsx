import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { currentRails } from '@/lib/productRails';

const live = [
  'Live Arc factory: reads, market creation, buy, resolve, claim, and refund.',
  'Circle wallets sign live Arc transactions through contract execution challenges.',
  'External EVM wallets like MetaMask and WalletConnect work inline through RainbowKit.',
  'The agent runs on an ERC-8004 identity (ID 16339) and drafts markets on a schedule.',
  'USDC settlement on every market contract.',
  'Crypto price markets settle straight from the live CoinGecko price.',
  'A browser cost basis indexer keeps portfolio reads fast.',
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
        <h1 className="mt-3 text-[clamp(32px,4vw,46px)] font-black tracking-tight text-white">Built on Circle and Arc.</h1>
        <p className="mt-4 text-[15px] leading-7 text-muted">
          Presto reads from the deployed Arc factory and submits live transactions through whichever wallet you sign in with, Circle or an external EVM wallet. USDC is the unit of account and the gas from the first click, and Arc&apos;s sub-second deterministic finality settles every trade for good. These are the rails institutional-grade prediction markets need, from consumer questions to macro releases, rate decisions, and operational risk.
        </p>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Rails in use</h2>
          <p className="mt-5 text-[15px] leading-7 text-white/90">
            {currentRails.map((r) => r.name).join(' · ')}
          </p>
        </section>

        <section className="mt-12 border-t border-white/[0.06] pt-8">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Live today</h2>
          <ul className="mt-5 space-y-3 text-[15px] leading-7 text-white/90">
            {live.map((item) => (
              <li key={item} className="flex gap-3">
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-mint" />
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
