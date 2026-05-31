import { describe, it, expect } from 'vitest';
import { reduceStage } from '../transactions';

describe('reduceStage', () => {
  it('confirmed when ok and not pending', () => {
    expect(reduceStage({ ok: true })).toBe('confirmed');
    expect(reduceStage({ ok: true, pending: false })).toBe('confirmed');
  });

  it('pending when ok and pending', () => {
    expect(reduceStage({ ok: true, pending: true })).toBe('pending');
  });

  it('failed when not ok', () => {
    expect(reduceStage({ ok: false, message: 'Arc transaction reverted.' })).toBe('failed');
  });

  it('cancelled when not ok and message mentions cancel', () => {
    expect(reduceStage({ ok: false, message: 'You cancelled the Circle signing request.' })).toBe('cancelled');
  });
});
