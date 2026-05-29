import { describe, it, expect } from 'vitest';
import { secureCompare, verifyBearer, verifyApiKey } from '../authCompare';

describe('authCompare', () => {
  describe('secureCompare', () => {
    it('returns true for identical strings', () => {
      expect(secureCompare('s3cr3t-token', 's3cr3t-token')).toBe(true);
    });

    it('returns false for different strings of equal length', () => {
      expect(secureCompare('aaaaaa', 'aaaaab')).toBe(false);
    });

    it('returns false for strings of different length (no throw)', () => {
      expect(secureCompare('short', 'a-much-longer-secret')).toBe(false);
    });

    it('returns false when either side is empty, null, or undefined', () => {
      expect(secureCompare('', 'x')).toBe(false);
      expect(secureCompare('x', '')).toBe(false);
      expect(secureCompare(null, 'x')).toBe(false);
      expect(secureCompare('x', undefined)).toBe(false);
      expect(secureCompare(null, null)).toBe(false);
    });

    it('handles multibyte/unicode content correctly', () => {
      expect(secureCompare('🔑key', '🔑key')).toBe(true);
      expect(secureCompare('🔑key', '🔓key')).toBe(false);
    });
  });

  describe('verifyBearer', () => {
    it('accepts a matching Bearer header', () => {
      expect(verifyBearer('Bearer abc123', 'abc123')).toBe(true);
    });

    it('rejects a wrong token', () => {
      expect(verifyBearer('Bearer wrong', 'abc123')).toBe(false);
    });

    it('rejects when the header omits the Bearer prefix', () => {
      expect(verifyBearer('abc123', 'abc123')).toBe(false);
    });

    it('fails closed when the expected token is unset', () => {
      expect(verifyBearer('Bearer abc123', undefined)).toBe(false);
      expect(verifyBearer('Bearer abc123', '')).toBe(false);
    });

    it('rejects a missing header', () => {
      expect(verifyBearer(null, 'abc123')).toBe(false);
    });
  });

  describe('verifyApiKey', () => {
    it('accepts a matching key', () => {
      expect(verifyApiKey('key-xyz', 'key-xyz')).toBe(true);
    });

    it('rejects a wrong key', () => {
      expect(verifyApiKey('key-xyz', 'key-abc')).toBe(false);
    });

    it('fails closed when the expected key is unset', () => {
      expect(verifyApiKey('key-xyz', undefined)).toBe(false);
      expect(verifyApiKey('key-xyz', '')).toBe(false);
    });

    it('rejects a missing header', () => {
      expect(verifyApiKey(null, 'key-xyz')).toBe(false);
    });
  });
});
