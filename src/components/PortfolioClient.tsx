'use client';

import Link from 'next/link';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { useAppState } from '@/lib/appState';

const statusStyle = {
  Open: 'border-cyan/25 bg-cyan/10 text-cyan',
  Claimable: 'border-mint/25 bg-mint/10 text-mint',
  Realized: 'border-white/10 bg-white/[0.04] text-[#dbeafe]',
  Watching: 'border-line bg-ink text-muted',
  Pending: 'border-yellow-400/25 bg-yellow-400/10 text-yellow-200',
  Confirmed: 'border-mint/25 bg-mint/10 text-mint',
  Failed: 'border-red-400/25 bg-red-400/10 text-red-200',
};

function parseUsd(value: string) {
  return Number(value.replace(/[$,]/g, '')) || 0;
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

export function PortfolioClient() {
  const { markets, positions, connectedWallet, isLoadingAccount } = useAppState();
  const positionValue = positions.reduce((sum, position) => sum + parseUsd(position.value), 0);
  const claimableValue = positions
    .filter((position) => position.status === 'Claimable')
    .reduce((sum, position) => sum + parseUsd(position.value), 0);
  const liveMarkets = markets.length;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-36 md:px-7 md:pt-40">
        <h1 className="text-[clamp(44px,6vw,68px)] font-black tracking-tight text-white">Portfolio</h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-[1.7] text-muted">
          Every row is read from live Arc market contracts for your connected wallet. Pick any share position to jump back to that market trade panel.
        </p>
        <div className="mt-5 w-fit rounded-full border border-white/[0.06] bg-[#141e30] px-4 py-2 text-sm font-bold text-muted">
          {connectedWallet ? `Connected ${connectedWallet.address.slice(0, 6)}...${connectedWallet.address.slice(-4)}` : 'Connect a wallet to load positions'}
        </div>

        <section className="mt-9 grid gap-4 md:grid-cols-3">
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm text-muted">Position value</p>
            <p className="mt-2 text-3xl font-black text-white">{formatUsd(positionValue)}</p>
            <p className="mt-1 text-sm font-bold text-mint">{isLoadingAccount ? 'Loading account reads' : `${positions.length} tracked positions`}</p>
          </div>
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm text-muted">Claimable</p>
            <p className="mt-2 text-3xl font-black text-white">{formatUsd(claimableValue)}</p>
            <p className="mt-1 text-sm font-bold text-muted">Claim from resolved market pages</p>
          </div>
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm text-muted">Factory markets</p>
            <p className="mt-2 text-3xl font-black text-white">{liveMarkets}</p>
            <p className="mt-1 text-sm font-bold text-yellow-200">Read from Arc factory state</p>
          </div>
        </section>

        <section className="mt-8 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
          <div className="border-b border-line p-6">
            <h2 className="text-xl font-black text-white">Share positions</h2>
          </div>
          <div className="divide-y divide-line">
            {positions.length > 0 ? positions.map((position) => (
              <Link
                key={`${position.marketId}-${position.outcome}-${position.shares}`}
                href={`/markets/${position.marketId}#trade-panel`}
                className="grid gap-4 p-6 transition-colors hover:bg-white/[0.025] md:grid-cols-[1.5fr_repeat(5,1fr)_auto] md:items-center"
              >
                <div>
                  <p className="font-black text-white">{position.title}</p>
                  <p className="mt-1 text-sm text-muted">{position.outcome} shares</p>
                  <p className="mt-2 text-xs font-black uppercase tracking-[0.16em] text-cyan">Open trade panel</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Shares</p>
                  <p className="mt-1 font-black text-white">{position.shares}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Average</p>
                  <p className="mt-1 font-black text-white">{position.averagePrice}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Current</p>
                  <p className="mt-1 font-black text-cyan">{position.currentPrice}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Value</p>
                  <p className="mt-1 font-black text-white">{position.value}</p>
                  <p className="mt-1 text-xs font-bold text-muted">{position.valuationLabel}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">P/L</p>
                  <p className={`mt-1 font-black ${position.pnl.startsWith('-') ? 'text-red-200' : 'text-mint'}`}>
                    {position.pnl}
                  </p>
                  <p className="mt-1 text-xs font-bold text-muted">{position.costBasis} cost</p>
                </div>
                <span className={`w-fit rounded-full border px-3 py-1 text-xs font-black ${statusStyle[position.status]}`}>
                  {position.status}
                </span>
              </Link>
            )) : (
              <div className="p-6 text-sm leading-6 text-muted">
                {connectedWallet ? 'No shares were found for this wallet across the live factory markets.' : 'Connect a wallet to load your shares from live Arc market contracts.'}
              </div>
            )}
          </div>
        </section>

        <section className="mt-8 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
          <div className="border-b border-line p-6">
            <h2 className="text-xl font-black text-white">Activity</h2>
          </div>
          <div className="p-6 text-sm leading-6 text-muted">
            {connectedWallet
              ? 'Recent account events now load on the dedicated Activity page in paginated batches.'
              : 'Connect a wallet to load recent buy, claim, and refund events.'}
            {connectedWallet ? (
              <Link href="/activity" className="ml-2 font-black text-cyan transition-colors hover:text-cyan/80">
                Open activity
              </Link>
            ) : null}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
