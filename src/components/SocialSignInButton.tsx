'use client';

import { useState } from 'react';
import { useSignMessage } from 'wagmi';
import { useAppState } from '@/lib/appState';
import { broadcastSocialChanged, signInCircleWallet, signInExternalWallet } from '@/lib/socialSignIn';

export function SocialSignInButton({
  onSignedIn,
  label = 'Sign in to write',
  buttonClassName,
}: {
  onSignedIn?: () => void;
  label?: string;
  buttonClassName?: string;
}) {
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
      } else if (connectedWallet.mode === 'circle-passkey') {
        // Passkey smart account signs the SIWE nonce via WebAuthn; the server verifies it with
        // ERC-1271/ERC-6492 (no ECDSA key, no Circle userToken session).
        setMessage('Confirm with your passkey…');
        await signInExternalWallet(connectedWallet.address, async (m) => {
          const { signCirclePasskeyMessage } = await import('@/lib/circlePasskey');
          return signCirclePasskeyMessage(m);
        });
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
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => void signIn()}
        disabled={isSigning || !connectedWallet}
        className={buttonClassName || "rounded-[8px] border border-cyan/30 bg-cyan/10 px-4 py-2.5 text-xs font-black text-cyan transition-colors hover:bg-cyan/15 disabled:cursor-not-allowed disabled:opacity-50"}
      >
        {isSigning ? 'Signing...' : label}
      </button>
      {message ? <p className="text-xs text-muted">{message}</p> : null}
    </div>
  );
}
