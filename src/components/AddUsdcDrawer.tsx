'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock, ExternalLink, Pencil, X } from 'lucide-react';
import { fetchArcStableBalances, fetchArcEurcBalance, readCachedUsdcBalance } from '@/lib/walletBalance';
import { fetchAvailableUsdc, formatAvailableUsdc, type AvailableUsdc } from '@/lib/unifiedBalance';
import {
  depositToGateway,
  transferGatewayToArc,
  getGatewayBalancesBySource,
  readPendingMoves,
  clearPendingMove,
  GATEWAY_SOURCES,
  minCompletableUsdc,
  type GatewaySourceKey,
  type GatewaySourceBalance,
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
  const [eurcBalance, setEurcBalance] = useState<string | null>(null);
  const [unified, setUnified] = useState<AvailableUsdc | null>(null);
  const [move, setMove] = useState<{ key: string; step: MoveStep } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [gatewayBySource, setGatewayBySource] = useState<GatewaySourceBalance[]>([]);
  const [pending, setPending] = useState<PendingMove[]>([]);
  // Custom-amount deposit: { chain, value } when the user opens the pencil to move a chosen amount.
  const [customDeposit, setCustomDeposit] = useState<{ chain: string; value: string } | null>(null);
  // Only show sources whose balance can actually be moved (above the per-source Gateway fee) —
  // dust below the fee is hidden entirely rather than shown as a dead "below fee" row.
  const movableBySource = gatewayBySource.filter((s) => s.amount >= minCompletableUsdc(s.source));
  const gatewayBalance = movableBySource.reduce((sum, s) => sum + s.amount, 0);
  const panelRef = useRef<HTMLDivElement>(null);
  const isDropdown = input.variant === 'dropdown';
  // Cross-chain Move to Arc signs source-chain txs via window.ethereum, so it only applies when
  // the CONNECTED wallet is an external EOA — not merely when MetaMask happens to be installed.
  // Circle/passkey wallets are provisioned on Arc only and already hold their USDC there, so they
  // can't (and don't need to) move funds in from another chain.
  const hasInjected = typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum);
  const isExternalWallet = input.wallet?.mode === 'external-eoa' && hasInjected;
  const isCircleWallet = input.wallet?.mode === 'circle-user-controlled' || input.wallet?.mode === 'circle-passkey';
  const { track } = useTransactions();

  function refreshGateway(address: string) {
    setPending(readPendingMoves(address));
    void getGatewayBalancesBySource(address as Address).then(setGatewayBySource).catch(() => undefined);
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
    fetchArcEurcBalance(input.wallet.address)
      .then((eurc) => { if (!cancelled) setEurcBalance(eurc); })
      .catch(() => undefined);
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
    <div className="px-3 pb-2.5 pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-cyan/70">
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
      <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-bold text-[#cbd5e1]">
        <span className="text-[#8fa0b4]">Arc Testnet USDC</span>
        <span className="text-sm font-black text-cyan">{balance ?? '--'}</span>
      </div>
      {/* EURC balance — only shown once the wallet holds euro stablecoin (euro markets). */}
      {eurcBalance && Number(eurcBalance.replace(/[^0-9.]/g, '')) > 0 ? (
        <div className="flex items-center justify-between px-3 py-1 text-[11px] font-bold text-[#cbd5e1]">
          <span className="text-[#8fa0b4]">Arc Testnet EURC</span>
          <span className="text-sm font-black text-amber-200">€{eurcBalance}</span>
        </div>
      ) : null}

      {/* Per-chain breakdown */}
      {unified && unified.chains.some((chain) => !chain.isArc && chain.amount !== null) && (
        <div className="flex flex-col gap-0.5 border-t border-white/[0.06] pt-1.5 mt-0.5">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-cyan/70">Across chains</span>
            <span className="text-[11px] font-black text-white">{formatAvailableUsdc(unified.total)} total</span>
          </div>
          {unified.chains.filter((chain) => !chain.isArc).map((chain) => {
            const movable = GATEWAY_SOURCE_KEYS.has(chain.key) && (chain.amount ?? 0) > 0 && isExternalWallet;
            const moving = move?.key === chain.key;
            return (
              <div key={chain.key} className="flex items-center justify-between gap-2 px-3 py-0.5 text-[10px] font-bold text-[#8fa0b4]">
                <span>{chain.label}</span>
                <span className="flex items-center gap-1.5">
                  <span className="font-black text-[#cbd5e1]">
                    {chain.amount === null ? '—' : formatAvailableUsdc(chain.amount)}
                  </span>
                  {moving ? (
                    <span className="rounded-full border border-cyan/15 bg-cyan/5 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-cyan animate-pulse">
                      {MOVE_STEP_LABEL[move.step]}
                    </span>
                  ) : movable && customDeposit?.chain === chain.key ? (
                    // Custom-amount entry: deposit a chosen amount instead of the whole balance.
                    <span className="flex items-center gap-1">
                      <input
                        type="number" inputMode="decimal" autoFocus
                        value={customDeposit.value}
                        max={chain.amount as number}
                        onChange={(e) => setCustomDeposit({ chain: chain.key, value: e.target.value })}
                        className="w-16 rounded-md border border-cyan/30 bg-[#0d1626] px-1.5 py-0.5 text-[10px] font-black text-white outline-none"
                        placeholder="0.00"
                      />
                      <button
                        type="button"
                        disabled={Boolean(move) || !(Number(customDeposit.value) > 0) || Number(customDeposit.value) > (chain.amount as number)}
                        onClick={() => { const v = Number(customDeposit.value); setCustomDeposit(null); void handleDeposit(chain.key, v); }}
                        className="rounded-full bg-cyan px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#07111f] transition-all hover:bg-cyan-300 disabled:opacity-40"
                      >Move</button>
                      <button type="button" onClick={() => setCustomDeposit(null)} className="text-[#64748b] hover:text-white"><X className="h-3 w-3" /></button>
                    </span>
                  ) : movable ? (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleDeposit(chain.key, chain.amount as number)}
                        disabled={Boolean(move)}
                        className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#9fb0c8] transition-all hover:text-cyan hover:border-cyan/30 hover:bg-cyan/5 disabled:opacity-40"
                      >
                        Move to Arc
                      </button>
                      {/* Pencil: move a custom amount instead of the whole balance. */}
                      <button
                        type="button"
                        title="Move a custom amount"
                        onClick={() => setCustomDeposit({ chain: chain.key, value: '' })}
                        disabled={Boolean(move)}
                        className="text-[#64748b] transition-colors hover:text-cyan disabled:opacity-40"
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
          {moveError ? (
            <p className="px-3 py-0.5 text-[9px] leading-relaxed text-red-300">{moveError}</p>
          ) : isExternalWallet ? (
            <p className="px-3 py-0.5 text-[9px] leading-relaxed text-[#64748b]">
              Move to Arc deposits into Circle Gateway, then completes once the deposit finalizes (up to ~20 min on Sepolia chains).
            </p>
          ) : isCircleWallet ? (
            <p className="px-3 py-0.5 text-[9px] leading-relaxed text-[#64748b]">
              Your Circle wallet lives on Arc and already holds its USDC here. Top up with the Circle faucet below — cross-chain Move to Arc is for external wallets holding USDC on another chain.
            </p>
          ) : (
            <p className="px-3 py-0.5 text-[9px] leading-relaxed text-[#64748b]">
              Connect an external wallet to move USDC across chains; or bridge via the links below.
            </p>
          )}
          <p className="px-3 pb-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-[#46586f]">
            Powered by Circle Gateway
          </p>
        </div>
      )}

      {/* Step 2 / recovery: funds sitting in Gateway, ready (or pending) to finish onto Arc. */}
      {isExternalWallet && (gatewayBalance > 0 || pending.length > 0) && (
        <div className="border border-white/[0.06] bg-[#0d1626]/20 rounded-xl p-2.5 mt-1.5 mx-1 flex flex-col gap-1.5">
          {/* Title & Status Bar */}
          <div className="flex items-center justify-between pb-1.5 border-b border-white/[0.04]">
            <div className="flex items-center gap-1.5">
              <span className="flex h-1.5 w-1.5 relative shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-[#8fa0b4]">In Gateway</span>
            </div>
            <span className="text-[10.5px] font-black text-cyan">{formatAvailableUsdc(gatewayBalance)} ready</span>
          </div>

          {/* List items */}
          <div className="flex flex-col divide-y divide-white/[0.04]">
            {/* Finalized balances */}
            {movableBySource.map((s) => (
              <div key={s.source} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                <div className="flex flex-col">
                  <span className="text-[11px] font-black text-white">{formatAvailableUsdc(s.amount)}</span>
                  <span className="text-[8.5px] font-bold text-[#64748b]">{GATEWAY_SOURCES[s.source].label}</span>
                </div>
                {move?.key === `complete-${s.source}` ? (
                  <span className="flex items-center gap-1 rounded-md border border-cyan/20 bg-cyan/5 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-cyan animate-pulse">
                    <svg className="animate-spin h-2.5 w-2.5 text-cyan shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {MOVE_STEP_LABEL[move.step]}
                  </span>
                ) : s.amount < minCompletableUsdc(s.source) ? (
                  // Below the source's Gateway fee + margin: can't be moved, so show why instead of a dead button.
                  <span className="rounded-md border border-white/[0.06] px-2 py-1 text-[8px] font-bold text-[#64748b]">Below ~{minCompletableUsdc(s.source).toFixed(2)} fee</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleComplete(s.source, s.amount)}
                    disabled={Boolean(move)}
                    className="rounded-md bg-cyan text-[#07111f] hover:bg-cyan-300 active:scale-95 disabled:opacity-40 disabled:pointer-events-none px-2 py-1 text-[8.5px] font-black uppercase tracking-wider transition-all duration-150 shadow-md shadow-cyan/5"
                  >
                    Complete → Arc
                  </button>
                )}
              </div>
            ))}

            {/* Finalizing balances */}
            {pending.filter((p) => !gatewayBySource.some((s) => s.source === p.source)).map((p) => {
              const minsLeft = Math.max(0, Math.ceil((FINALITY_MINUTES[p.source] ?? 19) - (Date.now() - p.depositedAt) / 60_000));
              return (
                <div key={p.depositTx} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black text-[#cbd5e1]/60">{formatAvailableUsdc(p.amountUsdc)}</span>
                    <span className="text-[8.5px] font-bold text-[#64748b]">{GATEWAY_SOURCES[p.source].label}</span>
                  </div>
                  <span className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-white/[0.01] px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-[#64748b]">
                    <Clock className="h-2.5 w-2.5 shrink-0" />
                    {minsLeft === 0 ? 'finalizing…' : `~${minsLeft} min`}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Alert subtitle description */}
          <p className="mt-0.5 text-[8.5px] leading-relaxed text-[#64748b] px-0.5">
            Deposited USDC is held in your Gateway balance and is safe. Complete the move once it finalizes.
          </p>
        </div>
      )}

      {/* Actions and Faucets styled like profile links */}
      <div className="flex flex-col gap-0.5 border-t border-white/[0.06] pt-1.5 mt-0.5">
        <a
          href="https://faucet.circle.com"
          target="_blank"
          rel="noreferrer"
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] font-bold text-[#94a3b8] transition-colors hover:text-white hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-75">
              <path d="M12 2.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5Z" />
            </svg>
            Circle Faucet (USDC / EURC)
          </span>
          <ExternalLink className="h-3 w-3 opacity-60" />
        </a>

        <a
          href={dexUrl}
          target="_blank"
          rel="noreferrer"
          className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] font-bold text-[#94a3b8] transition-colors hover:text-white hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-75">
              <path d="m17 2 4 4-4 4" /><path d="M3 6h18" /><path d="m7 22-4-4 4-4" /><path d="M21 18H3" />
            </svg>
            Bridge or Swap USDC
          </span>
          <ExternalLink className="h-3 w-3 opacity-60" />
        </a>
      </div>

      <p className="px-3 py-1.5 text-[9px] leading-relaxed text-[#64748b]">
        Presto spends Arc Testnet USDC only. Every transfer happens as an explicit user action.
      </p>
    </div>
  );

  if (isDropdown) {
    return (
      <div
        ref={panelRef}
        className="absolute right-0 mt-3 z-50 w-[346px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/40"
      >
        {header}
        <div className="h-px bg-white/[0.06]" />
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9998] flex items-end justify-center bg-[#050b14]/70 px-3 pb-3 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-[365px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/60">
        {header}
        <div className="h-px bg-white/[0.06]" />
        {content}
      </div>
    </div>
  );
}
