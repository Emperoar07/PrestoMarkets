// Defensive redaction for anything returned to a browser from a privileged endpoint. Cron/agent
// errors can embed infrastructure secrets — RPC provider URLs carry the API key in the path
// (…/v2/KEY, quiknode.pro/KEY, drpc dkey=…), and stack/error text can echo a bearer token or a
// 0x-private-key. Even an authenticated admin's browser is a place those should never land ("no
// leaks"). Plain wallet addresses (0x + 40 hex) are intentionally left intact.
export function redactSecretsString(s: string): string {
  return s
    .replace(/https?:\/\/[^\s"']*(?:alchemy\.com|quiknode\.pro|drpc\.(?:org|live)|infura\.io)[^\s"']*/gi, '[rpc-endpoint-redacted]')
    .replace(/\b(dkey|apikey|api_key|token|key|secret)=[A-Za-z0-9._-]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b0x[a-fA-F0-9]{64}\b/g, '0x[redacted-64]');
}

export function redactSecrets<T>(value: T): T {
  try {
    return JSON.parse(redactSecretsString(JSON.stringify(value))) as T;
  } catch {
    return value;
  }
}
