'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Copy, LogOut, X } from 'lucide-react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
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
import { arcTestnetChain, walletConnectProjectId } from '@/lib/rainbowConfig';

export function WalletConnectButton() {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { address: rainbowAddress, isConnected: isRainbowConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [status, setStatus] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showConnectPanel, setShowConnectPanel] = useState(false);
  const [email, setEmail] = useState('');
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [copied, setCopied] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const isPending = status === 'Connecting...' || status === 'Opening Circle email verification...';

  useEffect(() => {
    setIsMounted(true);
  }, []);

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
    if (!isRainbowConnected || !rainbowAddress) {
      return;
    }

    const externalWallet: ConnectedWallet = {
      address: rainbowAddress,
      mode: 'external-eoa',
    };
    setWallet(externalWallet);
    setStoredConnectedWallet(externalWallet);
    setShowConnectPanel(false);
    setStatus('');
  }, [isRainbowConnected, rainbowAddress]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!showConnectPanel) {
      return undefined;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowConnectPanel(false);
      }
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [showConnectPanel]);

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
    disconnect();
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

  const signInModal = showConnectPanel ? (
    <div
      className="fixed inset-0 z-[9999] grid place-items-center overflow-hidden bg-[#050b14]/88 px-4 py-8 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to Presto"
    >
      <div className="relative my-auto w-full max-w-[700px]">
        <button
          type="button"
          onClick={() => setShowConnectPanel(false)}
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#0f172a]/75 text-white shadow-lg shadow-black/20 transition-colors hover:border-cyan/40"
          aria-label="Close sign in modal"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative overflow-hidden rounded-[22px] border border-cyan/15 bg-[radial-gradient(circle_at_82%_20%,rgba(37,192,244,0.24),transparent_22%),linear-gradient(145deg,#0b1322_0%,#111b2d_56%,#132536_100%)] p-4 shadow-2xl shadow-black/45 sm:min-h-[380px] sm:p-6">
          <div className="absolute -right-5 top-8 hidden h-44 w-44 rounded-full border-[26px] border-cyan/10 bg-[#25c0f4]/14 shadow-xl shadow-cyan/10 sm:block" />
          <div className="absolute right-16 top-28 hidden h-24 w-32 rotate-[-18deg] rounded-[999px] bg-[#25c0f4]/10 blur-[1px] sm:block" />
          <div className="absolute right-10 top-48 hidden h-7 w-7 rounded-full bg-[#25c0f4]/45 sm:block" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#25c0f4]/10 to-transparent" />

          <div className="relative w-full max-w-[365px] rounded-[18px] border border-white/[0.08] bg-[#101a2c]/95 p-5 text-[#f8fafc] shadow-2xl shadow-black/20 backdrop-blur">
            <div className="flex items-center gap-2">
              <PrestoIcon />
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#f8fafc]">Presto</p>
            </div>
            <h2 className="mt-5 text-[26px] font-black leading-none text-white">
              {authMode === 'signup' ? 'Sign up' : 'Log in'}
            </h2>
            <p className="mt-1 text-[10px] font-semibold text-[#94a3b8]">
              {authMode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => setAuthMode((mode) => (mode === 'signup' ? 'login' : 'signup'))}
                className="font-black text-[#25c0f4] hover:text-[#7ddfff]"
              >
                {authMode === 'signup' ? 'Log in' : 'Sign up'}
              </button>
            </p>
            <p className="mt-2 text-xs font-semibold text-[#9fb0c8]">Create or access your app wallet.</p>

            <label className="mt-5 block text-[11px] font-black text-[#dbeafe]">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              className="mt-2 w-full rounded-[8px] border border-white/[0.08] bg-[#0b1322] px-3 py-2.5 text-xs font-semibold text-white outline-none transition-colors placeholder:text-[#64748b] focus:border-[#25c0f4]"
            />
            <p className="mt-3 text-[11px] font-semibold leading-4 text-[#94a3b8]">
              We will send an email with a verification code.
            </p>

            <button
              type="button"
              onClick={() => void connectWallet({ method: 'email', email })}
              disabled={isPending}
              className="mt-5 w-full rounded-[999px] bg-[#25c0f4] px-4 py-2.5 text-[11px] font-black uppercase tracking-[0.08em] text-[#090e1a] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {authMode === 'signup' ? 'Sign up' : 'Log in'}
            </button>

            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/[0.08]" />
              <span className="text-[11px] font-bold text-[#94a3b8]">or</span>
              <div className="h-px flex-1 bg-white/[0.08]" />
            </div>

            <div className="grid gap-2">
              <SocialButton provider="google" label="Continue with Google" onClick={() => signInWithSocial('google')} disabled={isPending} />
            </div>

            <p className="mt-4 text-[9px] font-semibold leading-4 text-[#94a3b8]">
              By continuing, you use Circle-powered app-native onboarding.
            </p>
          </div>

          {status && !isPending ? (
            <p className="relative mt-4 rounded-[12px] border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs font-bold text-red-100">
              {status}
            </p>
          ) : null}

          <RainbowExternalWalletRow />
        </div>
      </div>
    </div>
  ) : null;

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

      {isMounted && signInModal ? createPortal(signInModal, document.body) : null}
    </div>
  );
}

function RainbowExternalWalletRow() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, error, isPending, variables } = useConnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const needsArcSwitch = isConnected && chainId !== arcTestnetChain.id;
  const uniqueConnectors = connectors.filter((connector, index, list) => (
    list.findIndex((item) => item.name === connector.name) === index
  ));

  return (
    <div className="relative mt-3 rounded-[12px] border border-white/[0.08] bg-[#0d1627]/92 p-3 text-white shadow-lg shadow-black/20">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#94a3b8]">External EVM wallets</p>
          <p className="mt-1 text-[10px] font-bold text-[#64748b]">Connect directly here. No second modal.</p>
        </div>

        {needsArcSwitch ? (
          <button
            type="button"
            onClick={() => switchChain({ chainId: arcTestnetChain.id })}
            disabled={isSwitching}
            className="rounded-[10px] bg-[#25c0f4] px-4 py-2 text-xs font-black text-[#090e1a] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Switch to Arc
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {uniqueConnectors.map((connector) => {
          const walletConnector = connector as typeof connector & { icon?: string };
          const pendingConnector = isPending && variables?.connector?.name === connector.name;
          return (
            <button
              key={connector.name}
              type="button"
              onClick={() => connect({ connector, chainId: arcTestnetChain.id })}
              disabled={isPending}
              className="flex min-h-[46px] items-center gap-2 rounded-[10px] border border-cyan/15 bg-cyan/5 px-3 py-2 text-left text-xs font-black text-[#e2e8f0] transition-colors hover:border-cyan/45 hover:bg-cyan/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {walletConnector.icon ? (
                <img src={walletConnector.icon} alt="" className="h-5 w-5 rounded-full" />
              ) : (
                <span className="h-5 w-5 rounded-full border border-cyan/30 bg-cyan/15" />
              )}
              <span className="truncate">{pendingConnector ? 'Connecting...' : connector.name}</span>
            </button>
          );
        })}
      </div>

      {isConnected && address ? (
        <p className="mt-2 text-[10px] font-bold leading-4 text-[#94a3b8]">
          Connected external wallet: {shortAddress(address)}
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-[10px] font-bold leading-4 text-red-200">
          {error.message}
        </p>
      ) : null}

      {!walletConnectProjectId ? (
        <p className="mt-2 text-[10px] font-bold leading-4 text-[#94a3b8]">
          WalletConnect QR needs `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
        </p>
      ) : null}
    </div>
  );
}

function PrestoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="15" stroke="#25c0f4" strokeWidth="1.8" strokeOpacity="0.55" fill="#25c0f4" fillOpacity="0.08" />
      <circle cx="16" cy="16" r="10" stroke="#f8fafc" strokeWidth="1.8" strokeOpacity="0.92" fill="none" />
      <circle cx="16" cy="16" r="4.5" fill="#25c0f4" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function SocialButton(input: {
  label: string;
  provider: 'google';
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={input.onClick}
      disabled={input.disabled}
      className="flex w-full items-center justify-center gap-2 rounded-[7px] border border-white/[0.08] bg-[#0b1322] px-3 py-2 text-[11px] font-black text-[#e2e8f0] shadow-sm transition-colors hover:border-[#25c0f4] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="flex h-5 min-w-5 items-center justify-center">
        <GoogleIcon />
      </span>
      {input.label}
    </button>
  );
}
