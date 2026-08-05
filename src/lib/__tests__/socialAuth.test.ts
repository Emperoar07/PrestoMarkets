import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('viem', async (importOriginal) => {
  const original = await importOriginal<typeof import('viem')>();
  return {
    ...original,
    createPublicClient: vi.fn().mockImplementation((args) => {
      const originalClient = original.createPublicClient(args);
      return {
        ...originalClient,
        verifyMessage: vi.fn().mockResolvedValue(false),
      };
    }),
  };
});

import {
  ARC_SIGN_IN_CHAIN_ID,
  buildSiweMessage,
  consumeNonce,
  createNonce,
  createSessionToken,
  getSessionSecret,
  normalizeSocialAddress,
  validateSiweMessageFields,
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

  it('builds and validates Arc-bound sign-in messages', () => {
    const address = '0x0000000000000000000000000000000000000001';
    const message = buildSiweMessage({
      address,
      nonce: 'nonce-123',
      origin: 'https://presto-markets.vercel.app',
      issuedAt: new Date('2026-06-03T00:00:00.000Z'),
    });

    expect(message).toContain(`Chain ID: ${ARC_SIGN_IN_CHAIN_ID}`);
    expect(validateSiweMessageFields({
      address,
      message,
      expectedNonce: 'nonce-123',
      expectedOrigin: 'https://presto-markets.vercel.app',
      now: new Date('2026-06-03T00:01:00.000Z').getTime(),
    })).toEqual({ ok: true, nonce: 'nonce-123' });

    expect(validateSiweMessageFields({
      address,
      message: message.replace(`Chain ID: ${ARC_SIGN_IN_CHAIN_ID}`, 'Chain ID: 1'),
      expectedNonce: 'nonce-123',
      expectedOrigin: 'https://presto-markets.vercel.app',
      now: new Date('2026-06-03T00:01:00.000Z').getTime(),
    }).ok).toBe(false);
  });

  it('issues a single-use nonce and rejects replay', async () => {
    const address = '0x0000000000000000000000000000000000000002';
    const nonce = await createNonce(address);
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(10);
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

  it('fails closed when no session secret is configured', async () => {
    // getSessionSecret() has deliberately no committed fallback: a public literal would let anyone
    // forge a presto_session cookie. With the secret unset, nonce issuance must throw (never mint a
    // nonce we cannot verify) and nonce consumption must refuse rather than accept unverifiable input.
    const address = '0x0000000000000000000000000000000000000004';
    const saved = {
      presto: process.env.PRESTO_SESSION_SECRET,
      auth: process.env.AUTH_SECRET,
      nextAuth: process.env.NEXTAUTH_SECRET,
    };
    delete process.env.PRESTO_SESSION_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    try {
      expect(getSessionSecret()).toBe('');
      await expect(createNonce(address)).rejects.toThrow(/PRESTO_SESSION_SECRET/);
      // A nonce shaped correctly but signed with some other key must not be accepted with no secret.
      expect(await consumeNonce(address, 'Zm9vOjk5OTk5OTk5OTk5OTk6YWJjOnNpZw')).toBe(false);
    } finally {
      if (saved.presto === undefined) delete process.env.PRESTO_SESSION_SECRET;
      else process.env.PRESTO_SESSION_SECRET = saved.presto;
      if (saved.auth === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = saved.auth;
      if (saved.nextAuth === undefined) delete process.env.NEXTAUTH_SECRET;
      else process.env.NEXTAUTH_SECRET = saved.nextAuth;
    }
  });
});
