// Env-only check split out of circlePasskey.ts so UI components can ask "is passkey login
// available?" without statically pulling in the Circle modular-wallets + viem
// account-abstraction stack (~1MB of client JS). Keep this module dependency-free.
const clientKey = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY?.trim() || '';
const clientUrl = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL?.trim() || '';
const placeholderValues = new Set(['', 'your_circle_client_key_here', 'your_circle_client_url_here']);

export const circlePasskeyClientKey = clientKey;
export const circlePasskeyClientUrl = clientUrl;

export function isCirclePasskeyConfigured() {
  return !placeholderValues.has(clientKey) && !placeholderValues.has(clientUrl);
}
