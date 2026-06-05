'use client';

import { useState } from 'react';
import { useSignMessage } from 'wagmi';
import { useAppState } from '@/lib/appState';
import { broadcastSocialChanged, signInCircleWallet, signInExternalWallet } from '@/lib/socialSignIn';

export function SocialSignInButton({ onSignedIn }: { onSignedIn?: () => void }) {
  const { connectedWallet } = useAppState();
  const { signMessageAsync } = useSignMessage();
  const [message, setMessage] = useState('');
  const [isSigning, setIsSigning] = useState(false);

  async function signIn() {
    if (!connectedWallet?.address) {
      setMessage('Connect a wallet first.');
      return;
    }

    setIsSigning(true);
    setMessage('Preparing sign-in...');
    try {
      if (connectedWallet.mode === 'circle-user-controlled') {
        setMessage('Verifying your Circle wallet…');
        await signInCircleWallet(connectedWallet.address);
      } else {
        setMessage('Sign the message in your wallet.');
        await signInExternalWallet(connectedWallet.address, (m) => signMessageAsync({ message: m }));
      }

      setMessage('Signed in.');
      broadcastSocialChanged();
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
        disabled={isSigning || !connectedWallet}
        className="rounded-[8px] border border-cyan/30 bg-cyan/10 px-3 py-2 text-xs font-black text-cyan transition-colors hover:bg-cyan/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSigning ? 'Signing...' : 'Sign in to write'}
      </button>
      {message ? <p className="text-xs text-muted">{message}</p> : null}
    </div>
  );
}
