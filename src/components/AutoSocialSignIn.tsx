'use client';

import { useEffect, useRef } from 'react';
import { useSignMessage } from 'wagmi';
import { useAppState } from '@/lib/appState';
import { useSocialSession } from '@/lib/socialSessionContext';
import { broadcastSocialChanged, signInCircleWallet, signInExternalWallet } from '@/lib/socialSignIn';

/**
 * Merges social sign-in into wallet connect: when a wallet is connected but there's no matching
 * social session, establish one automatically. Circle wallets verify silently via API; external
 * wallets get a single SIWE signature prompt. Each address is attempted once per page load so a
 * rejected/expired sign-in never loops.
 */
export function AutoSocialSignIn() {
  const { connectedWallet } = useAppState();
  const { address: sessionAddress, isSignedIn, ready, refresh } = useSocialSession();
  const { signMessageAsync } = useSignMessage();
  const attempted = useRef<Set<string>>(new Set());
  const inFlight = useRef(false);

  const walletAddress = connectedWallet?.address ?? null;
  const walletMode = connectedWallet?.mode ?? null;

  useEffect(() => {
    if (!ready || !walletAddress || !walletMode || inFlight.current) return;

    const addr = walletAddress.toLowerCase();
    if (isSignedIn && sessionAddress?.toLowerCase() === addr) return; // already signed in as this wallet
    // Passkey wallets are smart accounts with no ECDSA key, so plain SIWE can't verify them and
    // there's no Circle userToken session to verify against either. Skip auto sign-in for them
    // (social features need ERC-1271 verification — tracked separately) rather than firing a broken
    // SIWE prompt. Trading/funding still work fully via the passkey bundler.
    if (walletMode === 'circle-passkey') return;
    if (attempted.current.has(addr)) return; // only try once per address per page load
    attempted.current.add(addr);

    void (async () => {
      inFlight.current = true;
      try {
        if (walletMode === 'circle-user-controlled') {
          await signInCircleWallet(walletAddress);
        } else {
          await signInExternalWallet(walletAddress, (m) => signMessageAsync({ message: m }));
        }
        broadcastSocialChanged();
        await refresh();
      } catch {
        // Non-fatal — the manual "Sign in" prompt remains available.
      } finally {
        inFlight.current = false;
      }
    })();
  }, [walletAddress, walletMode, isSignedIn, sessionAddress, ready, refresh, signMessageAsync]);

  return null;
}
