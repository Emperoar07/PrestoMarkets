'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

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

// confirmed/cancelled auto-dismiss; pending/failed are sticky until dismissed.
const AUTO_DISMISS_MS: Partial<Record<TxStage, number>> = { confirmed: 6_000, cancelled: 4_000 };

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
      settle(id, stage, { txHash: result.txHash, error: stage === 'failed' ? result.message : undefined });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed.';
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
