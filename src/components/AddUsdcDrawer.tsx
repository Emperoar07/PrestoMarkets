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
  recordCompletedMove,
  type GatewaySourceKey,
  type GatewaySourceBalance,
  type MoveStep,
  type PendingMove,
} from '@/lib/gatewayActions';
import { useTransactions } from '@/lib/transactions';
import { mintGatewayViaCircle } from '@/lib/circleActions';
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
// Don't list a source chain in "Across chains" unless it holds at least this much USDC.
const MIN_LISTED_USDC = 1;

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
  // For Circle/passkey wallets: the separately-connected browser EOA that actually holds the
  // cross-chain USDC and signs the Gateway burn intent (the Circle SCA can't — see below).
  const [eoaSigner, setEoaSigner] = useState<string | null>(null);
  // Only show sources whose balance can actually be moved (above the per-source Gateway fee) —
  // dust below the fee is hidden entirely rather than shown as a dead "below fee" row.
  const movableBySource = gatewayBySource.filter((s) => s.amount >= minCompletableUsdc(s.source));
  const gatewayBalance = movableBySource.reduce((sum, s) => sum + s.amount, 0);
  const panelRef = useRef<HTMLDivElement>(null);
  const isDropdown = input.variant === 'dropdown';
  const hasInjected = typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum);
  const isExternalWallet = input.wallet?.mode === 'external-eoa' && hasInjected;
  const isCircleWallet = input.wallet?.mode === 'circle-user-controlled' || input.wallet?.mode === 'circle-passkey';
  const connectedAddress = input.wallet?.address ?? null;
  // The wallet that SOURCES the cross-chain USDC and signs the Gateway burn intent.
  //  • External EOA  → itself.
  //  • Circle/passkey → a separately-connected browser EOA. Circle wallets are Arc-only SCAs:
  //    they don't exist on source chains to deposit from, and Gateway only accepts EOA
  //    signatures for burn intents (an SCA would need a registered EOA delegate). So the EOA
  //    sources + signs the move while the minted USDC is credited to the Circle Arc address.
  const depositorAddress = isExternalWallet ? connectedAddress : isCircleWallet ? eoaSigner : null;
  // Minted funds always land on the Presto-connected wallet's Arc address.
  const arcRecipient = connectedAddress;
  const canMove = Boolean(depositorAddress && arcRecipient);
  const { track } = useTransactions();

  function refreshGateway(address: string) {
    setPending(readPendingMoves(address));
    void getGatewayBalancesBySource(address as Address).then(setGatewayBySource).catch(() => undefined);
  }

  // Connect a browser EOA to source the cross-chain USDC for a Circle/passkey wallet.
  async function connectEoaSigner(prompt: boolean) {
    const eth = (window as { ethereum?: { request: (a: { method: string }) => Promise<unknown> } }).ethereum;
    if (!eth) {
      if (prompt) setMoveError('No external wallet found. Install or connect one holding USDC on another chain.');
      return;
    }
    try {
      const accounts = await eth.request({ method: prompt ? 'eth_requestAccounts' : 'eth_accounts' });
      if (Array.isArray(accounts) && typeof accounts[0] === 'string') setEoaSigner(accounts[0]);
    } catch {
      if (prompt) setMoveError('Could not connect the external wallet.');
    }
  }

  // Step 1 — deposit into Gateway (funds leave the source chain; finalize in minutes).
  // Deposits are made by the depositor EOA into ITS OWN Gateway balance.
  async function handleDeposit(chainKey: string, amount: number) {
    if (!depositorAddress || move) return;
    setMoveError(null);
    setMove({ key: chainKey, step: 'switching-source' });
    const label = `Deposit ${formatAvailableUsdc(amount)} from ${GATEWAY_SOURCES[chainKey as GatewaySourceKey].label} → Gateway`;
    const result = await track({ label, amountLabel: formatAvailableUsdc(amount) }, async () => {
      const r = await depositToGateway({
        source: chainKey as GatewaySourceKey, amountUsdc: amount,
        recipient: depositorAddress as Address,
        onStep: (step) => setMove({ key: chainKey, step }),
      });
      return r.ok
        ? { ok: true as const, txHash: r.txHash, message: 'Deposited — finalizing, then complete to Arc', pending: true }
        : { ok: false as const, message: `${r.error} (at ${r.atStep})` };
    });
    setMove(null);
    if (result.ok) {
      window.dispatchEvent(new CustomEvent('presto:balances-refresh'));
      refreshGateway(depositorAddress);
    } else {
      setMoveError(result.message ?? 'Deposit failed.');
    }
  }

  // Step 2 — move the available Gateway balance to Arc (also recovers an earlier stuck deposit).
  // The depositor EOA burns its Gateway balance + signs; minted USDC is credited to arcRecipient
  // (the same EOA for external wallets, or the Circle/passkey Arc address for Circle users).
  async function handleComplete(chainKey: string, amount: number, depositTx?: string) {
    if (!depositorAddress || !arcRecipient || move) return;
    setMoveError(null);
    setMove({ key: `complete-${chainKey}`, step: 'signing' });
    const label = `Move ${formatAvailableUsdc(amount)} to Arc`;
    const result = await track({ label, amountLabel: formatAvailableUsdc(amount) }, async () => {
      const r = await transferGatewayToArc({
        source: chainKey as GatewaySourceKey, amountUsdc: amount,
        recipient: depositorAddress as Address,
        arcRecipient: arcRecipient as Address,
        // Circle wallets submit the Arc mint themselves (they hold Arc gas), so the external EOA
        // that signed the burn intent never needs Arc gas — it only deposits on the source chain.
        ...(isCircleWallet ? { mintWith: mintGatewayViaCircle } : {}),
        onStep: (step) => setMove({ key: `complete-${chainKey}`, step }),
      });
      return r.ok
        ? { ok: true as const, txHash: r.txHash, message: 'USDC credited on Arc' }
        : { ok: false as const, message: r.error };
    });
    setMove(null);
    if (result.ok) {
      // Record under the Arc recipient (where the funds landed) so the Activity page — keyed by
      // the Presto-connected wallet — surfaces it. It isn't a Presto market event.
      recordCompletedMove({ source: chainKey as GatewaySourceKey, amountUsdc: amount, txHash: result.txHash ?? '', at: Date.now(), recipient: arcRecipient });
      // Pending records are keyed by the EOA depositor.
      if (depositTx) clearPendingMove(depositorAddress, depositTx);
      window.dispatchEvent(new CustomEvent('presto:balances-refresh'));
      refreshGateway(depositorAddress);
    } else {
      setMoveError(result.message ?? 'Move to Arc failed.');
    }
  }

  // For Circle/passkey wallets, silently adopt an already-authorized browser EOA on open so the
  // cross-chain rows light up without an extra click. A fresh prompt only happens on user action.
  useEffect(() => {
    if (!input.open || !isCircleWallet || eoaSigner) return;
    void connectEoaSigner(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.open, isCircleWallet]);

  useEffect(() => {
    if (!input.open || !connectedAddress) return;
    const arcAddress = connectedAddress;
    // Cross-chain/Gateway reads follow the EOA that holds the source-chain USDC (for external
    // wallets that's the same address; for Circle users it's the connected browser EOA).
    const sourceAddress = depositorAddress;
    let cancelled = false;
    const cached = readCachedUsdcBalance(arcAddress);
    if (cached) setBalance(cached);

    function loadBalances() {
      // Arc USDC/EURC balances are always the Presto-connected wallet's (where minted funds land).
      fetchArcStableBalances(arcAddress)
        .then((balances) => { if (!cancelled) setBalance(balances.USDC); })
        .catch(() => { if (!cancelled && !cached) setBalance(null); });
      fetchArcEurcBalance(arcAddress)
        .then((eurc) => { if (!cancelled) setEurcBalance(eurc); })
        .catch(() => undefined);
      if (sourceAddress) {
        fetchAvailableUsdc(sourceAddress)
          .then((result) => { if (!cancelled) setUnified(result); })
          .catch(() => undefined);
        refreshGateway(sourceAddress);
      } else {
        // No source EOA yet (Circle user hasn't connected one) — clear cross-chain state.
        setUnified(null);
        setGatewayBySource([]);
        setPending([]);
      }
    }

    loadBalances();
    // After a Move to Arc (or any balance-changing action) the Arc USDC/EURC balances must
    // re-fetch — the mint is confirmed, but RPC can lag ~1s, so refresh on the event and once more.
    function onRefresh() {
      loadBalances();
      window.setTimeout(() => { if (!cancelled) loadBalances(); }, 2500);
    }
    window.addEventListener('presto:balances-refresh', onRefresh);
    return () => { cancelled = true; window.removeEventListener('presto:balances-refresh', onRefresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.open, connectedAddress, depositorAddress]);

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

      {/* Circle/passkey wallets are Arc-only — to move USDC in from another chain the user connects
          a browser EOA that holds it. Once connected, the cross-chain rows below light up and any
          move is credited to this Circle wallet's Arc address. */}
      {isCircleWallet && !depositorAddress && (
        <div className="flex flex-col gap-1.5 border-t border-white/[0.06] pt-1.5 mt-0.5 px-1">
          <button
            type="button"
            onClick={() => void connectEoaSigner(true)}
            className="w-full rounded-lg border border-cyan/25 bg-cyan/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-cyan transition-all hover:bg-cyan/10"
          >
            Connect external wallet to move USDC in
          </button>
          <p className="px-2 text-[9px] leading-relaxed text-[#64748b]">
            Your Circle wallet lives on Arc. Hold USDC on another chain? Connect that wallet to move it
            here via Circle Gateway — it’s credited straight to your Circle Arc balance.
          </p>
        </div>
      )}

      {/* Per-chain breakdown */}
      {unified && unified.chains.some((chain) => !chain.isArc && (chain.amount ?? 0) >= MIN_LISTED_USDC) && (
        <div className="flex flex-col gap-0.5 border-t border-white/[0.06] pt-1.5 mt-0.5">
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-cyan/70">Across chains</span>
            <span className="text-[11px] font-black text-white">{formatAvailableUsdc(unified.total)} total</span>
          </div>
          {/* Only list source chains that actually hold a usable balance (>= 1 USDC). */}
          {unified.chains.filter((chain) => !chain.isArc && (chain.amount ?? 0) >= MIN_LISTED_USDC).map((chain) => {
            const movable = GATEWAY_SOURCE_KEYS.has(chain.key) && (chain.amount ?? 0) > 0 && canMove;
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
          ) : canMove ? (
            <p className="px-3 py-0.5 text-[9px] leading-relaxed text-[#64748b]">
              Move to Arc deposits into Circle Gateway, then completes once the deposit finalizes (up to ~20 min on Sepolia chains).
              {isCircleWallet ? ' Funds are credited to your Circle wallet’s Arc balance.' : ''}
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
      {canMove && (gatewayBalance > 0 || pending.length > 0) && (
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
