import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const SAFE_URL_SCHEMES = new Set(['http:', 'https:']);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 0
  );
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) return isPrivateIpv6(host);
  return false;
}

export function isSafeHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return SAFE_URL_SCHEMES.has(parsed.protocol) && !isBlockedHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export async function assertPublicHttpUrl(value: string): Promise<URL> {
  const parsed = new URL(value);
  if (!SAFE_URL_SCHEMES.has(parsed.protocol) || isBlockedHostname(parsed.hostname)) {
    throw new Error('Only public http(s) source URLs are supported.');
  }

  const records = await lookup(parsed.hostname, { all: true, verbatim: true }).catch(() => []);
  for (const record of records) {
    if (record.family === 4 && isPrivateIpv4(record.address)) {
      throw new Error('Source URL resolves to a private network.');
    }
    if (record.family === 6 && isPrivateIpv6(record.address)) {
      throw new Error('Source URL resolves to a private network.');
    }
  }

  return parsed;
}
