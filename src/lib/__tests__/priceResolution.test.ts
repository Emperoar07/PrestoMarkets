import { describe, it, expect } from 'vitest';
import {
  identifyAsset,
  parseUsdAmounts,
  resolveRangeOutcome,
  resolveBinaryTargetOutcome,
} from '../priceResolution';

describe('priceResolution', () => {
  describe('identifyAsset', () => {
    it('identifies BTC/ETH/SOL from title or category', () => {
      expect(identifyAsset({ title: 'Bitcoin price on Jun 5?', sourceOfTruth: '', outcomes: [] })?.symbol).toBe('BTC');
      expect(identifyAsset({ title: 'Will ETH reach $5k?', sourceOfTruth: '', outcomes: [] })?.symbol).toBe('ETH');
      expect(identifyAsset({ title: 'x', category: 'SOL', sourceOfTruth: '', outcomes: [] })?.symbol).toBe('SOL');
    });
    it('returns null for unrelated topics', () => {
      expect(identifyAsset({ title: 'Will it rain tomorrow?', sourceOfTruth: '', outcomes: [] })).toBeNull();
    });
  });

  describe('parseUsdAmounts', () => {
    it('parses commas and decimals', () => {
      expect(parseUsdAmounts('$69,000 to under $74,000')).toEqual([69000, 74000]);
      expect(parseUsdAmounts('reach $1,234.50')).toEqual([1234.5]);
      expect(parseUsdAmounts('no money here')).toEqual([]);
    });
  });

  describe('resolveRangeOutcome', () => {
    const labels = ['Below $69,000', '$69,000 to under $74,000', '$74,000 or above'];
    it('picks the band containing the price', () => {
      expect(resolveRangeOutcome(labels, 65000)).toBe('Below $69,000');
      expect(resolveRangeOutcome(labels, 70000)).toBe('$69,000 to under $74,000');
      expect(resolveRangeOutcome(labels, 80000)).toBe('$74,000 or above');
    });
    it('treats band boundaries as [low, high) and high as inclusive-above', () => {
      expect(resolveRangeOutcome(labels, 69000)).toBe('$69,000 to under $74,000');
      expect(resolveRangeOutcome(labels, 74000)).toBe('$74,000 or above');
    });
  });

  describe('resolveBinaryTargetOutcome', () => {
    const yn = ['YES', 'NO'];
    it('resolves an upside reach target', () => {
      expect(resolveBinaryTargetOutcome('Will Bitcoin reach $74,000 by Jun 5?', yn, 75000)).toBe('YES');
      expect(resolveBinaryTargetOutcome('Will Bitcoin reach $74,000 by Jun 5?', yn, 70000)).toBe('NO');
    });
    it('resolves a downside fall target', () => {
      expect(resolveBinaryTargetOutcome('Will Solana fall to $120 by Jun 5?', yn, 110)).toBe('YES');
      expect(resolveBinaryTargetOutcome('Will Solana fall to $120 by Jun 5?', yn, 130)).toBe('NO');
    });
    it('returns null when not strictly YES/NO, no target, or ambiguous direction', () => {
      expect(resolveBinaryTargetOutcome('Will BTC reach $74,000?', ['Up', 'Down'], 80000)).toBeNull();
      expect(resolveBinaryTargetOutcome('Will BTC do something?', yn, 80000)).toBeNull();
      expect(resolveBinaryTargetOutcome('Will BTC reach or fall to $74,000?', yn, 80000)).toBeNull();
    });
  });
});
