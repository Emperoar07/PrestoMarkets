'use client';

import { SiteHeader } from './SiteHeader';
import { useAppState } from '@/lib/appState';

const statusStyle = {
  Open: 'border-cyan/25 bg-cyan/10 text-cyan',
  Claimable: 'border-mint/25 bg-mint/10 text-mint',
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
  const { markets, positions, activity } = useAppState();
  const positionValue = positions.reduce((sum, position) => sum + parseUsd(position.value), 0);
  const claimableValue = positions
    .filter((position) => position.status === 'Claimable')
    .reduce((sum, position) => sum + parseUsd(position.value), 0);
  const liveMarkets = markets.length;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1140px] px-4 pb-16 pt-28 md:px-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Portfolio</p>
        <h1 className="mt-3 text-[clamp(34px,5vw,54px)] font-black tracking-tight text-white">Your market positions</h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-[1.7] text-muted">
          Portfolio rows now stay empty until per-wallet share reads are connected. Live trading, claim, and refund actions happen from each market detail page.
        </p>

        <section className="mt-9 grid gap-4 md:grid-cols-3">
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm text-muted">Position value</p>
            <p className="mt-2 text-3xl font-black text-white">{formatUsd(positionValue)}</p>
            <p className="mt-1 text-sm font-bold text-mint">{positions.length} tracked positions</p>
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
            <h2 className="text-xl font-black text-white">Positions</h2>
          </div>
          <div className="divide-y divide-line">
            {positions.length > 0 ? positions.map((position) => (
              <div key={`${position.marketId}-${position.outcome}-${position.shares}`} className="grid gap-4 p-6 md:grid-cols-[1.5fr_repeat(4,1fr)_auto] md:items-center">
                <div>
                  <p className="font-black text-white">{position.title}</p>
                  <p className="mt-1 text-sm text-muted">{position.outcome} shares</p>
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
                </div>
                <span className={`w-fit rounded-full border px-3 py-1 text-xs font-black ${statusStyle[position.status]}`}>
                  {position.status}
                </span>
              </div>
            )) : (
              <div className="p-6 text-sm leading-6 text-muted">
                No wallet-scoped positions are displayed yet. This page will populate after the next live read pass adds `sharesOf` queries for the connected account.
              </div>
            )}
          </div>
        </section>

        <section className="mt-8 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
          <div className="border-b border-line p-6">
            <h2 className="text-xl font-black text-white">Activity</h2>
          </div>
          <div className="divide-y divide-line">
            {activity.length > 0 ? activity.map((item) => (
              <div key={`${item.label}-${item.market}-${item.time}-${item.detail}`} className="flex flex-col justify-between gap-4 p-6 md:flex-row md:items-center">
                <div>
                  <p className="font-black text-white">{item.label}</p>
                  <p className="mt-1 text-sm text-muted">{item.market}</p>
                  <p className="mt-1 text-sm text-muted">{item.detail}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusStyle[item.status]}`}>
                    {item.status}
                  </span>
                  <span className="text-sm font-bold text-muted">{item.time}</span>
                </div>
              </div>
            )) : (
              <div className="p-6 text-sm leading-6 text-muted">
                No local activity log is shown. Use wallet history or the Arc explorer for transaction-level activity until indexed account activity is added.
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
