'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/lib/appState';
import type { LimitOrder } from '@/lib/limitOrders';

type OutcomeOption = { label: string; index: number };

export function LimitOrderPanel({ marketId, outcomes }: { marketId: string; outcomes: OutcomeOption[] }) {
  const { connectedWallet } = useAppState();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [outcomeIndex, setOutcomeIndex] = useState(0);
  const [limitPrice, setLimitPrice] = useState('50'); // cents
  const [shares, setShares] = useState('10');
  const [orders, setOrders] = useState<LimitOrder[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!connectedWallet?.address) { setOrders([]); return; }
    const res = await fetch('/api/limit-orders', { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) return;
    const data = await res.json().catch(() => null) as { orders?: LimitOrder[] } | null;
    setOrders((data?.orders ?? []).filter((o) => o.marketId.toLowerCase() === marketId.toLowerCase()));
  }, [connectedWallet?.address, marketId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeOutcome = useMemo(() => outcomes[outcomeIndex] ?? outcomes[0], [outcomes, outcomeIndex]);

  async function place() {
    setStatus('');
    const priceCents = Number(limitPrice);
    const shareQty = Number(shares);
    if (!Number.isFinite(priceCents) || priceCents <= 0 || priceCents >= 100) { setStatus('Limit price must be between 0 and 100c.'); return; }
    if (!Number.isFinite(shareQty) || shareQty <= 0) { setStatus('Enter a share amount.'); return; }
    if (!activeOutcome) { setStatus('Pick an outcome.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/limit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`),
          marketId,
          outcomeIndex: activeOutcome.index,
          outcomeLabel: activeOutcome.label,
          side,
          limitPriceBps: Math.round(priceCents * 100),
          shares: shareQty,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setStatus(data.error || 'Could not place the limit order.'); return; }
      setStatus(`Limit order placed: ${side} ${shareQty} ${activeOutcome.label} at ${priceCents}c.`);
      await refresh();
    } catch {
      setStatus('Could not place the limit order.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    await fetch('/api/limit-orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'canceled' }),
    }).catch(() => undefined);
    await refresh();
  }

  if (!connectedWallet) return null;

  const inputCls = 'w-full rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan/40';

  return (
    <div className="mt-4 rounded-[18px] border border-white/[0.06] bg-[#141e30] p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-black uppercase tracking-widest text-muted">Limit order</h3>
        <span className="text-[10px] font-bold text-muted/70">Fires while this tab is open</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-[12px] border border-white/[0.06] bg-[#0d1520] p-1">
        {(['buy', 'sell'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setSide(s)}
            className={`rounded-[9px] py-2 text-sm font-black transition-all border ${
              side === s ? (s === 'sell' ? 'border-red-400/70 text-red-200' : 'border-mint/70 text-mint') : 'border-transparent text-muted hover:text-white'
            }`}>
            {s === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      {outcomes.length > 2 ? (
        <select value={outcomeIndex} onChange={(e) => setOutcomeIndex(Number(e.target.value))} className={`mt-3 ${inputCls}`}>
          {outcomes.map((o) => <option key={o.index} value={o.index}>{o.label}</option>)}
        </select>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {outcomes.map((o) => (
            <button key={o.index} type="button" onClick={() => setOutcomeIndex(o.index)}
              className={`rounded-[10px] border py-2 text-sm font-bold transition-all ${
                outcomeIndex === o.index ? 'border-cyan/40 bg-cyan/10 text-white' : 'border-white/[0.06] bg-[#0d1520] text-muted hover:text-white'
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted">Trigger price (c)</span>
          <input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} inputMode="decimal" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted">Shares</span>
          <input value={shares} onChange={(e) => setShares(e.target.value)} inputMode="decimal" className={`mt-1 ${inputCls}`} />
        </label>
      </div>

      <button type="button" onClick={() => void place()} disabled={busy}
        className="mt-4 w-full rounded-[12px] bg-cyan px-3 py-3 text-sm font-black text-ink transition hover:opacity-90 disabled:opacity-50">
        {busy ? 'Placing…' : `Place limit ${side}`}
      </button>
      <p className="mt-2 text-[11px] leading-5 text-muted">
        We watch the live price while your app is open and fire this {side} through your wallet when it reaches {limitPrice || '0'}c.
      </p>
      {status ? <p className="mt-2 break-words text-[12px] text-cyan/90">{status}</p> : null}

      {orders.length > 0 ? (
        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted">Open orders</p>
          <div className="mt-2 flex flex-col gap-2">
            {orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 rounded-[10px] border border-white/[0.05] bg-[#0d1520]/40 px-3 py-2 text-[12px]">
                <span className="font-bold text-white">
                  {o.side === 'sell' ? 'Sell' : 'Buy'} {Number(o.shares)} {o.outcomeLabel} @ {(o.limitPriceBps / 100).toFixed(0)}c
                </span>
                <button type="button" onClick={() => void cancel(o.id)} className="text-[11px] font-bold text-red-300 hover:opacity-80">Cancel</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
