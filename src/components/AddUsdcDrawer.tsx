'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { fetchArcStableBalances, readCachedUsdcBalance } from '@/lib/walletBalance';
import { fetchAvailableUsdc, formatAvailableUsdc, type AvailableUsdc } from '@/lib/unifiedBalance';
import { moveUsdcToArc, GATEWAY_SOURCES, type GatewaySourceKey, type MoveStep } from '@/lib/gatewayActions';
import { useTransactions } from '@/lib/transactions';
import { type ConnectedWallet } from '@/lib/walletProvider';
import type { Address } from 'viem';

const dexUrl = process.env.NEXT_PUBLIC_PRESTO_DEX_URL?.trim() || 'https://prestodex-arc.vercel.app';

const MOVE_STEP_LABEL: Record<MoveStep, string> = {
  'switching-source': 'Switching network…',
  approving: 'Approving USDC…',
  depositing: 'Depositing…',
  'awaiting-finality': 'Awaiting finality…',
  signing: 'Sign transfer…',
  attesting: 'Getting attestation…',
  'switching-arc': 'Switching to Arc…',
  minting: 'Crediting Arc…',
  done: 'Done',
};
const GATEWAY_SOURCE_KEYS = new Set<string>(['baseSepolia', 'sepolia', 'avalancheFuji', 'arbitrumSepolia']);

export function AddUsdcDrawer(input: {
  open: boolean;
  onClose: () => void;
  wallet: ConnectedWallet | null;
  /** 'modal' centers over the page; 'dropdown' anchors below the trigger (parent must be relative). */
  variant?: 'modal' | 'dropdown';
}) {
  const [balance, setBalance] = useState<string | null>(null);
  const [unified, setUnified] = useState<AvailableUsdc | null>(null);
  const [move, setMove] = useState<{ chain: string; step: MoveStep } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isDropdown = input.variant === 'dropdown';
  const hasExternalWallet = typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum);
  const { track } = useTransactions();

  async function handleMove(chainKey: string, amount: number) {
    if (!input.wallet?.address || move) return;
    setMoveError(null);
    setMove({ chain: chainKey, step: 'switching-source' });
    const label = `Move ${formatAvailableUsdc(amount)} from ${GATEWAY_SOURCES[chainKey as GatewaySourceKey].label} to Arc`;
    // Route through the global transactions feed so the move shows in activity toasts alongside
    // trades and claims; map MoveResult -> TrackResult (ok/txHash/message) for the reducer.
    const result = await track({ label, amountLabel: formatAvailableUsdc(amount) }, async () => {
      const moved = await moveUsdcToArc({
        source: chainKey as GatewaySourceKey,
        amountUsdc: amount,
        recipient: input.wallet!.address as Address,
        onStep: (step) => setMove({ chain: chainKey, step }),
      });
      return moved.ok
        ? { ok: true as const, txHash: moved.txHash, message: 'USDC credited on Arc' }
        : { ok: false as const, message: `${moved.error} (at ${moved.atStep})` };
    });
    if (result.ok) {
      window.dispatchEvent(new CustomEvent('presto:balances-refresh'));
      setMove({ chain: chainKey, step: 'done' });
      setTimeout(() => setMove(null), 2500);
    } else {
      setMoveError(result.message ?? 'Move to Arc failed.');
      setMove(null);
    }
  }

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
    // Multichain Available USDC (read-only Phase 1 of the Gateway rails).
    fetchAvailableUsdc(input.wallet.address)
      .then((result) => { if (!cancelled) setUnified(result); })
      .catch(() => undefined);
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
      const target = event.target as HTMLElement;
      if (target.closest('[aria-label="Open Add USDC dropdown"]')) return;
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) input.onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [input, isDropdown]);

  if (!input.open) return null;
  const header = (
    <div className="px-4 pb-3 pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-cyan/70">
          USDC
        </p>
        {!isDropdown && (
          <button
            type="button"
            onClick={input.onClose}
            className="flex h-5 w-5 items-center justify-center rounded-full text-[#8fa0b4] hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );

  const content = (
    <div className="flex flex-col gap-1 p-2 bg-[#090e1a]">
      {/* Balance Row */}
      <div className="flex items-center justify-between px-3 py-2 text-[12px] font-bold text-[#cbd5e1]">
        <span className="text-[#8fa0b4]">Arc Testnet Balance</span>
        <span className="text-base font-black text-cyan">{balance ?? '--'}</span>
      </div>

      {/* Per-chain breakdown */}
      {unified && unified.chains.some((chain) => !chain.isArc && chain.amount !== null) && (
        <div className="flex flex-col gap-1 border-t border-white/[0.06] pt-2 mt-1">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-cyan/70">Across chains</span>
            <span className="text-[12px] font-black text-white">{formatAvailableUsdc(unified.total)} total</span>
          </div>
          {unified.chains.filter((chain) => !chain.isArc).map((chain) => {
            const movable = GATEWAY_SOURCE_KEYS.has(chain.key) && (chain.amount ?? 0) > 0 && hasExternalWallet;
            const moving = move?.chain === chain.key;
            return (
              <div key={chain.key} className="flex items-center justify-between gap-2 px-3 py-1 text-[11px] font-bold text-[#8fa0b4]">
                <span>{chain.label}</span>
                <span className="flex items-center gap-2">
                  <span className="font-black text-[#cbd5e1]">
                    {chain.amount === null ? '—' : formatAvailableUsdc(chain.amount)}
                  </span>
                  {moving ? (
                    <span className="rounded-full border border-cyan/15 bg-cyan/5 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan animate-pulse">
                      {MOVE_STEP_LABEL[move.step]}
                    </span>
                  ) : movable ? (
                    <button
                      type="button"
                      onClick={() => void handleMove(chain.key, chain.amount as number)}
                      disabled={Boolean(move)}
                      className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#9fb0c8] transition-all hover:text-cyan hover:border-cyan/30 hover:bg-cyan/5 disabled:opacity-40"
                    >
                      Move to Arc
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
          {moveError ? (
            <p className="px-3 py-1 text-[10px] leading-relaxed text-red-300">{moveError}</p>
          ) : (
            <p className="px-3 py-1 text-[10px] leading-relaxed text-[#64748b]">
              {hasExternalWallet
                ? 'Move USDC from another chain into Arc via Circle Gateway — approve, deposit, then it’s credited on Arc.'
                : 'Connect an external wallet to move USDC across chains; or bridge via the links below.'}
            </p>
          )}
        </div>
      )}

      {/* Actions and Faucets styled like profile links */}
      <div className="flex flex-col gap-1 border-t border-white/[0.06] pt-2 mt-1">
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noreferrer"
          className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-bold text-[#94a3b8] transition-colors hover:text-white hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-75">
              <path d="M12 2.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5Z" />
            </svg>
            Circle Faucet
          </span>
          <ExternalLink className="h-3.5 w-3.5 opacity-60" />
        </a>

        <a
          href={dexUrl}
          target="_blank"
          rel="noreferrer"
          className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-bold text-[#94a3b8] transition-colors hover:text-white hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-75">
              <path d="m17 2 4 4-4 4" /><path d="M3 6h18" /><path d="m7 22-4-4 4-4" /><path d="M21 18H3" />
            </svg>
            Bridge or Swap USDC
          </span>
          <ExternalLink className="h-3.5 w-3.5 opacity-60" />
        </a>
      </div>

      <p className="px-3 py-2 text-[10px] leading-relaxed text-[#64748b]">
        Presto spends Arc Testnet USDC only. Circle App Kit / Unified Balance rails are wired as funding entry points here; every transfer still happens as an explicit user action.
      </p>
    </div>
  );

  if (isDropdown) {
    return (
      <div
        ref={panelRef}
        className="absolute right-0 mt-3 z-50 w-[360px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/40"
      >
        {header}
        <div className="h-px bg-white/[0.06]" />
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-end justify-center bg-[#050b14]/70 px-3 pb-3 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-[380px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/60">
        {header}
        <div className="h-px bg-white/[0.06]" />
        {content}
      </div>
    </div>
  );
}
