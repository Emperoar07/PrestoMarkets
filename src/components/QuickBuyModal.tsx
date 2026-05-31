'use client';

import { useState, useEffect, useRef } from 'react';
import type { Market } from '@/lib/markets';
import { useAppState } from '@/lib/appState';
import { getOutcomeColor } from '@/lib/outcomeColors';
import { estimateParimutuelPayout } from '@/lib/marketUtils';
import type { StableSymbol } from '@/lib/walletBalance';
import { readPayWith, writePayWith } from '@/lib/payWithStore';

interface QuickBuyModalProps {
  market: Market & { source?: 'onchain'; closeDate?: string };
  initialOutcome: string;
  onClose: () => void;
}

const quickAmounts = [10, 25, 100, 500];

export function QuickBuyModal({ market, initialOutcome, onClose }: QuickBuyModalProps) {
  const { connectedWallet, placeTrade } = useAppState();
  const [selectedOutcome, setSelectedOutcome] = useState(initialOutcome);
  const [amount, setAmount] = useState('25');
  const [payWith, setPayWith] = useState<StableSymbol>('USDC');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  const isCircleWallet = connectedWallet?.mode === 'circle-user-controlled';
  const unit = payWith === 'EURC' ? 'EURC ' : '$';
  const isBinaryMarket = market.outcomes.length <= 2;

  // Sync stored stable preference
  useEffect(() => {
    if (!connectedWallet?.address) return;
    const stored = readPayWith(connectedWallet.address, market.id);
    if (stored) setPayWith(stored);
  }, [connectedWallet?.address, market.id]);

  // Set outcome from initial parameter
  useEffect(() => {
    if (!market.outcomes.length) return;
    const buyUpper = initialOutcome.toUpperCase();
    if (buyUpper === 'YES' || buyUpper === 'NO') {
      setSelectedOutcome(buyUpper);
    } else {
      const matched = market.outcomes.find(
        (o) => o.label.toUpperCase() === buyUpper
      );
      if (matched) {
        setSelectedOutcome(matched.label);
      } else {
        setSelectedOutcome(market.outcomes[0].label);
      }
    }
  }, [market, initialOutcome]);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  function choosePayWith(symbol: StableSymbol) {
    setPayWith(symbol);
    writePayWith(connectedWallet?.address, market.id, symbol);
  }

  const yesOutcome = market.outcomes.find((o) => o.label === 'YES') ?? market.outcomes[0];
  const noOutcome = market.outcomes.find((o) => o.label === 'NO') ?? market.outcomes[1] ?? yesOutcome;
  const activeOutcomeIndex = Math.max(0, market.outcomes.findIndex((outcome) => outcome.label === selectedOutcome));
  const activeOutcome = market.outcomes[activeOutcomeIndex] ?? yesOutcome;
  const activeOutcomeColor = getOutcomeColor(activeOutcomeIndex);
  
  const amountValue = Number(amount) || 0;
  const estimatedShares = amountValue > 0 ? amountValue : 0;
  const potentialReturn = estimateParimutuelPayout(amountValue, Number(activeOutcome.odds));
  const canTrade = market.status === 'Open' || market.status === 'Closing soon';

  async function handleBuy() {
    setIsSubmitting(true);
    setMessage('Waiting for wallet confirmation...');
    try {
      const result = await placeTrade({
        marketId: market.id,
        outcome: selectedOutcome,
        outcomeIndex: activeOutcomeIndex,
        amount: amountValue,
        payWith
      });
      setMessage(result.message);
      if (result.ok) {
        // Auto close after 2 seconds on success
        setTimeout(() => {
          onClose();
        }, 2000);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Transaction failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        ref={modalRef}
        className="w-full max-w-[420px] overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0c121d] p-5 shadow-2xl transition-all"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="rounded-full border border-cyan/25 bg-cyan/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan">
              {'Quick Trade'}
            </span>
            <h2 className="mt-1.5 line-clamp-2 text-sm font-black leading-snug text-white">
              {market.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[#8fa0b4] hover:bg-white/[0.08] hover:text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Outcome Selector */}
        <div className="mt-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#475569] mb-2">{'Select Outcome'}</p>
          {isBinaryMarket ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelectedOutcome('YES')}
                className={`rounded-[12px] border py-3 text-center transition-all ${
                  selectedOutcome === 'YES'
                    ? 'border-cyan/40 bg-cyan/10 shadow-[0_0_16px_-4px_rgba(37,192,244,0.3)]'
                    : 'border-white/[0.06] bg-[#0d1520] hover:border-white/10'
                }`}
              >
                <p className="text-[10px] font-black text-[#8fa0b4]">{'YES'}</p>
                <p className={`mt-0.5 text-xl font-black ${selectedOutcome === 'YES' ? 'text-cyan' : 'text-white'}`}>
                  {yesOutcome.odds}&cent;
                </p>
              </button>
              <button
                type="button"
                onClick={() => setSelectedOutcome('NO')}
                className={`rounded-[12px] border py-3 text-center transition-all ${
                  selectedOutcome === 'NO'
                    ? 'border-red-400/40 bg-red-400/10 shadow-[0_0_16px_-4px_rgba(248,113,113,0.2)]'
                    : 'border-white/[0.06] bg-[#0d1520] hover:border-white/10'
                }`}
              >
                <p className="text-[10px] font-black text-[#8fa0b4]">{'NO'}</p>
                <p className={`mt-0.5 text-xl font-black ${selectedOutcome === 'NO' ? 'text-red-300' : 'text-white'}`}>
                  {noOutcome.odds}&cent;
                </p>
              </button>
            </div>
          ) : (
            <div className="scrollbar-hide grid max-h-[140px] grid-cols-2 gap-2 overflow-y-auto pr-0.5">
              {market.outcomes.map((outcome, index) => {
                const active = selectedOutcome === outcome.label;
                const color = getOutcomeColor(index);
                return (
                  <button
                    key={`${outcome.label}-${index}`}
                    type="button"
                    onClick={() => setSelectedOutcome(outcome.label)}
                    style={active ? {
                      borderColor: `${color}70`,
                      backgroundColor: `${color}18`,
                      boxShadow: `0 0 16px -4px ${color}4D`,
                    } : undefined}
                    className={`min-w-0 rounded-[12px] border px-3 py-2.5 text-left transition-all ${
                      active ? '' : 'border-white/[0.06] bg-[#0d1520] hover:border-white/10'
                    }`}
                  >
                    <p className="truncate text-[10px] font-black text-[#8fa0b4]">{outcome.label}</p>
                    <p className={`mt-0.5 text-lg font-black ${active ? '' : 'text-white'}`} style={active ? { color } : undefined}>
                      {outcome.odds}&cent;
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Amount Input */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#475569]">{'Amount'}</label>
            <span className="text-[10px] font-black uppercase tracking-widest text-cyan">{payWith}</span>
          </div>
          <div className="relative mt-1.5 flex items-center rounded-[12px] border border-white/[0.06] bg-[#0d1520] px-3.5 py-2.5">
            <span className="text-2xl font-black text-[#475569] mr-1">$</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-transparent text-2xl font-black text-white outline-none placeholder:text-white/20"
              placeholder="0"
              inputMode="decimal"
            />
          </div>
          
          {/* Quick Amounts */}
          <div className="mt-2.5 flex gap-2">
            {quickAmounts.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmount(String(q))}
                className={`flex-1 rounded-[8px] border py-1.5 text-xs font-black transition-colors ${
                  amount === String(q)
                    ? 'border-cyan/30 bg-cyan/10 text-cyan'
                    : 'border-white/[0.06] bg-[#0d1520] text-[#8fa0b4] hover:border-white/10 hover:text-white'
                }`}
              >
                {unit}{q}
              </button>
            ))}
          </div>
        </div>


        {/* Est Return */}
        <div className="mt-3.5 space-y-2 border-t border-white/[0.04] pt-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[#8fa0b4]">{'Implied odds'}</span>
            <span className="font-black text-white">{activeOutcome.odds}%</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#8fa0b4]">{'Shares (1 USDC = 1 share)'}</span>
            <span className="font-black text-white">{estimatedShares > 0 ? estimatedShares.toFixed(2) : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#8fa0b4]">{'Est. payout if'} {activeOutcome.label} {'wins'}</span>
            <span className={`font-black ${potentialReturn > amountValue ? 'text-mint' : 'text-white'}`}>
              {potentialReturn > 0 ? `${unit}${potentialReturn.toFixed(2)}` : '—'}
            </span>
          </div>
        </div>

        {/* Notification Status message */}
        {message ? (
          <p className={`mt-4 rounded-[10px] border px-3 py-2 text-xs leading-5 ${
            message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') || message.toLowerCase().includes('insufficient') || message.toLowerCase().includes('expired')
              ? 'border-red-400/25 bg-red-400/10 text-red-200'
              : 'border-mint/25 bg-mint/10 text-mint'
          }`}>
            {message}
          </p>
        ) : null}

        {/* Submit Buy Button */}
        <button
          type="button"
          onClick={handleBuy}
          disabled={!canTrade || isSubmitting || amountValue <= 0}
          style={canTrade && amountValue > 0 ? { backgroundColor: activeOutcomeColor } : undefined}
          className={`mt-4 w-full rounded-[12px] py-3.5 text-center text-xs font-black uppercase tracking-wider text-ink transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[#1a2436] disabled:text-[#475569]`}
        >
          {!canTrade ? 'Market Closed'
            : isSubmitting ? 'Submitting...'
            : amountValue <= 0 ? 'Enter Amount'
            : `Buy ${selectedOutcome} · ${unit}${amountValue}`}
        </button>
      </div>
    </div>
  );
}
