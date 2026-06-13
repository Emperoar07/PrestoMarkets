import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ARC_NATIVE_USDC_DECIMALS,
  ARC_USDC_DECIMALS,
  createArcReadClient,
  isRpcRateLimited,
  withRpcRetry,
} from '../arcClient';

describe('arcClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('isRpcRateLimited', () => {
    it('detects HTTP 429 by status field', () => {
      expect(isRpcRateLimited({ status: 429 })).toBe(true);
    });

    it('detects 429 / rate-limit wording in the message', () => {
      expect(isRpcRateLimited(new Error('HTTP request failed. Status: 429'))).toBe(true);
      expect(isRpcRateLimited(new Error('Too Many Requests'))).toBe(true);
      expect(isRpcRateLimited(new Error('rate limit exceeded'))).toBe(true);
    });

    it('returns false for unrelated errors and nullish input', () => {
      expect(isRpcRateLimited(new Error('reverted: insufficient funds'))).toBe(false);
      expect(isRpcRateLimited({ status: 500 })).toBe(false);
      expect(isRpcRateLimited(null)).toBe(false);
      expect(isRpcRateLimited(undefined)).toBe(false);
    });
  });

  describe('withRpcRetry', () => {
    it('returns immediately on first success without waiting', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      await expect(withRpcRetry(fn)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries a transient failure then succeeds', async () => {
      vi.useFakeTimers();
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce('recovered');
      const promise = withRpcRetry(fn, 3);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws the last error after exhausting retries', async () => {
      vi.useFakeTimers();
      const fn = vi.fn().mockRejectedValue(new Error('always 429'));
      const promise = withRpcRetry(fn, 2);
      const assertion = expect(promise).rejects.toThrow('always 429');
      await vi.runAllTimersAsync();
      await assertion;
      expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });

  describe('Arc read client', () => {
    it('uses Arc USDC decimal constants from the documented dual-interface model', () => {
      expect(ARC_USDC_DECIMALS).toBe(6);
      expect(ARC_NATIVE_USDC_DECIMALS).toBe(18);
    });

    it('creates a read client when Arc RPC configuration is present', () => {
      const previous = process.env.NEXT_PUBLIC_ARC_RPC_URL;
      process.env.NEXT_PUBLIC_ARC_RPC_URL = 'https://rpc.testnet.arc.network';

      const client = createArcReadClient();

      expect(client).not.toBeNull();
      expect(client?.chain?.id).toBe(5042002);
      expect(client?.chain?.nativeCurrency.decimals).toBe(ARC_NATIVE_USDC_DECIMALS);

      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_ARC_RPC_URL;
      } else {
        process.env.NEXT_PUBLIC_ARC_RPC_URL = previous;
      }
    });
  });
});
