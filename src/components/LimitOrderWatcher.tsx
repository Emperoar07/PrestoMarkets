'use client';

import { useEffect } from 'react';
import { parseUnits, formatUnits, type Address } from 'viem';
import { useAppState } from '@/lib/appState';
import { useTransactions } from '@/lib/transactions';
import { createArcReadClient } from '@/lib/arcClient';
import { prestoLmsrMarketAbi } from '@/lib/contracts';
import { buyLmsrShares, sellLmsrShares } from '@/lib/liveActions';
import { lmsrBuyTotalCost6 } from '@/lib/marketUtils';
import { shouldTriggerLimitOrder, limitBoundFromQuote, type LimitOrder } from '@/lib/limitOrders';

const POLL_MS = 15_000;

async function patchStatus(id: string, status: 'filled' | 'failed' | 'expired', extra?: { txHash?: string; lastError?: string }) {
  await fetch('/api/limit-orders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, status, ...extra }),
  }).catch(() => undefined);
}

/**
 * Mounts once (app shell). While the user's tab is open, it polls their open limit orders, reads the
 * live LMSR price for each, and fires the trade through their own wallet when the limit is crossed.
 * Fires one order at a time (each needs a wallet prompt) and only when the tab is visible.
 */
export function LimitOrderWatcher() {
  const { connectedWallet } = useAppState();
  const { track } = useTransactions();
  const address = connectedWallet?.address;

  useEffect(() => {
    if (!address) return;
    let active = true;
    let firing = false;

    async function fireOrder(order: LimitOrder) {
      const client = createArcReadClient();
      if (!client) return;
      const shares = Number(order.shares);
      const shares6 = parseUnits(order.shares, 6);
      // Fresh quote so the slippage bound reflects the price at fire time, not order time.
      const quote6 = order.side === 'sell'
        ? await client.readContract({
            address: order.marketId as Address,
            abi: prestoLmsrMarketAbi,
            functionName: 'sellRefund',
            args: [order.outcomeIndex, shares6],
          }).catch(() => null) as bigint | null
        : await Promise.all([
            client.readContract({
              address: order.marketId as Address,
              abi: prestoLmsrMarketAbi,
              functionName: 'buyCost',
              args: [order.outcomeIndex, shares6],
            }) as Promise<bigint>,
            client.readContract({
              address: order.marketId as Address,
              abi: prestoLmsrMarketAbi,
              functionName: 'feeBps',
            }) as Promise<number>,
          ])
            .then(([cost6, feeBps]) => lmsrBuyTotalCost6(cost6, Number(feeBps)))
            .catch(() => null) as bigint | null;
      const quoteValue = quote6 == null ? shares : Number(formatUnits(quote6, 6));
      const bound = limitBoundFromQuote(order.side, quoteValue, order.slippageBps);

      const label = `${order.side === 'sell' ? 'Sell' : 'Buy'} ${shares} ${order.outcomeLabel} (limit)`;
      try {
        const result = await track({ label }, () => (
          order.side === 'sell'
            ? sellLmsrShares({ marketAddress: order.marketId, outcome: order.outcomeLabel, outcomeIndex: order.outcomeIndex, shares, minRefund: bound })
            : buyLmsrShares({ marketAddress: order.marketId, outcome: order.outcomeLabel, outcomeIndex: order.outcomeIndex, shares, maxCost: bound })
        ));
        if (result.approvalOnly) return;
        await patchStatus(order.id, result.ok ? 'filled' : 'failed', {
          txHash: result.txHash,
          lastError: result.ok ? undefined : result.message,
        });
      } catch (error) {
        await patchStatus(order.id, 'failed', { lastError: error instanceof Error ? error.message : 'Limit order failed.' });
      }
    }

    async function tick() {
      if (!active || firing || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      const res = await fetch('/api/limit-orders', { cache: 'no-store' }).catch(() => null);
      if (!res || !res.ok) return;
      const data = await res.json().catch(() => null) as { orders?: LimitOrder[] } | null;
      const orders = data?.orders ?? [];
      if (orders.length === 0) return;

      const client = createArcReadClient();
      if (!client) return;

      for (const order of orders) {
        if (!active) break;
        if (order.expiresAt && new Date(order.expiresAt).getTime() < Date.now()) {
          await patchStatus(order.id, 'expired');
          continue;
        }
        const priceWad = await client.readContract({
          address: order.marketId as Address,
          abi: prestoLmsrMarketAbi,
          functionName: 'price',
          args: [order.outcomeIndex],
        }).catch(() => null) as bigint | null;
        if (priceWad == null) continue;
        const priceBps = Number(priceWad) / 1e14; // 1e18 WAD == 10000 bps
        if (shouldTriggerLimitOrder(order.side, priceBps, order.limitPriceBps)) {
          firing = true;
          try {
            await fireOrder(order);
          } finally {
            firing = false;
          }
          break; // one wallet prompt per tick; the next tick picks up any others
        }
      }
    }

    const interval = setInterval(() => { void tick(); }, POLL_MS);
    void tick();
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [address, track]);

  return null;
}
