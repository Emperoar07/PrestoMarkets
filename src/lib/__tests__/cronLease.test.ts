import { describe, expect, it } from 'vitest';
import { tryAcquireLocalCronLease, releaseLocalCronLease } from '../cronLease';

describe('cronLease local fallback', () => {
  it('allows only one active lease per key until release', () => {
    const key = `test-${Date.now()}`;

    expect(tryAcquireLocalCronLease(key, 60_000, 1_000)).toMatchObject({ acquired: true });
    expect(tryAcquireLocalCronLease(key, 60_000, 1_001)).toEqual({ acquired: false });

    releaseLocalCronLease(key);
    expect(tryAcquireLocalCronLease(key, 60_000, 1_002)).toMatchObject({ acquired: true });
    releaseLocalCronLease(key);
  });

  it('expires stale local leases', () => {
    const key = `test-expired-${Date.now()}`;

    expect(tryAcquireLocalCronLease(key, 100, 1_000)).toMatchObject({ acquired: true });
    expect(tryAcquireLocalCronLease(key, 100, 1_101)).toMatchObject({ acquired: true });
    releaseLocalCronLease(key);
  });
});
