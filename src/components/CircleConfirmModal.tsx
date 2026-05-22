'use client';

import { useEffect, useState } from 'react';
import { subscribeCircleConfirmation, type CircleConfirmDetails } from '@/lib/circleConfirm';

type PendingRequest = {
  id: number;
  details: CircleConfirmDetails;
  resolve: (approved: boolean) => void;
};

export function CircleConfirmModal() {
  const [pending, setPending] = useState<PendingRequest | null>(null);

  useEffect(() => subscribeCircleConfirmation(setPending), []);

  if (!pending) return null;
  const { details, resolve } = pending;
  const shortAddr = details.contractAddress.length > 12
    ? `${details.contractAddress.slice(0, 6)}…${details.contractAddress.slice(-4)}`
    : details.contractAddress;

  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-[#050b14]/90 px-4 py-8 backdrop-blur-md">
      <section className="relative w-full max-w-[460px] overflow-hidden rounded-[16px] border border-cyan/15 bg-[#0b1322] shadow-2xl shadow-black/50">
        <div className="bg-cyan/[0.04] px-6 pb-5 pt-7 text-center">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-cyan/80">Confirm with Circle</p>
          <h2 className="mt-3 text-[18px] font-black leading-tight text-white">{details.label}</h2>
          {details.action ? (
            <p className="mx-auto mt-2 max-w-[340px] text-[13px] leading-6 text-muted">{details.action}</p>
          ) : null}
        </div>

        <dl className="space-y-2.5 border-t border-white/[0.06] px-6 py-5 text-[13px]">
          {details.amountDisplay ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted">Amount</dt>
              <dd className="font-black text-cyan">{details.amountDisplay}</dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">Network fee</dt>
            <dd className="text-right font-bold text-white">{details.gasDisplay ?? '~$0.01 USDC'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">Function</dt>
            <dd className="text-right font-mono text-[12px] text-white">{details.functionSignature}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">Contract</dt>
            <dd className="text-right">
              {details.contractExplorerUrl ? (
                <a
                  href={details.contractExplorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[12px] text-cyan/80 hover:text-cyan"
                >
                  {shortAddr} ↗
                </a>
              ) : (
                <span className="font-mono text-[12px] text-white">{shortAddr}</span>
              )}
            </dd>
          </div>
          {details.parameters?.length ? (
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-wider text-muted">Parameters</dt>
              <ul className="mt-1.5 space-y-1">
                {details.parameters.map((p, idx) => (
                  <li key={idx} className="font-mono text-[11.5px] text-white/85">{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </dl>

        <p className="border-t border-white/[0.06] px-6 py-3 text-[11px] leading-5 text-muted/80">
          Circle will open its PIN prompt next. Network fees are paid in USDC and shown in that prompt.
        </p>

        <div className="flex border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => resolve(false)}
            className="flex-1 py-3.5 text-[13px] font-black text-muted transition-colors hover:bg-white/[0.03] hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => resolve(true)}
            className="flex-1 border-l border-white/[0.06] bg-cyan py-3.5 text-[13px] font-black text-ink transition-opacity hover:opacity-90"
          >
            Continue to PIN
          </button>
        </div>
      </section>
    </div>
  );
}
