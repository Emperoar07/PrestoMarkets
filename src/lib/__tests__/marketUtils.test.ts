import { describe, it, expect } from 'vitest';
import { estimateParimutuelPayout } from '../marketUtils';

describe('estimateParimutuelPayout', () => {
  it('roughly doubles a stake at 50% implied odds', () => {
    expect(estimateParimutuelPayout(10, 50)).toBeCloseTo(20, 5);
  });

  it('scales inversely with implied probability', () => {
    expect(estimateParimutuelPayout(10, 80)).toBeCloseTo(12.5, 5);
    expect(estimateParimutuelPayout(10, 25)).toBeCloseTo(40, 5);
  });

  it('returns the stake at 100% odds (no upside)', () => {
    expect(estimateParimutuelPayout(10, 100)).toBeCloseTo(10, 5);
  });

  it('defaults to 50/50 when odds are zero or invalid', () => {
    expect(estimateParimutuelPayout(10, 0)).toBeCloseTo(20, 5);
    expect(estimateParimutuelPayout(10, NaN)).toBeCloseTo(20, 5);
  });

  it('clamps odds above 100% to 100%', () => {
    expect(estimateParimutuelPayout(10, 150)).toBeCloseTo(10, 5);
  });

  it('returns 0 for non-positive or invalid amounts', () => {
    expect(estimateParimutuelPayout(0, 50)).toBe(0);
    expect(estimateParimutuelPayout(-5, 50)).toBe(0);
    expect(estimateParimutuelPayout(NaN, 50)).toBe(0);
  });
});
