'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { humanizeTxError } from './txErrors';

export type TxStage = 'confirming' | 'confirmed' | 'pending' | 'failed' | 'cancelled';

export type TxEntry = {
  id: string;
  label: string;
  amountLabel?: string;
  stage: TxStage;
  txHash?: string;
  error?: string;
  createdAt: number;
};

type TrackResult = { ok: boolean; message?: string; txHash?: string; pending?: boolean };

/** Pure mapping from an action result to a terminal toast stage. Unit-tested. */
export function reduceStage(result: TrackResult): TxStage {
  if (!result.ok) {
    return /cancel/i.test(result.message ?? '') ? 'cancelled' : 'failed';
  }
  return result.pending ? 'pending' : 'confirmed';
}

type TrackMeta = { label: string; amountLabel?: string };

type TransactionContextValue = {
  entries: TxEntry[];
  track: <T extends TrackResult>(meta: TrackMeta, runner: () => Promise<T>) => Promise<T>;
  dismiss: (id: string) => void;
};

const TransactionContext = createContext<TransactionContextValue | null>(null);

// confirmed/cancelled auto-dismiss quickly; 'pending' (submitted, still confirming — e.g. a
// Gateway deposit finalizing) auto-dismisses after 10s so it doesn't linger; 'failed' stays
// sticky until the user dismisses it.
const AUTO_DISMISS_MS: Partial<Record<TxStage, number>> = { confirmed: 6_000, cancelled: 4_000, pending: 10_000 };

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `tx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function TransactionProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<TxEntry[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setEntries((list) => list.filter((entry) => entry.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const settle = useCallback((id: string, stage: TxStage, patch: Partial<TxEntry>) => {
    setEntries((list) => list.map((entry) => (entry.id === id ? { ...entry, ...patch, stage } : entry)));
    const ttl = AUTO_DISMISS_MS[stage];
    if (ttl) {
      const timer = setTimeout(() => dismiss(id), ttl);
      timers.current.set(id, timer);
    }
  }, [dismiss]);

  const track = useCallback(async <T extends TrackResult>(meta: TrackMeta, runner: () => Promise<T>): Promise<T> => {
    const id = newId();
    setEntries((list) => [
      { id, label: meta.label, amountLabel: meta.amountLabel, stage: 'confirming', createdAt: Date.now() },
      ...list,
    ]);
    try {
      const result = await runner();
      const stage = reduceStage(result);
      settle(id, stage, { txHash: result.txHash, error: stage === 'failed' ? humanizeTxError(result.message, result.message) : undefined });
      return result;
    } catch (error) {
      const message = humanizeTxError(error, 'Transaction failed.');
      const stage: TxStage = /cancel/i.test(message) ? 'cancelled' : 'failed';
      settle(id, stage, { error: stage === 'failed' ? message : undefined });
      throw error;
    }
  }, [settle]);

  return (
    <TransactionContext.Provider value={{ entries, track, dismiss }}>
      {children}
    </TransactionContext.Provider>
  );
}

export function useTransactions(): TransactionContextValue {
  const ctx = useContext(TransactionContext);
  if (!ctx) throw new Error('useTransactions must be used within TransactionProvider');
  return ctx;
}
