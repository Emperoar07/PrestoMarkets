'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, LogOut } from 'lucide-react';
import {
  completePendingCircleSocialLogin,
  connectOfficialWalletProvider,
  disconnectExternalWallet,
  getExistingExternalWallet,
  setStoredConnectedWallet,
  shortAddress,
  type CircleSocialProvider,
  type CircleWalletLoginInput,
  type ConnectedWallet,
} from '@/lib/walletProvider';

export function WalletConnectButton() {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [status, setStatus] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showConnectPanel, setShowConnectPanel] = useState(false);
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);
  const isPending = status === 'Connecting...' || status === 'Opening Circle email verification...';

  useEffect(() => {
    completePendingCircleSocialLogin()
      .then((circleWallet) => circleWallet || getExistingExternalWallet())
      .then((existingWallet) => {
        setWallet(existingWallet);
        setStoredConnectedWallet(existingWallet);
      })
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Circle sign in failed.');
      });
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

  async function connectWallet(input?: CircleWalletLoginInput) {
    setStatus(input?.method === 'email' ? 'Opening Circle email verification...' : 'Connecting...');

    try {
      const connectedWallet = await connectOfficialWalletProvider(input);
      setWallet(connectedWallet);
      setStoredConnectedWallet(connectedWallet);
      setStatus('');
      setShowConnectPanel(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Wallet connection failed.');
    }
  }

  function signInWithSocial(provider: CircleSocialProvider) {
    void connectWallet({ method: 'social', provider });
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
                {wallet.mode === 'circle-user-controlled' ? 'App wallet' : 'External wallet'}
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
        title={status || 'Sign in with Circle User-Controlled Wallets'}
        className="rounded-lg bg-[#25c0f4] px-[18px] py-2 text-[13px] font-bold text-[#090e1a] transition-opacity hover:opacity-90"
      >
        {isPending ? 'Signing in...' : 'Sign In'}
      </button>

      {showConnectPanel ? (
        <div className="absolute right-0 mt-3 w-[430px] overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#101827] p-3 shadow-2xl shadow-black/30">
          <div className="relative overflow-hidden rounded-[18px] border border-white/[0.06] bg-[radial-gradient(circle_at_88%_12%,rgba(37,192,244,0.34),transparent_34%),linear-gradient(145deg,#d8f4ff_0%,#edf8ff_45%,#ffcdb8_100%)] p-5">
            <div className="absolute -right-12 top-4 h-44 w-44 rounded-full border-[24px] border-white/45 bg-cyan/35 shadow-2xl shadow-cyan/25" />
            <div className="absolute right-10 top-20 h-28 w-36 rotate-[-18deg] rounded-[999px] bg-[#95d7ff]/45 blur-[1px]" />
            <div className="absolute right-7 top-40 h-6 w-6 rounded-full bg-cyan/60" />

            <div className="relative w-[250px] rounded-[18px] border border-white/70 bg-white/85 p-5 text-[#101827] shadow-2xl shadow-[#294360]/20 backdrop-blur">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#25c0f4]" />
                <p className="text-xs font-black uppercase tracking-[0.14em]">Presto</p>
              </div>
              <h2 className="mt-5 text-2xl font-black">Sign up</h2>
              <p className="mt-1 text-[11px] font-semibold text-[#64748b]">Create or access your app wallet.</p>

              <label className="mt-4 block text-[11px] font-black text-[#1f2937]">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Email"
                className="mt-2 w-full rounded-[7px] border border-[#dbe5ef] bg-white px-3 py-2.5 text-xs font-semibold text-[#0f172a] outline-none focus:border-[#25c0f4]"
              />
              <p className="mt-3 text-[10px] font-semibold leading-4 text-[#64748b]">
                We will send an email with a verification code.
              </p>

              <button
                type="button"
                onClick={() => void connectWallet({ method: 'email', email })}
                disabled={isPending}
                className="mt-4 w-full rounded-[999px] bg-[#0b83d9] px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.08em] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Sign up
              </button>

              <div className="my-4 flex items-center gap-3">
                <div className="h-px flex-1 bg-[#dbe5ef]" />
                <span className="text-[10px] font-bold text-[#94a3b8]">or</span>
                <div className="h-px flex-1 bg-[#dbe5ef]" />
              </div>

              <div className="grid gap-2">
                <SocialButton label="Continue with Google" mark="G" onClick={() => signInWithSocial('google')} disabled={isPending} />
                <SocialButton label="Continue with Apple" mark="Apple" onClick={() => signInWithSocial('apple')} disabled={isPending} />
              </div>

              <p className="mt-4 text-[9px] font-semibold leading-4 text-[#64748b]">
                By continuing, you use Circle-powered app-native onboarding.
              </p>
            </div>
          </div>

          {status && !isPending ? (
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

function SocialButton(input: {
  label: string;
  mark: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={input.onClick}
      disabled={input.disabled}
      className="flex w-full items-center justify-center gap-2 rounded-[7px] border border-[#dbe5ef] bg-white px-3 py-2.5 text-[11px] font-black text-[#334155] shadow-sm transition-colors hover:border-[#25c0f4] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className={`flex h-4 min-w-4 items-center justify-center text-[11px] font-black ${input.mark === 'G' ? 'text-[#4285f4]' : 'text-black'}`}>
        {input.mark}
      </span>
      {input.label}
    </button>
  );
}
