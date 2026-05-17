'use client';

import { useState } from 'react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { formatUsd, useAppState } from '@/lib/appState';
import type { MarketStatus } from '@/lib/markets';

const statusStyle: Record<MarketStatus, string> = {
  Open: 'border-mint/25 bg-mint/10 text-mint',
  'Closing soon': 'border-yellow-400/25 bg-yellow-400/10 text-yellow-200',
  Resolved: 'border-cyan/25 bg-cyan/10 text-cyan',
  Canceled: 'border-red-400/25 bg-red-400/10 text-red-200',
  Draft: 'border-line bg-ink text-muted',
};

export function MarketDetailClient({ marketId }: { marketId: string }) {
  const { accountPreviews, connectedWallet, getMarket, placeTrade, resolveMarket, cancelMarket, claimMarket, refundMarket } = useAppState();
  const market = getMarket(marketId);
  const [selectedOutcome, setSelectedOutcome] = useState<'YES' | 'NO'>('YES');
  const [amount, setAmount] = useState('25');
  const [resolutionURI, setResolutionURI] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!market) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-4xl px-4 pb-16 pt-28 md:px-7">
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-8 text-center">
            <h1 className="text-3xl font-black text-white">Market not found</h1>
            <p className="mt-3 text-muted">This market was not returned by the deployed Arc factory.</p>
          </div>
        </main>
        <SiteFooter />
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
  const accountPreview = accountPreviews[market.id];
  const claimableAmount = Number(accountPreview?.claimable.replace(/[$,]/g, '') || 0);
  const refundableAmount = Number(accountPreview?.refundable.replace(/[$,]/g, '') || 0);
  const canClaim = claimableAmount > 0 && !accountPreview?.hasClaimed;
  const canRefund = refundableAmount > 0 && !accountPreview?.hasClaimed;
  const hasSettlementRecord = market.status === 'Resolved' || market.status === 'Canceled';
  const connectedAddress = connectedWallet?.address.toLowerCase();
  const resolverAddress = market.resolverAddress?.toLowerCase();
  const isResolver = Boolean(connectedAddress && resolverAddress && connectedAddress === resolverAddress);
  const canUseResolverActions = isResolver && (market.status === 'Open' || market.status === 'Closing soon');

  async function runAction(action: () => Promise<{ ok: boolean; message: string; txHash?: string }>) {
    setIsSubmitting(true);
    setMessage('Waiting for wallet confirmation...');
    const result = await action();
    setIsSubmitting(false);
    setMessage(result.message);
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1140px] px-4 pb-16 pt-28 md:px-7">
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <section className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-7">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-cyan">
                {market.type}
              </span>
              <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusStyle[market.status]}`}>
                {market.status}
              </span>
              <span className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-black text-mint">
                Onchain
              </span>
            </div>
            <h1 className="mt-5 text-[clamp(32px,4vw,48px)] font-black leading-tight tracking-tight text-white">{market.title}</h1>
            <p className="mt-4 text-[15px] leading-[1.8] text-muted">{market.description}</p>
            {market.imageURI ? (
              <div className="mt-7 overflow-hidden rounded-[16px] border border-white/[0.06] bg-[#0f172a]">
                <img src={market.imageURI} alt={market.title} className="h-[320px] w-full object-cover" />
              </div>
            ) : null}
            <div className="mt-8 grid gap-4 md:grid-cols-4">
              <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-sm text-muted">Volume</p>
                <p className="mt-2 text-2xl font-black text-white">{market.volume}</p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-sm text-muted">Liquidity</p>
                <p className="mt-2 text-2xl font-black text-white">{market.liquidity}</p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-sm text-muted">Close</p>
                <p className="mt-2 text-2xl font-black text-white">{market.closeLabel}</p>
              </div>
              <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
                <p className="text-sm text-muted">Collateral</p>
                <p className="mt-2 text-2xl font-black text-white">{market.collateral}</p>
              </div>
            </div>
            <div className="mt-8 rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-6">
              <h2 className="text-xl font-black text-white">Resolution rules</h2>
              <p className="mt-3 leading-7 text-muted">{market.rules}</p>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-[14px] border border-white/[0.06] bg-[#141e30] p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Source of truth</p>
                  <p className="mt-2 text-sm leading-6 text-white">{market.sourceOfTruth}</p>
                </div>
                <div className="rounded-[14px] border border-white/[0.06] bg-[#141e30] p-4">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Resolver</p>
                  <p className="mt-2 break-all text-sm leading-6 text-white">{market.resolverAddress || market.resolver}</p>
                  <p className="mt-1 text-sm text-cyan">{market.resolutionMode}</p>
                </div>
              </div>
            </div>
            <div className="mt-8 rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-6">
              <h2 className="text-xl font-black text-white">Market activity</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {market.activity.map((item) => (
                  <div key={item.label} className="rounded-[14px] border border-white/[0.06] bg-[#141e30] p-4">
                    <p className="text-sm text-muted">{item.label}</p>
                    <p className="mt-1 text-2xl font-black text-white">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
            {hasSettlementRecord ? (
              <div className="mt-8 rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan">Settlement record</p>
                    <h2 className="mt-2 text-xl font-black text-white">
                      {market.status === 'Resolved'
                        ? `${market.winningOutcomeLabel ?? 'Winning outcome'} resolved`
                        : 'Market canceled'}
                    </h2>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusStyle[market.status]}`}>
                    {market.status}
                  </span>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div className="rounded-[14px] border border-white/[0.06] bg-[#141e30] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Evidence URI</p>
                    {market.resolutionURI ? (
                      <a
                        href={market.resolutionURI}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block break-all text-sm font-bold leading-6 text-cyan hover:text-[#7ddfff]"
                      >
                        {market.resolutionURI}
                      </a>
                    ) : (
                      <p className="mt-2 text-sm leading-6 text-muted">No resolver evidence URI was recorded.</p>
                    )}
                  </div>
                  <div className="rounded-[14px] border border-white/[0.06] bg-[#141e30] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Connected wallet</p>
                    <p className="mt-2 text-sm leading-6 text-white">
                      {connectedWallet
                        ? accountPreview?.hasClaimed
                          ? 'Settlement already claimed or refunded.'
                          : canClaim
                            ? `${accountPreview?.claimable} claimable`
                            : canRefund
                              ? `${accountPreview?.refundable} refundable`
                              : 'No settlement action available.'
                        : 'Connect a wallet to check claim or refund status.'}
                    </p>
                  </div>
                  <div className="rounded-[14px] border border-white/[0.06] bg-[#141e30] p-4">
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Audit trail</p>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      The final outcome, evidence URI, claim preview, and refund preview are read from the live Arc market contract.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <aside className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <h2 className="text-xl font-black text-white">Trade outcome</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Trades execute against this live Arc market. If your USDC allowance is too low, Presto will ask for approval before submitting the buy.
            </p>
            <div className="mt-5 grid gap-3">
              <button
                type="button"
                onClick={() => setSelectedOutcome('YES')}
                className={`rounded-[14px] border p-5 text-left transition-colors ${
                  selectedOutcome === 'YES' ? 'border-cyan/35 bg-cyan/10' : 'border-white/[0.06] bg-[#0f172a]'
                }`}
              >
                <span className="text-sm font-bold text-muted">Buy YES</span>
                <span className="mt-2 block text-3xl font-black text-cyan">{yesOutcome.odds}%</span>
                <span className="mt-1 block text-sm text-muted">{yesOutcome.liquidity} liquidity</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedOutcome('NO')}
                className={`rounded-[14px] border p-5 text-left transition-colors ${
                  selectedOutcome === 'NO' ? 'border-cyan/35 bg-cyan/10' : 'border-white/[0.06] bg-[#0f172a]'
                }`}
              >
                <span className="text-sm font-bold text-muted">Buy NO</span>
                <span className="mt-2 block text-3xl font-black text-white">{noOutcome.odds}%</span>
                <span className="mt-1 block text-sm text-muted">{noOutcome.liquidity} liquidity</span>
              </button>
            </div>
            <div className="mt-5 rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-4">
              <label className="text-sm font-bold text-muted">Amount USDC</label>
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-2 w-full bg-transparent text-3xl font-black text-white outline-none"
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>
            <div className="mt-4 rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-4">
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
            <div className="mt-4 rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Your position</p>
              {connectedWallet ? (
                <>
                  <div className="mt-3 flex items-center justify-between text-sm text-muted">
                    <span>YES shares</span>
                    <span className="font-black text-white">{accountPreview?.yesShares ?? '0.00'}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm text-muted">
                    <span>NO shares</span>
                    <span className="font-black text-white">{accountPreview?.noShares ?? '0.00'}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm text-muted">
                    <span>Claimable</span>
                    <span className="font-black text-mint">{accountPreview?.claimable ?? '$0.00'}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm text-muted">
                    <span>Refundable</span>
                    <span className="font-black text-cyan">{accountPreview?.refundable ?? '$0.00'}</span>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm leading-6 text-muted">Connect a wallet to read your shares and settlement availability.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void runAction(() => placeTrade({ marketId, outcome: selectedOutcome, amount: amountValue }))}
              disabled={!canTrade || isSubmitting}
              className="mt-5 w-full rounded-[10px] bg-cyan px-6 py-4 font-black text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {canTrade ? `${isSubmitting ? 'Submitting...' : `Buy ${selectedOutcome} on Arc`}` : 'Market Not Open'}
            </button>
            <div className="mt-5 rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-muted">Settlement actions</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                {connectedWallet
                  ? isResolver
                    ? 'This wallet is the market resolver.'
                    : 'Resolver actions are locked to the configured resolver wallet.'
                  : 'Connect the resolver wallet to resolve or cancel this market.'}
              </p>
              <input
                value={resolutionURI}
                onChange={(event) => setResolutionURI(event.target.value)}
                placeholder="Resolution evidence URI"
                className="mt-3 w-full rounded-[10px] border border-white/[0.06] bg-[#141e30] px-3 py-2 text-sm text-white outline-none focus:border-cyan/50"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void runAction(() => resolveMarket({ marketId, outcome: selectedOutcome, resolutionURI }))}
                  disabled={isSubmitting || !canUseResolverActions || !resolutionURI.trim()}
                  className="rounded-xl border border-white/[0.06] bg-panel2 px-3 py-2 text-xs font-black text-muted transition-colors hover:border-cyan/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Resolve {selectedOutcome}
                </button>
                <button
                  type="button"
                  onClick={() => void runAction(() => cancelMarket(marketId))}
                  disabled={isSubmitting || !canUseResolverActions}
                  className="rounded-xl border border-white/[0.06] bg-panel2 px-3 py-2 text-xs font-black text-muted transition-colors hover:border-cyan/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void runAction(() => claimMarket(marketId))}
                  disabled={isSubmitting || !canClaim}
                  className="rounded-xl border border-white/[0.06] bg-panel2 px-3 py-2 text-xs font-black text-muted transition-colors hover:border-cyan/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Claim
                </button>
                <button
                  type="button"
                  onClick={() => void runAction(() => refundMarket(marketId))}
                  disabled={isSubmitting || !canRefund}
                  className="rounded-xl border border-white/[0.06] bg-panel2 px-3 py-2 text-xs font-black text-muted transition-colors hover:border-cyan/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Refund
                </button>
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
      <SiteFooter />
    </>
  );
}
