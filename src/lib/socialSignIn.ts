// Shared social sign-in logic used by the manual button and the automatic
// sign-in-on-connect flow. Establishes the presto_session for a wallet.
import { getCircleSession, refreshCircleSessionIfNeeded } from './walletProvider';

export const SOCIAL_CHANGED_EVENT = 'presto:social-changed';

/** External EOA: standard SIWE — nonce, wallet signs, server verifies the ECDSA signature. */
export async function signInExternalWallet(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<void> {
  const nonceRes = await fetch('/api/auth/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  const nonceBody = await nonceRes.json().catch(() => ({}));
  if (!nonceRes.ok) throw new Error(nonceBody.error ?? `Could not create sign-in nonce (HTTP ${nonceRes.status}).`);

  const signature = await signMessage(nonceBody.message);
  const verifyRes = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, nonce: nonceBody.nonce, message: nonceBody.message, signature }),
  });
  const verifyBody = await verifyRes.json().catch(() => ({}));
  if (!verifyRes.ok) throw new Error(verifyBody.error ?? `Sign-in failed (${verifyBody.error || `HTTP ${verifyRes.status}`}).`);
}

/**
 * Circle user-controlled wallet: smart-contract account, no ECDSA signature. Verify ownership
 * through Circle's API using the session userToken — silent, no PIN prompt.
 */
export async function signInCircleWallet(address: string): Promise<void> {
  const session = (await refreshCircleSessionIfNeeded()) ?? getCircleSession();
  if (!session?.userToken) {
    throw new Error('Your Circle session expired — reconnect your wallet and try again.');
  }
  const res = await fetch('/api/auth/verify-circle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, userToken: session.userToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Circle sign-in failed (HTTP ${res.status}).`);
}

export function broadcastSocialChanged() {
  window.dispatchEvent(new CustomEvent(SOCIAL_CHANGED_EVENT));
}
