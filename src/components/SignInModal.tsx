'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount } from 'wagmi';
import { REQUIRE_SIGNIN_EVENT, useSocialSession } from '@/lib/socialSessionContext';
import { SocialSignInButton } from './SocialSignInButton';

export function SignInModal() {
  const [open, setOpen] = useState(false);
  const { isConnected } = useAccount();
  const { isSignedIn, refresh } = useSocialSession();

  useEffect(() => {
    function onRequire() {
      setOpen(true);
    }
    window.addEventListener(REQUIRE_SIGNIN_EVENT, onRequire);
    return () => window.removeEventListener(REQUIRE_SIGNIN_EVENT, onRequire);
  }, []);

  // Auto-close once signed in.
  useEffect(() => {
    if (isSignedIn) setOpen(false);
  }, [isSignedIn]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-[380px] rounded-[16px] border border-white/[0.08] bg-[#0b1322] p-6 shadow-2xl shadow-black/55">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-black text-white">Sign in to Presto</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-sm font-black text-white/40 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted">
          Sign a message with your wallet to write comments, save markets to your watchlist, and set alerts. It&apos;s free and gasless.
        </p>

        <div className="mt-5">
          {isConnected ? (
            <SocialSignInButton onSignedIn={() => { void refresh(); setOpen(false); }} />
          ) : (
            <p className="rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2.5 text-sm text-muted">
              Connect an external wallet first, then sign in.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
