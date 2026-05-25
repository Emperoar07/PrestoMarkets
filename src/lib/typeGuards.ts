import type { Address } from 'viem';

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function isAddress(value: unknown): value is Address {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
}

export function assertAddress(value: unknown): Address {
  if (!isAddress(value)) {
    throw new Error(`Expected valid EVM address, got: ${String(value)}`);
  }
  return value;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function assertNonEmptyString(value: unknown, label: string): string {
  if (!isNonEmptyString(value)) {
    throw new Error(`${label} must be a non-empty string, got: ${String(value)}`);
  }
  return value;
}

export function isNonEmptyArray<T>(value: unknown): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

export function isErrorMessage(value: unknown): value is string {
  if (!isRecord(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.error === 'string' || typeof record.message === 'string';
}
