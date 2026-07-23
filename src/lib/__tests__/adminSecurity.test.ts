import { describe, expect, it, afterEach } from 'vitest';
import { isAdminAddress, adminAddresses } from '../adminAuth';
import { redactSecrets, redactSecretsString } from '../redactSecrets';

const ADDR_A = '0x659eEAF9Be1fB881959D883385D03B0Ef5D778E0';
const ADDR_B = '0x117938e180481F0d1C022354B95429872454bB69';

describe('admin allowlist', () => {
  const original = process.env.NEXT_PUBLIC_ADMIN_ADDRESSES;
  afterEach(() => { process.env.NEXT_PUBLIC_ADMIN_ADDRESSES = original; });

  it('matches any allowlisted wallet, case-insensitively', () => {
    process.env.NEXT_PUBLIC_ADMIN_ADDRESSES = `${ADDR_A},${ADDR_B}`;
    expect(adminAddresses()).toHaveLength(2);
    expect(isAdminAddress(ADDR_A)).toBe(true);
    expect(isAdminAddress(ADDR_B.toUpperCase())).toBe(true);
    expect(isAdminAddress(ADDR_B.toLowerCase())).toBe(true);
  });

  it('rejects non-allowlisted and empty', () => {
    process.env.NEXT_PUBLIC_ADMIN_ADDRESSES = ADDR_A;
    expect(isAdminAddress(ADDR_B)).toBe(false);
    expect(isAdminAddress(undefined)).toBe(false);
    expect(isAdminAddress('')).toBe(false);
  });

  it('is closed when no admins are configured', () => {
    process.env.NEXT_PUBLIC_ADMIN_ADDRESSES = '';
    expect(isAdminAddress(ADDR_A)).toBe(false);
  });
});

describe('secret redaction (no leaks)', () => {
  it('redacts an RPC provider URL carrying an API key', () => {
    const err = 'HTTP request failed. URL: https://arc-testnet.g.alchemy.com/v2/Fr3EXMMBNimr8lV6-0wX1 Details: 429';
    expect(redactSecretsString(err)).not.toContain('Fr3EXMMBNimr8lV6-0wX1');
    expect(redactSecretsString(err)).toContain('[rpc-endpoint-redacted]');
  });

  it('redacts bearer tokens, dkey params, and 64-hex private keys', () => {
    expect(redactSecretsString('Authorization: Bearer sk-abc123def456ghi')).toContain('Bearer [redacted]');
    // A provider URL is redacted wholesale (secret gone); the dkey= rule catches keys on other hosts.
    expect(redactSecretsString('https://x.drpc.org/?dkey=abc123XYZ')).not.toContain('abc123XYZ');
    expect(redactSecretsString('config dkey=abc123XYZ end')).toContain('dkey=[redacted]');
    expect(redactSecretsString('pk 0x' + 'a'.repeat(64))).toContain('0x[redacted-64]');
  });

  it('leaves plain wallet addresses (40-hex) intact', () => {
    expect(redactSecretsString(`agent ${ADDR_A}`)).toContain(ADDR_A);
  });

  it('walks nested objects/arrays', () => {
    const out = redactSecrets({ result: { error: 'see https://x.quiknode.pro/SECRETKEY/' }, ok: false });
    expect(JSON.stringify(out)).not.toContain('SECRETKEY');
    expect(out.ok).toBe(false);
  });
});
