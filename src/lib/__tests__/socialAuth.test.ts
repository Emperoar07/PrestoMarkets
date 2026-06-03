import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import {
  buildSiweMessage,
  consumeNonce,
  createNonce,
  createSessionToken,
  normalizeSocialAddress,
  verifySessionToken,
  verifySiweSignature,
} from '../socialAuth';

describe('socialAuth', () => {
  it('normalizes valid EVM addresses and rejects malformed values', () => {
    expect(normalizeSocialAddress('0x0000000000000000000000000000000000000001')).toBe('0x0000000000000000000000000000000000000001');
    expect(normalizeSocialAddress('not-an-address')).toBeNull();
  });

  it('verifies a signed Presto SIWE message for the claimed address', async () => {
    const account = privateKeyToAccount('0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const address = normalizeSocialAddress(account.address)!;
    const message = buildSiweMessage({
      address,
      nonce: 'nonce-123',
      origin: 'https://presto-markets.vercel.app',
      issuedAt: new Date('2026-06-03T00:00:00.000Z'),
    });
    const signature = await account.signMessage({ message });

    await expect(verifySiweSignature({ address, message, signature })).resolves.toBe(true);
    await expect(verifySiweSignature({
      address: '0x0000000000000000000000000000000000000001',
      message,
      signature,
    })).resolves.toBe(false);
  });

  it('issues a single-use nonce and rejects replay', async () => {
    const address = '0x0000000000000000000000000000000000000002';
    const nonce = await createNonce(address);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(await consumeNonce(address, nonce)).toBe(true);
    expect(await consumeNonce(address, nonce)).toBe(false);
  });

  it('rejects an unknown nonce', async () => {
    const address = '0x0000000000000000000000000000000000000003';
    await createNonce(address);
    expect(await consumeNonce(address, 'not-the-nonce')).toBe(false);
  });

  it('rejects tampered signed session cookies', () => {
    const token = createSessionToken('0x0000000000000000000000000000000000000001', {
      secret: 'test-secret',
      now: 1_000,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    });

    expect(verifySessionToken(token, { secret: 'test-secret', now: 1_001 })?.address)
      .toBe('0x0000000000000000000000000000000000000001');
    expect(verifySessionToken(`${token.slice(0, -1)}x`, { secret: 'test-secret', now: 1_001 }))
      .toBeNull();
  });
});
