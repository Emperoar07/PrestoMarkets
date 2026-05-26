export class RequestTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
  }
}

export function withRequestTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timeoutHandle);
        reject(new RequestTimeoutError(operation, timeoutMs));
      }),
    ),
  ]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

export function createAbortSignalWithTimeout(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}
