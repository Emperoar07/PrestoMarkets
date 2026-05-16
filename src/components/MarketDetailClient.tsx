'use client';

import { useState } from 'react';
import { SiteHeader } from './SiteHeader';
import { formatUsd, useAppState } from '@/lib/appState';
import type { MarketStatus } from '@/lib/markets';

const statusStyle: Record<MarketStatus, string> = {
  Open: 'border-mint/25 bg-mint/10 text-mint',
  'Closing soon': 'border-yellow-400/25 bg-yellow-400/10 text-yellow-200',
  Resolved: 'border-cyan/25 bg-cyan/10 text-cyan',
  Canceled: 'border-red-400/25 bg-red-400/10 text-red-200',
  Draft: 'border-line bg-ink text-muted',
};

const demoStatuses: MarketStatus[] = ['Open', 'Resolved', 'Canceled', 'Draft'];

export function MarketDetailClient({ marketId }: { marketId: string }) {
  const { getMarket, placeTrade, updateMarketStatus } = useAppState();
  const market = getMarket(marketId);
  const [selectedOutcome, setSelectedOutcome] = useState<'YES' | 'NO'>('YES');
  const [amount, setAmount] = useState('25');
  const [message, setMessage] = useState('');

  if (!market) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-4xl px-6 py-16">
          <div className="rounded-3xl border border-line bg-panel p-8 text-center">
            <h1 className="text-3xl font-black text-white">Market not found</h1>
            <p className="mt-3 text-muted">This route is ready for locally created markets and seeded demos, but that market does not exist.</p>
          </div>
        </main>
      </>
    );
  }

  const yesOutcome = market.outcomes.find((outcome) => outcome.label === 'YES') ?? market.outcomes[0];
  const noOutcome = market.outcomes.find((outcome) => outcome.label === 'NO') ?? market.outcomes[1] ?? yesOutcome;
  const activeOutcome = selectedOutcome === 'YES' ? yesOutcome : noOutcome;
  const amountValue = Number(amount) || 0;
  const entryPrice = activeOutcome.odds / 100;
  const estimatedShares = amountValue > 0 ? amountValue / entryPrice : 0;
  const canTrade = market.status === 'Open' || market.status === 'Closing soon';

  function handleTrade() {
    const result = placeTrade({ marketId, outcome: selectedOutcome, amount: amountValue });
    setMessage(result.message);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <section className="rounded-3xl border border-line bg-panel p-7">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-cyan">
                {market.type}
              </span>
              <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusStyle[market.status]}`}>
                {market.status}
              </span>
              {market.source === 'created' ? (
                <span className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-black text-mint">
                  Created in app
                </span>
              ) : null}
            </div>
            <h1 className="mt-5 text-4xl font-black leading-tight text-white">{market.title}</h1>
            <p className="mt-4 text-lg leading-8 text-muted">{market.description}</p>
            <div className="mt-8 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-line bg-ink p-5">
                <p className="text-sm text-muted">Volume</p>
                <p className="mt-2 text-2xl font-black text-white">{market.volume}</p>
              </div>
              <div className="rounded-2xl border border-line bg-ink p-5">
                <p className="text-sm text-muted">Liquidity</p>
                <p className="mt-2 text-2xl font-black text-white">{market.liquidity}</p>
              </div>
              <div className="rounded-2xl border border-line bg-ink p-5">
                <p className="text-sm text-muted">Close</p>
                <p className="mt-2 text-2xl font-black text-white">{market.closeLabel}</p>
              </div>
              <div className="rounded-2xl border border-line bg-ink p-5">
                <p className="text-sm text-muted">Collateral</p>
                <p className="mt-2 text-2xl font-black text-white">{market.collateral}</p>
              </div>
            </div>
            <div className="mt-8 rounded-2xl border border-line bg-ink p-6">
              <h2 className="text-xl font-black text-white">Resolution rules</h2>
              <p className="mt-3 leading-7 text-muted">{market.rules}</p>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-line bg-panel2 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Source of truth</p>
                  <p className="mt-2 text-sm leading-6 text-white">{market.sourceOfTruth}</p>
                </div>
                <div className="rounded-2xl border border-line bg-panel2 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Resolver</p>
                  <p className="mt-2 text-sm leading-6 text-white">{market.resolver}</p>
                  <p className="mt-1 text-sm text-cyan">{market.resolutionMode}</p>
                </div>
              </div>
            </div>
            <div className="mt-8 rounded-2xl border border-line bg-ink p-6">
              <h2 className="text-xl font-black text-white">Market activity</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {market.activity.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-line bg-panel2 p-4">
                    <p className="text-sm text-muted">{item.label}</p>
                    <p className="mt-1 text-2xl font-black text-white">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="rounded-3xl border border-line bg-panel p-6">
            <h2 className="text-xl font-black text-white">Trade outcome</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Demo mode is live for the app phase. Trades update prices, volume, and your portfolio locally so the full flow is reviewable before wallet wiring.
            </p>
            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={() => setSelectedOutcome('YES')}
                className={`rounded-2xl border p-5 text-left transition-colors ${
                  selectedOutcome === 'YES' ? 'border-cyan/35 bg-cyan/10' : 'border-line bg-ink'
                }`}
              >
                <span className="text-sm font-bold text-muted">Buy YES</span>
                <span className="mt-2 block text-3xl font-black text-cyan">{yesOutcome.odds}%</span>
                <span className="mt-1 block text-sm text-muted">{yesOutcome.liquidity} liquidity</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedOutcome('NO')}
                className={`rounded-2xl border p-5 text-left transition-colors ${
                  selectedOutcome === 'NO' ? 'border-cyan/35 bg-cyan/10' : 'border-line bg-ink'
                }`}
              >
                <span className="text-sm font-bold text-muted">Buy NO</span>
                <span className="mt-2 block text-3xl font-black text-white">{noOutcome.odds}%</span>
                <span className="mt-1 block text-sm text-muted">{noOutcome.liquidity} liquidity</span>
              </button>
            </div>
            <div className="mt-5 rounded-2xl border border-line bg-ink p-4">
              <label className="text-sm font-bold text-muted">Amount USDC</label>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-2 w-full bg-transparent text-3xl font-black text-white outline-none"
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>
            <div className="mt-4 rounded-2xl border border-line bg-ink p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Trade preview</p>
              <div className="mt-3 flex items-center justify-between text-sm text-muted">
                <span>Selected outcome</span>
                <span className="font-black text-white">{selectedOutcome}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm text-muted">
                <span>Entry price</span>
                <span className="font-black text-white">{formatUsd(entryPrice)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm text-muted">
                <span>Estimated shares</span>
                <span className="font-black text-white">{estimatedShares.toFixed(2)}</span>
              </div>
            </div>
            <button type="button" onClick={handleTrade} className="mt-5 w-full rounded-2xl bg-cyan px-6 py-4 font-black text-ink">
              {canTrade ? `Simulate Buy ${selectedOutcome}` : 'Market Not Open'}
            </button>
            <div className="mt-5 rounded-2xl border border-line bg-ink p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Demo status</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {demoStatuses.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => updateMarketStatus(market.id, status)}
                    className={`rounded-xl border px-3 py-2 text-xs font-black transition-colors ${
                      market.status === status ? 'border-cyan/45 bg-cyan/10 text-cyan' : 'border-line bg-panel2 text-muted hover:border-cyan/30'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
            {message ? (
              <p className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-bold ${message.includes('cannot') ? 'border-red-400/25 bg-red-400/10 text-red-200' : 'border-mint/25 bg-mint/10 text-mint'}`}>
                {message}
              </p>
            ) : null}
          </aside>
        </div>
      </main>
    </>
  );
}
