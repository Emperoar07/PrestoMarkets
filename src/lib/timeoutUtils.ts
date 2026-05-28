/**
 * Helper to add timeout protection to async operations.
 * Returns a function that wraps fetch/async operations with AbortController.
 */

export interface TimeoutOptions {
  timeoutMs: number;
  onTimeout?: () => void;
  label?: string;
}

/**
 * Create an AbortSignal that aborts after a given timeout.
 * Useful for passing to fetch() and other async operations.
 */
export function createAbortSignalWithTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * Wrap a fetch call with timeout protection using AbortController.
 * If timeout occurs, logs warning and returns null or default value.
 */
export async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit & { timeout?: number; label?: string }
): Promise<Response | null> {
  const timeoutMs = options.timeout ?? 10_000;
  const label = options.label ?? url;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fetchOptions = { ...options };
    delete (fetchOptions as any).timeout;
    delete (fetchOptions as any).label;

    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      return null;
    }
    throw err;
  }
}

/**
 * Create a promise that rejects after a timeout.
 * Useful for Promise.race() to add timeout to any async operation.
 */
export function createTimeoutPromise<T>(ms: number, label = 'operation'): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
  });
}

/**
 * Race an async operation against a timeout.
 * Returns the result or null on timeout.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation'
): Promise<T | null> {
  try {
    return await Promise.race([
      promise,
      createTimeoutPromise<T>(ms, label),
    ]);
  } catch (err) {
    if (err instanceof Error && err.message.includes('timeout')) {
      return null;
    }
    throw err;
  }
}
