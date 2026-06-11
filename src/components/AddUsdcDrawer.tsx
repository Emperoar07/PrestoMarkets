'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, X } from 'lucide-react';
import { fetchArcStableBalances, readCachedUsdcBalance } from '@/lib/walletBalance';
import { shortAddress, type ConnectedWallet } from '@/lib/walletProvider';

const dexUrl = process.env.NEXT_PUBLIC_PRESTO_DEX_URL?.trim() || 'https://prestodex-arc.vercel.app';

export function AddUsdcDrawer(input: {
  open: boolean;
  onClose: () => void;
  wallet: ConnectedWallet | null;
  /** 'modal' centers over the page; 'dropdown' anchors below the trigger (parent must be relative). */
  variant?: 'modal' | 'dropdown';
}) {
  const [balance, setBalance] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const isDropdown = input.variant === 'dropdown';

  useEffect(() => {
    if (!input.open || !input.wallet?.address) return;
    let cancelled = false;
    const cached = readCachedUsdcBalance(input.wallet.address);
    if (cached) setBalance(cached);
    fetchArcStableBalances(input.wallet.address)
      .then((balances) => {
        if (!cancelled) setBalance(balances.USDC);
      })
      .catch(() => {
        if (!cancelled && !cached) setBalance(null);
      });
    return () => { cancelled = true; };
  }, [input.open, input.wallet?.address]);

  useEffect(() => {
    if (!input.open) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') input.onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [input]);

  // Dropdown mode has no backdrop, so close on outside click instead.
  useEffect(() => {
    if (!input.open || !isDropdown) return undefined;
    function onPointerDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) input.onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [input, isDropdown]);

  if (!input.open) return null;

  async function copyAddress() {
    if (!input.wallet?.address) return;
    await navigator.clipboard.writeText(input.wallet.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  const panelBody = (
    <>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan">Add USDC</p>
            <h2 className="mt-1 text-xl font-black text-white">Available USDC</h2>
          </div>
          <button
            type="button"
            onClick={input.onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-[#8fa0b4] transition hover:bg-white/[0.08] hover:text-white"
            aria-label="Close Add USDC drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 rounded-[14px] border border-cyan/20 bg-cyan/[0.06] p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-bold text-[#94a3b8]">Arc Testnet USDC</span>
            <span className="text-2xl font-black text-cyan">{balance ?? '--'}</span>
          </div>
          {input.wallet ? (
            <button
              type="button"
              onClick={() => void copyAddress()}
              className="mt-3 flex w-full min-w-0 items-center justify-between gap-3 rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-left text-xs font-bold text-[#94a3b8] transition hover:border-cyan/25 hover:text-white"
            >
              <span className="truncate">{shortAddress(input.wallet.address)}</span>
              <span className="inline-flex items-center gap-1.5 text-cyan">
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied' : 'Copy'}
              </span>
            </button>
          ) : (
            <p className="mt-3 text-xs leading-5 text-[#94a3b8]">Connect a wallet first so Presto knows where to receive USDC.</p>
          )}
        </div>

        <div className="mt-4 grid gap-2">
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-[12px] border border-cyan/25 bg-cyan/10 px-4 py-3 text-sm font-black text-cyan transition hover:bg-cyan/15"
          >
            Circle faucet
            <ExternalLink className="h-4 w-4" />
          </a>
          <a
            href={dexUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-[12px] border border-white/[0.08] bg-[#0d1520] px-4 py-3 text-sm font-black text-[#dbeafe] transition hover:border-cyan/25 hover:text-cyan"
          >
            Bridge or swap USDC
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>

        <p className="mt-4 text-xs leading-5 text-[#64748b]">
          Presto spends Arc Testnet USDC only. Circle App Kit / Unified Balance rails are wired as funding entry points here; every transfer still happens as an explicit user action.
        </p>
    </>
  );

  if (isDropdown) {
    return (
      <div
        ref={panelRef}
        className="absolute right-0 top-[calc(100%+8px)] z-[60] w-[400px] max-w-[calc(100vw-24px)] rounded-[18px] border border-white/[0.08] bg-[#0b1322] p-5 shadow-2xl shadow-black/60"
      >
        {panelBody}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-end justify-center bg-[#050b14]/70 px-3 pb-3 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-[440px] rounded-[18px] border border-white/[0.08] bg-[#0b1322] p-5 shadow-2xl shadow-black/60">
        {panelBody}
      </div>
    </div>
  );
}
