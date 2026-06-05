'use client';

import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';

export function SocialSignInButton({ onSignedIn }: { onSignedIn?: () => void }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [message, setMessage] = useState('');
  const [isSigning, setIsSigning] = useState(false);

  async function signIn() {
    if (!address) {
      setMessage('Connect an external wallet first.');
      return;
    }

    setIsSigning(true);
    setMessage('Preparing sign-in...');
    try {
      const nonceRes = await fetch('/api/auth/nonce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const nonceBody = await nonceRes.json();
      if (!nonceRes.ok) throw new Error(nonceBody.error ?? 'Could not create sign-in nonce.');

      setMessage('Sign the message in your wallet.');
      const signature = await signMessageAsync({ message: nonceBody.message });
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          nonce: nonceBody.nonce,
          message: nonceBody.message,
          signature,
        }),
      });
      const verifyBody = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyBody.error ?? 'Sign-in failed.');

      setMessage('Signed in.');
      // Let any mounted session consumer (watchlist, alerts, header) re-read the session.
      window.dispatchEvent(new CustomEvent('presto:social-changed'));
      onSignedIn?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setIsSigning(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => void signIn()}
        disabled={isSigning || !isConnected}
        className="rounded-[8px] border border-cyan/30 bg-cyan/10 px-3 py-2 text-xs font-black text-cyan transition-colors hover:bg-cyan/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSigning ? 'Signing...' : 'Sign in to write'}
      </button>
      {message ? <p className="text-xs text-muted">{message}</p> : null}
    </div>
  );
}
