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
  const createdMarkets = markets.filter((market) => market.source === 'created').length;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-12">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-cyan">Portfolio</p>
        <h1 className="mt-3 text-4xl font-black text-white">Your market positions</h1>
        <p className="mt-3 max-w-2xl text-muted">
          The portfolio now reflects your local trades and created markets, so the whole product loop is reviewable before live wallet reads and Arc contract data are connected.
        </p>

        <section className="mt-9 grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-line bg-panel p-6">
            <p className="text-sm text-muted">Position value</p>
            <p className="mt-2 text-3xl font-black text-white">{formatUsd(positionValue)}</p>
            <p className="mt-1 text-sm font-bold text-mint">{positions.length} tracked positions</p>
          </div>
          <div className="rounded-3xl border border-line bg-panel p-6">
            <p className="text-sm text-muted">Claimable</p>
            <p className="mt-2 text-3xl font-black text-white">{formatUsd(claimableValue)}</p>
            <p className="mt-1 text-sm font-bold text-muted">Resolution remains mock-safe for now</p>
          </div>
          <div className="rounded-3xl border border-line bg-panel p-6">
            <p className="text-sm text-muted">Markets created</p>
            <p className="mt-2 text-3xl font-black text-white">{createdMarkets}</p>
            <p className="mt-1 text-sm font-bold text-yellow-200">Shared back into the market explorer</p>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-line bg-panel">
          <div className="border-b border-line p-6">
            <h2 className="text-xl font-black text-white">Positions</h2>
          </div>
          <div className="divide-y divide-line">
            {positions.map((position) => (
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
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-line bg-panel">
          <div className="border-b border-line p-6">
            <h2 className="text-xl font-black text-white">Activity</h2>
          </div>
          <div className="divide-y divide-line">
            {activity.map((item) => (
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
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
