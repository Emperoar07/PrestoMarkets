import { describe, expect, it } from 'vitest';
import { humanizeTxError } from '../txErrors';

describe('humanizeTxError', () => {
  it('collapses the giant viem user-rejection dump to one sentence', () => {
    const raw = 'User rejected the request. Request Arguments: from: 0x117938e180481F0d1C022354B95429872454bB69 to: '
      + '0x5294E9927c3306DcBaDb03fe70b92e01cCede505 data: 0xc3b2c4f80000000000000000000000000000000000000000'
      + '00000000000000000000003600000000000000000000000000 Details: User rejected the request. Version: viem@2.50.4';
    expect(humanizeTxError(raw)).toBe('You cancelled the request in your wallet.');
  });

  it('maps contract custom errors and balance issues', () => {
    expect(humanizeTxError('execution reverted: SlippageExceeded()')).toMatch(/price moved/i);
    expect(humanizeTxError('reverted with custom error InsufficientShares()')).toMatch(/enough shares/i);
    expect(humanizeTxError('Insufficient USDC balance. You have $1.20 but the trade needs $10.')).toContain('$1.20');
  });

  it('strips hex blobs and viem footer from generic reverts', () => {
    const raw = 'execution reverted: market frozen Request Arguments: data: 0xdeadbeefdeadbeefdeadbeef Version: viem@2.50.4';
    const out = humanizeTxError(raw);
    expect(out).toBe('market frozen');
    expect(out).not.toMatch(/0x/);
  });

  it('falls back when the error is empty', () => {
    expect(humanizeTxError(undefined, 'Buy failed.')).toBe('Buy failed.');
  });
});
