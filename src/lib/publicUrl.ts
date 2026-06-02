import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

const SAFE_URL_SCHEMES = new Set(['http:', 'https:']);
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

type PublicLookupRecord = {
  address: string;
  family: 4 | 6;
};

type PublicHttpUrlResolution = {
  url: URL;
  record: PublicLookupRecord;
};

type PublicFetchInit = RequestInit & {
  maxBytes?: number;
  timeoutMs?: number;
};

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

export async function resolvePublicHttpUrl(value: string): Promise<PublicHttpUrlResolution> {
  const parsed = new URL(value);
  if (!SAFE_URL_SCHEMES.has(parsed.protocol) || isBlockedHostname(parsed.hostname)) {
    throw new Error('Only public http(s) source URLs are supported.');
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const literalIpVersion = isIP(host);
  const records = literalIpVersion
    ? [{ address: host, family: literalIpVersion as 4 | 6 }]
    : await lookup(parsed.hostname, { all: true, verbatim: true }).catch(() => []);
  if (records.length === 0) {
    throw new Error('Source URL hostname does not resolve.');
  }

  for (const record of records) {
    if (record.family === 4 && isPrivateIpv4(record.address)) {
      throw new Error('Source URL resolves to a private network.');
    }
    if (record.family === 6 && isPrivateIpv6(record.address)) {
      throw new Error('Source URL resolves to a private network.');
    }
  }

  const record = records[0];
  if (!record || (record.family !== 4 && record.family !== 6)) {
    throw new Error('Source URL hostname does not resolve.');
  }

  return { url: parsed, record: { address: record.address, family: record.family } };
}

export async function assertPublicHttpUrl(value: string): Promise<URL> {
  const { url } = await resolvePublicHttpUrl(value);
  return url;
}

export async function fetchPublicHttpUrl(value: string, init: PublicFetchInit = {}): Promise<Response> {
  const { url, record } = await resolvePublicHttpUrl(value);
  const headers = new Headers(init.headers);
  const timeoutMs = init.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = init.maxBytes ?? Number.POSITIVE_INFINITY;
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(url, {
      method: init.method ?? 'GET',
      headers: Object.fromEntries(headers.entries()),
      lookup: ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
        callback(null, record.address, record.family);
      }) as never,
    }, (incoming) => {
      const chunks: Buffer[] = [];
      let total = 0;

      incoming.on('data', (chunk: Buffer) => {
        if (total < maxBytes) {
          const remaining = maxBytes - total;
          chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
        }
        total += chunk.length;
      });

      incoming.on('end', () => {
        const responseHeaders = new Headers();
        for (const [key, headerValue] of Object.entries(incoming.headers)) {
          if (Array.isArray(headerValue)) {
            for (const value of headerValue) responseHeaders.append(key, value);
          } else if (headerValue !== undefined) {
            responseHeaders.set(key, String(headerValue));
          }
        }

        resolve(new Response(Buffer.concat(chunks), {
          status: incoming.statusCode ?? 502,
          statusText: incoming.statusMessage,
          headers: responseHeaders,
        }));
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Source URL fetch timed out.'));
    });
    request.on('error', reject);
    request.end();
  });
}
