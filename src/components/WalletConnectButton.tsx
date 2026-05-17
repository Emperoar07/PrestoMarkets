'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, LogOut } from 'lucide-react';
import {
  connectOfficialWalletProvider,
  disconnectExternalWallet,
  getExistingExternalWallet,
  setStoredConnectedWallet,
  shortAddress,
  type ConnectedWallet,
} from '@/lib/walletProvider';

export function WalletConnectButton() {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [status, setStatus] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showConnectPanel, setShowConnectPanel] = useState(false);
  const [circleUserId, setCircleUserId] = useState('');
  const [copied, setCopied] = useState(false);
  const circleEnabled = process.env.NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED === 'true';

  useEffect(() => {
    getExistingExternalWallet()
      .then((existingWallet) => {
        setWallet(existingWallet);
        setStoredConnectedWallet(existingWallet);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  async function connectWallet(userId?: string) {
    setStatus('Connecting...');

    try {
      const connectedWallet = await connectOfficialWalletProvider({ userId });
      setWallet(connectedWallet);
      setStoredConnectedWallet(connectedWallet);
      setStatus('');
      setShowConnectPanel(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Wallet connection failed.');
    }
  }

  async function copyAddress() {
    if (!wallet) return;

    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function disconnectWallet() {
    await disconnectExternalWallet();
    setWallet(null);
    setIsOpen(false);
    setStatus('');
  }

  if (wallet) {
    return (
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setIsOpen((value) => !value)}
          className="flex items-center gap-2 rounded-lg border border-white/10 px-[14px] py-2 text-[13px] font-bold text-[#f1f5f9] transition-colors hover:border-cyan/35"
        >
          {wallet.mode === 'circle-user-controlled' ? 'Circle ' : ''}{shortAddress(wallet.address)}
          <ChevronDown className={`h-3.5 w-3.5 text-[#94a3b8] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen ? (
          <div className="absolute right-0 mt-3 w-[280px] rounded-[16px] border border-white/[0.08] bg-[#141e30] p-3 shadow-2xl shadow-black/30">
            <div className="rounded-[12px] border border-white/[0.06] bg-[#0f172a] p-3">
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#94a3b8]">Connected wallet</p>
              <p className="mt-2 break-all text-sm font-bold text-white">{wallet.address}</p>
              <p className="mt-1 text-xs text-[#94a3b8]">
                {wallet.mode === 'circle-user-controlled' ? 'Circle User-Controlled Wallets' : 'External wallet'}
              </p>
            </div>

            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={() => void copyAddress()}
                className="flex items-center justify-between rounded-[12px] border border-white/[0.06] bg-[#0f172a] px-3 py-3 text-left text-sm font-bold text-white transition-colors hover:border-cyan/30"
              >
                <span className="flex items-center gap-2">
                  {copied ? <Check className="h-4 w-4 text-mint" /> : <Copy className="h-4 w-4 text-cyan" />}
                  {copied ? 'Copied address' : 'Copy address'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void disconnectWallet()}
                className="flex items-center gap-2 rounded-[12px] border border-white/[0.06] bg-[#0f172a] px-3 py-3 text-left text-sm font-bold text-red-200 transition-colors hover:border-red-300/30"
              >
                <LogOut className="h-4 w-4" />
                Disconnect wallet
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setShowConnectPanel((value) => !value)}
        title={status || 'Connect with Circle User-Controlled Wallets'}
        className="rounded-lg bg-[#25c0f4] px-[18px] py-2 text-[13px] font-bold text-[#090e1a] transition-opacity hover:opacity-90"
      >
        {status === 'Connecting...' ? 'Connecting...' : 'Connect Wallet'}
      </button>

      {showConnectPanel ? (
        <div className="absolute right-0 mt-3 w-[340px] rounded-[16px] border border-white/[0.08] bg-[#141e30] p-4 shadow-2xl shadow-black/30">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan">Circle wallet</p>
          <h2 className="mt-2 text-lg font-black text-white">Sign in to Presto</h2>
          <p className="mt-2 text-sm leading-6 text-[#94a3b8]">
            Use Circle User-Controlled Wallets for app-native onboarding. Your keyshare stays with you through Circle&apos;s Web SDK.
          </p>

          <label className="mt-4 block text-xs font-black uppercase tracking-[0.16em] text-[#94a3b8]">
            Email or user ID
          </label>
          <input
            value={circleUserId}
            onChange={(event) => setCircleUserId(event.target.value)}
            className="mt-2 w-full rounded-[12px] border border-white/[0.06] bg-[#0f172a] px-3 py-3 text-sm text-white outline-none focus:border-cyan/50"
          />

          <button
            type="button"
            onClick={() => void connectWallet(circleUserId)}
            disabled={!circleEnabled || status === 'Connecting...'}
            className="mt-4 w-full rounded-[10px] bg-[#25c0f4] px-5 py-3 text-sm font-black text-[#090e1a] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continue with Circle
          </button>
          {!circleEnabled ? (
            <p className="mt-2 text-xs leading-5 text-[#94a3b8]">
              Circle wallets are disabled until `NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED=true` and Circle credentials are configured.
            </p>
          ) : null}
          {status && status !== 'Connecting...' ? (
            <p className="mt-2 rounded-[10px] border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-200">
              {status}
            </p>
          ) : null}

          <div className="my-4 h-px bg-white/[0.06]" />
          <button
            type="button"
            onClick={() => void connectWallet()}
            className="w-full rounded-[10px] border border-white/[0.06] bg-[#0f172a] px-5 py-3 text-sm font-black text-white transition-colors hover:border-cyan/30"
          >
            Use external wallet
          </button>
        </div>
      ) : null}
    </div>
  );
}
