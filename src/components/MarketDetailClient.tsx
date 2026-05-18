'use client';

import { useState } from 'react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { MarketSignalChart } from './MarketSignalChart';
import { formatUsd, useAppState } from '@/lib/appState';
import type { MarketStatus } from '@/lib/markets';

const statusStyle: Record<MarketStatus, string> = {
  Open: 'border-mint/25 bg-mint/10 text-mint',
  'Closing soon': 'border-yellow-400/25 bg-yellow-400/10 text-yellow-200',
  Resolved: 'border-cyan/25 bg-cyan/10 text-cyan',
  Canceled: 'border-red-400/25 bg-red-400/10 text-red-200',
  Draft: 'border-line bg-ink text-muted',
};

const quickAmounts = [10, 25, 100, 500];

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
        <main className="mx-auto max-w-[1100px] px-4 pb-16 pt-28 md:px-7">
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-8 text-center">
            <h1 className="text-3xl font-black text-white">Market not found</h1>
            <p className="mt-3 text-muted">This market was not returned by the deployed Arc factory.</p>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const yesOutcome = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
  const noOutcome = market.outcomes.find((o) => o.label === 'NO') ?? market.outcomes[1] ?? yesOutcome;
  const activeOutcome = selectedOutcome === 'YES' ? yesOutcome : noOutcome;
  const amountValue = Number(amount) || 0;
  const entryPrice = activeOutcome.odds / 100;
  const estimatedShares = amountValue > 0 ? amountValue / entryPrice : 0;
  const potentialReturn = estimatedShares > 0 ? estimatedShares * 1 : 0;
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
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-24 md:px-7">
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">

          {/* ── Left column ── */}
          <section className="min-w-0">

            {/* Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-cyan">
                {market.type}
              </span>
              <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${statusStyle[market.status]}`}>
                {market.status}
              </span>
              <span className="rounded-full border border-white/[0.06] bg-white/[0.04] px-3 py-1 text-[11px] font-black text-[#8fa0b4]">
                {market.category}
              </span>
            </div>

            {/* Title */}
            <h1 className="mt-4 text-[clamp(28px,4vw,46px)] font-black leading-tight tracking-tight text-white">
              {market.title}
            </h1>

            {/* Meta strip */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#8fa0b4]">
              <span>{market.chain}</span>
              <span className="text-white/20">·</span>
              <span>{market.volume} Vol.</span>
              <span className="text-white/20">·</span>
              <span>{market.liquidity} Liq.</span>
              <span className="text-white/20">·</span>
              <span>Closes {market.closeLabel}</span>
            </div>

            {/* Odds bar */}
            <div className="mt-6">
              <div className="flex overflow-hidden rounded-full" style={{ height: 8 }}>
                <div className="bg-cyan transition-all duration-500" style={{ width: `${yesOutcome.odds}%` }} />
                <div className="flex-1 bg-red-500/40" />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-cyan/10 px-2.5 py-1 text-xs font-black text-cyan">YES</span>
                  <span className="text-lg font-black text-white">{yesOutcome.odds}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-white">{noOutcome.odds}%</span>
                  <span className="rounded-md bg-red-400/10 px-2.5 py-1 text-xs font-black text-red-300">NO</span>
                </div>
              </div>
            </div>

            {/* Description */}
            {market.description ? (
              <p className="mt-6 text-[15px] leading-[1.8] text-[#94a3b8]">{market.description}</p>
            ) : null}

            {/* Market image */}
            {market.imageURI ? (
              <div className="mt-6 overflow-hidden rounded-[14px] border border-white/[0.06]">
                <img src={market.imageURI} alt={market.title} className="h-[280px] w-full object-cover" />
              </div>
            ) : null}

            {/* Signal chart */}
            <div className="mt-8">
              <MarketSignalChart market={market} />
            </div>

            {/* Stats row */}
            <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: 'Volume', value: market.volume },
                { label: 'Liquidity', value: market.liquidity },
                { label: 'Closes', value: market.closeLabel },
                { label: 'Collateral', value: market.collateral },
              ].map((stat) => (
                <div key={stat.label} className="rounded-[12px] border border-white/[0.06] bg-[#141e30] px-4 py-4">
                  <p className="text-xs font-bold text-muted">{stat.label}</p>
                  <p className="mt-1.5 text-xl font-black text-white">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Resolution rules */}
            <div className="mt-6 rounded-[14px] border border-white/[0.06] bg-[#141e30] p-5">
              <h2 className="text-base font-black text-white">Resolution rules</h2>
              <p className="mt-2 text-sm leading-7 text-muted">{market.rules}</p>
              <div className="mt-4 grid gap-x-10 gap-y-4 border-t border-white/[0.06] pt-4 md:grid-cols-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted">Source of truth</p>
                  <p className="mt-1.5 text-sm leading-6 text-white">{market.sourceOfTruth}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted">Resolver</p>
                  <p className="mt-1.5 break-all text-sm leading-6 text-white">{market.resolverAddress || market.resolver}</p>
                  <p className="mt-1 text-xs text-cyan">{market.resolutionMode}</p>
                </div>
              </div>
            </div>

            {/* Market activity */}
            <div className="mt-4 rounded-[14px] border border-white/[0.06] bg-[#141e30] p-5">
              <h2 className="text-base font-black text-white">Market activity</h2>
              <div className="mt-4 grid gap-x-10 gap-y-4 border-t border-white/[0.06] pt-4 md:grid-cols-3">
                {market.activity.map((item) => (
                  <div key={item.label}>
                    <p className="text-xs font-bold text-muted">{item.label}</p>
                    <p className="mt-1 text-xl font-black text-white">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Settlement record */}
            {hasSettlementRecord ? (
              <div className="mt-4 rounded-[14px] border border-white/[0.06] bg-[#141e30] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-cyan">Settlement record</p>
                    <h2 className="mt-1.5 text-base font-black text-white">
                      {market.status === 'Resolved'
                        ? `${market.winningOutcomeLabel ?? 'Winning outcome'} resolved`
                        : 'Market canceled'}
                    </h2>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusStyle[market.status]}`}>
                    {market.status}
                  </span>
                </div>
                <div className="mt-4 grid gap-x-10 gap-y-4 border-t border-white/[0.06] pt-4 md:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted">Evidence URI</p>
                    {market.resolutionURI ? (
                      <a href={market.resolutionURI} target="_blank" rel="noreferrer"
                        className="mt-1.5 block break-all text-sm font-bold leading-6 text-cyan hover:opacity-80">
                        {market.resolutionURI}
                      </a>
                    ) : (
                      <p className="mt-1.5 text-sm leading-6 text-muted">No evidence URI recorded.</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted">Your settlement</p>
                    <p className="mt-1.5 text-sm leading-6 text-white">
                      {connectedWallet
                        ? accountPreview?.hasClaimed ? 'Already claimed or refunded.'
                          : canClaim ? `${accountPreview?.claimable} claimable`
                          : canRefund ? `${accountPreview?.refundable} refundable`
                          : 'No settlement available.'
                        : 'Connect wallet to check.'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted">Audit trail</p>
                    <p className="mt-1.5 text-sm leading-6 text-muted">
                      Outcome, evidence, claim and refund previews are read directly from the Arc market contract.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {/* ── Right aside — trade panel ── */}
          <aside className="h-fit lg:sticky lg:top-24">
            <div className="rounded-[18px] border border-white/[0.06] bg-[#141e30] p-5">

              {/* YES / NO toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedOutcome('YES')}
                  className={`rounded-[12px] border py-4 text-center transition-all ${
                    selectedOutcome === 'YES'
                      ? 'border-cyan/40 bg-cyan/10 shadow-[0_0_16px_-4px_rgba(37,192,244,0.3)]'
                      : 'border-white/[0.06] bg-[#0f172a] hover:border-white/10'
                  }`}
                >
                  <p className="text-xs font-black text-muted">Buy YES</p>
                  <p className={`mt-1 text-2xl font-black ${selectedOutcome === 'YES' ? 'text-cyan' : 'text-white'}`}>
                    {yesOutcome.odds}¢
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedOutcome('NO')}
                  className={`rounded-[12px] border py-4 text-center transition-all ${
                    selectedOutcome === 'NO'
                      ? 'border-red-400/40 bg-red-400/10 shadow-[0_0_16px_-4px_rgba(248,113,113,0.2)]'
                      : 'border-white/[0.06] bg-[#0f172a] hover:border-white/10'
                  }`}
                >
                  <p className="text-xs font-black text-muted">Buy NO</p>
                  <p className={`mt-1 text-2xl font-black ${selectedOutcome === 'NO' ? 'text-red-300' : 'text-white'}`}>
                    {noOutcome.odds}¢
                  </p>
                </button>
              </div>

              {/* Amount input */}
              <div className="mt-5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted">Amount</label>
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted">USDC</span>
                </div>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-2 w-full bg-transparent text-4xl font-black text-white outline-none placeholder:text-white/20"
                  placeholder="0"
                  inputMode="decimal"
                />
                {/* Quick amounts */}
                <div className="mt-3 flex gap-2">
                  {quickAmounts.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setAmount(String(q))}
                      className={`flex-1 rounded-[8px] border py-1.5 text-xs font-black transition-colors ${
                        amount === String(q)
                          ? 'border-cyan/30 bg-cyan/10 text-cyan'
                          : 'border-white/[0.06] bg-[#0f172a] text-[#8fa0b4] hover:border-white/10 hover:text-white'
                      }`}
                    >
                      ${q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Trade summary */}
              <div className="mt-5 space-y-2.5 border-t border-white/[0.06] pt-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Avg price</span>
                  <span className="font-black text-white">{yesOutcome.odds}¢ per share</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Shares</span>
                  <span className="font-black text-white">{estimatedShares > 0 ? estimatedShares.toFixed(2) : '—'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Potential return</span>
                  <span className={`font-black ${potentialReturn > amountValue ? 'text-mint' : 'text-white'}`}>
                    {potentialReturn > 0 ? `$${potentialReturn.toFixed(2)}` : '—'}
                  </span>
                </div>
                <p className="pt-1 text-[11px] leading-5 text-muted">
                  Fixed share model — positions cannot be exited before settlement.
                </p>
              </div>

              {/* Buy button */}
              <button
                type="button"
                onClick={() => void runAction(() => placeTrade({ marketId, outcome: selectedOutcome, amount: amountValue }))}
                disabled={!canTrade || isSubmitting || amountValue <= 0}
                className={`mt-5 w-full rounded-[12px] py-4 font-black tracking-wide transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                  selectedOutcome === 'YES'
                    ? 'bg-cyan text-ink hover:opacity-90'
                    : 'bg-red-400 text-white hover:opacity-90'
                }`}
              >
                {!canTrade ? 'Market not open'
                  : isSubmitting ? 'Submitting...'
                  : amountValue <= 0 ? 'Enter an amount'
                  : `Buy ${selectedOutcome} · $${amountValue}`}
              </button>

              {/* Your position */}
              <div className="mt-5 border-t border-white/[0.06] pt-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted">Your position</p>
                {connectedWallet ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">YES shares</span>
                      <span className="font-black text-white">{accountPreview?.yesShares ?? '0.00'}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">NO shares</span>
                      <span className="font-black text-white">{accountPreview?.noShares ?? '0.00'}</span>
                    </div>
                    {claimableAmount > 0 ? (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted">Claimable</span>
                        <span className="font-black text-mint">{accountPreview?.claimable}</span>
                      </div>
                    ) : null}
                    {refundableAmount > 0 ? (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted">Refundable</span>
                        <span className="font-black text-cyan">{accountPreview?.refundable}</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">Connect a wallet to see your shares.</p>
                )}
              </div>

              {/* Settlement actions */}
              <div className="mt-5 border-t border-white/[0.06] pt-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted">Resolver actions</p>
                <p className="mt-2 text-xs leading-5 text-muted">
                  {connectedWallet
                    ? isResolver ? 'This wallet is the designated resolver.'
                      : 'Only the resolver wallet can settle this market.'
                    : 'Connect the resolver wallet to settle.'}
                </p>
                <input
                  value={resolutionURI}
                  onChange={(e) => setResolutionURI(e.target.value)}
                  placeholder="Resolution evidence URI"
                  className="mt-3 w-full rounded-[10px] border border-white/[0.06] bg-[#0f172a] px-3 py-2 text-sm text-white outline-none focus:border-cyan/40"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {[
                    { label: `Resolve ${selectedOutcome}`, action: () => resolveMarket({ marketId, outcome: selectedOutcome, resolutionURI }), disabled: !canUseResolverActions || !resolutionURI.trim() },
                    { label: 'Cancel', action: () => cancelMarket(marketId), disabled: !canUseResolverActions },
                    { label: 'Claim', action: () => claimMarket(marketId), disabled: !canClaim },
                    { label: 'Refund', action: () => refundMarket(marketId), disabled: !canRefund },
                  ].map(({ label, action, disabled }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => void runAction(action)}
                      disabled={isSubmitting || disabled}
                      className="rounded-[10px] border border-white/[0.06] bg-[#0f172a] px-3 py-2 text-xs font-black text-muted transition-colors hover:border-cyan/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status message */}
              {message ? (
                <p className={`mt-4 rounded-[12px] border px-4 py-3 text-sm font-bold ${
                  message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') || message.toLowerCase().includes('insufficient')
                    ? 'border-red-400/25 bg-red-400/10 text-red-200'
                    : 'border-mint/25 bg-mint/10 text-mint'
                }`}>
                  {message}
                </p>
              ) : null}
            </div>
          </aside>

        </div>
      </main>
      <SiteFooter />
    </>
  );
}
