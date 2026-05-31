'use client';

import { useTransactions, type TxStage } from '@/lib/transactions';

const ARC_TX_EXPLORER = 'https://testnet.arcscan.app/tx/';

const STAGE_META: Record<TxStage, { icon: string; title: string; cls: string; spin?: boolean }> = {
  confirming: { icon: '⟳', title: 'Confirming on Arc…', cls: 'border-cyan/30 bg-cyan/10 text-cyan', spin: true },
  confirmed: { icon: '✓', title: 'Confirmed', cls: 'border-mint/30 bg-mint/10 text-mint' },
  pending: { icon: '⏳', title: 'Submitted · still confirming', cls: 'border-amber-400/30 bg-amber-400/10 text-amber-300' },
  failed: { icon: '✕', title: 'Failed', cls: 'border-red-400/30 bg-red-400/10 text-red-200' },
  cancelled: { icon: '—', title: 'Cancelled', cls: 'border-white/15 bg-white/[0.06] text-muted' },
};

export function ToastStack() {
  const { entries, dismiss } = useTransactions();
  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {entries.map((entry) => {
        const meta = STAGE_META[entry.stage];
        return (
          <div
            key={entry.id}
            className={`pointer-events-auto rounded-[12px] border px-3.5 py-3 shadow-lg backdrop-blur ${meta.cls}`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2.5">
              <span className={`text-sm font-black ${meta.spin ? 'animate-spin' : ''}`} aria-hidden>{meta.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black">{meta.title}</p>
                <p className="mt-0.5 truncate text-[11px] font-bold text-white/90">
                  {entry.label}{entry.amountLabel ? ` · ${entry.amountLabel}` : ''}
                </p>
                {entry.error ? (
                  <p className="mt-1 break-words text-[11px] leading-4 text-red-200/90">{entry.error}</p>
                ) : null}
                {entry.txHash ? (
                  <a
                    href={`${ARC_TX_EXPLORER}${entry.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-[11px] font-bold underline underline-offset-2 hover:opacity-80"
                  >
                    View on Arc ↗
                  </a>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(entry.id)}
                className="text-xs font-black text-white/50 hover:text-white"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
