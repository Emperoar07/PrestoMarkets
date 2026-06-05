// Server-only helpers for talking to Circle's W3S API with the platform API key.
const CIRCLE_BASE_URL = (process.env.CIRCLE_BASE_URL || 'https://api.circle.com').trim();

/**
 * Returns the wallet addresses (lowercased) that the given Circle userToken controls.
 * The userToken is a short-lived bearer issued by Circle to the authenticated user, so a
 * successful lookup proves the caller controls those wallets — enough to grant a social session.
 */
export async function listCircleWalletAddresses(userToken: string): Promise<string[]> {
  const apiKey = (process.env.CIRCLE_API_KEY || '').trim();
  if (!apiKey) throw new Error('CIRCLE_API_KEY is not configured.');

  const res = await fetch(`${CIRCLE_BASE_URL}/v1/w3s/wallets`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-User-Token': userToken,
    },
  });

  const json = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const err = json as { message?: string; error?: string };
    throw new Error(err.message || err.error || 'Circle wallet lookup failed.');
  }

  const data = (json as { data?: unknown }).data ?? json;
  const wallets = (data as { wallets?: Array<{ address?: string }> }).wallets ?? [];
  return wallets
    .map((w) => w.address)
    .filter((a): a is string => typeof a === 'string' && a.length > 0)
    .map((a) => a.toLowerCase());
}
