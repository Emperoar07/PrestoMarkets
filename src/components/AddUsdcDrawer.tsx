'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { fetchArcStableBalances, readCachedUsdcBalance } from '@/lib/walletBalance';
import { fetchAvailableUsdc, formatAvailableUsdc, type AvailableUsdc } from '@/lib/unifiedBalance';
import {
  depositToGateway,
  transferGatewayToArc,
  getGatewayUnifiedBalance,
  readPendingMoves,
  clearPendingMove,
  GATEWAY_SOURCES,
  type GatewaySourceKey,
  type MoveStep,
  type PendingMove,
} from '@/lib/gatewayActions';
import { useTransactions } from '@/lib/transactions';
import { type ConnectedWallet } from '@/lib/walletProvider';
import type { Address } from 'viem';

const dexUrl = process.env.NEXT_PUBLIC_PRESTO_DEX_URL?.trim() || 'https://prestodex-arc.vercel.app';

const MOVE_STEP_LABEL: Record<MoveStep, string> = {
  'switching-source': 'Switching network…',
  approving: 'Approving USDC…',
  depositing: 'Depositing…',
  signing: 'Sign transfer…',
  attesting: 'Getting attestation…',
  'switching-arc': 'Switching to Arc…',
  minting: 'Crediting Arc…',
  done: 'Done',
};
const GATEWAY_SOURCE_KEYS = new Set<string>(['baseSepolia', 'sepolia', 'avalancheFuji', 'arbitrumSepolia']);
// Sepolia-class testnets take up to ~20 min for Gateway deposit finality; Avalanche Fuji ~8s.
const FINALITY_MINUTES: Record<string, number> = { baseSepolia: 19, sepolia: 19, arbitrumSepolia: 19, avalancheFuji: 1 };

export function AddUsdcDrawer(input: {
  open: boolean;
  onClose: () => void;
  wallet: ConnectedWallet | null;
  /** 'modal' centers over the page; 'dropdown' anchors below the trigger (parent must be relative). */
  variant?: 'modal' | 'dropdown';
}) {
  const [balance, setBalance] = useState<string | null>(null);
  const [unified, setUnified] = useState<AvailableUsdc | null>(null);
  const [move, setMove] = useState<{ key: string; step: MoveStep } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [gatewayBalance, setGatewayBalance] = useState<number>(0);
  const [pending, setPending] = useState<PendingMove[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const isDropdown = input.variant === 'dropdown';
  const hasExternalWallet = typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum);
  const { track } = useTransactions();

  function refreshGateway(address: string) {
    setPending(readPendingMoves(address));
    void getGatewayUnifiedBalance(address as Address).then(setGatewayBalance).catch(() => undefined);
  }

  // Step 1 — deposit into Gateway (funds leave the source chain; finalize in minutes).
  async function handleDeposit(chainKey: string, amount: number) {
    if (!input.wallet?.address || move) return;
    setMoveError(null);
    setMove({ key: chainKey, step: 'switching-source' });
    const label = `Deposit ${formatAvailableUsdc(amount)} from ${GATEWAY_SOURCES[chainKey as GatewaySourceKey].label} → Gateway`;
    const result = await track({ label, amountLabel: formatAvailableUsdc(amount) }, async () => {
      const r = await depositToGateway({
        source: chainKey as GatewaySourceKey, amountUsdc: amount,
        recipient: input.wallet!.address as Address,
        onStep: (step) => setMove({ key: chainKey, step }),
      });
      return r.ok
        ? { ok: true as const, txHash: r.txHash, message: 'Deposited — finalizing, then complete to Arc', pending: true }
        : { ok: false as const, message: `${r.error} (at ${r.atStep})` };
    });
    setMove(null);
    if (result.ok) {
      window.dispatchEvent(new CustomEvent('presto:balances-refresh'));
      refreshGateway(input.wallet.address);
    } else {
      setMoveError(result.message ?? 'Deposit failed.');
    }
  }

  // Step 2 — move the available Gateway balance to Arc (also recovers an earlier stuck deposit).
  async function handleComplete(chainKey: string, amount: number, depositTx?: string) {
    if (!input.wallet?.address || move) return;
    setMoveError(null);
    setMove({ key: `complete-${chainKey}`, step: 'signing' });
    const label = `Move ${formatAvailableUsdc(amount)} to Arc`;
    const result = await track({ label, amountLabel: formatAvailableUsdc(amount) }, async () => {
      const r = await transferGatewayToArc({
        source: chainKey as GatewaySourceKey, amountUsdc: amount,
        recipient: input.wallet!.address as Address,
        onStep: (step) => setMove({ key: `complete-${chainKey}`, step }),
      });
      return r.ok
        ? { ok: true as const, txHash: r.txHash, message: 'USDC credited on Arc' }
        : { ok: false as const, message: r.error };
    });
    setMove(null);
    if (result.ok) {
      if (depositTx) clearPendingMove(input.wallet.address, depositTx);
      window.dispatchEvent(new CustomEvent('presto:balances-refresh'));
      refreshGateway(input.wallet.address);
    } else {
      setMoveError(result.message ?? 'Move to Arc failed.');
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
    // Gateway unified balance + any pending deposits (step 2 / recovery).
    refreshGateway(input.wallet.address);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            const moving = move?.key === chain.key;
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
                      onClick={() => void handleDeposit(chain.key, chain.amount as number)}
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
                ? 'Move to Arc deposits into Circle Gateway, then completes once the deposit finalizes (up to ~20 min on Sepolia chains).'
                : 'Connect an external wallet to move USDC across chains; or bridge via the links below.'}
            </p>
          )}
        </div>
      )}

      {/* Step 2 / recovery: funds sitting in Gateway, ready (or pending) to finish onto Arc. */}
      {hasExternalWallet && (gatewayBalance > 0 || pending.length > 0) && (
        <div className="flex flex-col gap-1 border-t border-white/[0.06] pt-2 mt-1">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-amber-300/80">In Gateway</span>
            <span className="text-[12px] font-black text-white">{formatAvailableUsdc(gatewayBalance)} ready</span>
          </div>
          {gatewayBalance > 0 && pending[0] ? (
            <div className="flex items-center justify-between gap-2 px-3 py-1 text-[11px] font-bold text-[#8fa0b4]">
              <span>Ready to credit on Arc</span>
              {move?.key === `complete-${pending[0].source}` ? (
                <span className="rounded-full border border-cyan/15 bg-cyan/5 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan animate-pulse">{MOVE_STEP_LABEL[move.step]}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleComplete(pending[0].source, Math.min(gatewayBalance, pending[0].amountUsdc), pending[0].depositTx)}
                  disabled={Boolean(move)}
                  className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-200 transition-all hover:bg-amber-300/20 disabled:opacity-40"
                >
                  Complete → Arc
                </button>
              )}
            </div>
          ) : null}
          {pending.map((p) => {
            const minsLeft = Math.max(0, Math.ceil((FINALITY_MINUTES[p.source] ?? 19) - (Date.now() - p.depositedAt) / 60_000));
            const ready = gatewayBalance >= p.amountUsdc || minsLeft === 0;
            return (
              <div key={p.depositTx} className="flex items-center justify-between gap-2 px-3 py-1 text-[10.5px] font-bold text-[#64748b]">
                <span>{formatAvailableUsdc(p.amountUsdc)} from {GATEWAY_SOURCES[p.source].label}</span>
                <span className={ready ? 'text-amber-200' : 'text-[#64748b]'}>
                  {ready ? 'finalized' : `~${minsLeft} min`}
                </span>
              </div>
            );
          })}
          <p className="px-3 py-1 text-[10px] leading-relaxed text-[#64748b]">
            Deposited USDC is held in your Gateway balance and is safe. Complete the move once it finalizes.
          </p>
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
