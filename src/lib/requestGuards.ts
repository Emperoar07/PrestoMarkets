type RateLimitEntry = { count: number; resetAt: number };

type RateLimitOptions = {
  max: number;
  windowMs: number;
  now?: number;
  maxEntries?: number;
};

function normalizeHost(value: string) {
  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return '';
  }
}

export function getClientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0].trim()
    || headers.get('x-real-ip')
    || 'unknown';
}

export function hasBrowserOriginSignal(headers: Headers): boolean {
  return Boolean(headers.get('origin') || headers.get('referer'));
}

export function isTrustedBrowserOrigin(headers: Headers, configuredOrigins: Array<string | undefined> = []): boolean {
  const origin = headers.get('origin');
  const referer = headers.get('referer');
  if (!origin && !referer) return false;

  const allowed = new Set<string>(['presto-markets.vercel.app']);
  const host = headers.get('host');
  if (host) allowed.add(host.toLowerCase());

  for (const originValue of configuredOrigins) {
    const normalized = normalizeHost((originValue ?? '').trim());
    if (normalized) allowed.add(normalized);
  }

  const candidate = normalizeHost(origin || referer || '');
  return Boolean(candidate && allowed.has(candidate));
}

export function checkFixedWindowRateLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  options: RateLimitOptions,
): boolean {
  const now = options.now ?? Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + options.windowMs });
    const maxEntries = options.maxEntries ?? 5_000;
    if (store.size > maxEntries) {
      for (const [storeKey, value] of store) {
        if (now > value.resetAt) store.delete(storeKey);
      }
    }
    return true;
  }
  if (entry.count >= options.max) return false;
  entry.count++;
  return true;
}
