import { decodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import { ARC_MEMO_ADDRESS, arcMemoAbi, buildPrestoMemo, encodeMemoWrappedCall } from '../arcMemos';

const TARGET = '0x1111111111111111111111111111111111111111';

describe('arc memos', () => {
  it('builds deterministic bytes32 memo ids from stable inputs', () => {
    const first = buildPrestoMemo({
      action: 'buy',
      target: TARGET,
      marketId: TARGET,
      amount6: '1000000',
      at: '2026-06-24T00:00:00.000Z',
      ref: 'test-buy',
    });
    const second = buildPrestoMemo({
      action: 'buy',
      target: TARGET,
      marketId: TARGET,
      amount6: '1000000',
      at: '2026-06-24T00:00:00.000Z',
      ref: 'test-buy',
    });

    expect(first.memoId).toBe(second.memoId);
    expect(first.memoId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.payload).toMatchObject({ app: 'presto', version: 1, action: 'buy' });
  });

  it('wraps target calldata through the Arc Memo contract', () => {
    const wrapped = encodeMemoWrappedCall({
      target: TARGET,
      data: '0x12345678',
      memo: {
        action: 'claim',
        target: TARGET,
        marketId: TARGET,
        at: '2026-06-24T00:00:00.000Z',
      },
    });
    const decoded = decodeFunctionData({ abi: arcMemoAbi, data: wrapped.data });

    expect(wrapped.to).toBe(ARC_MEMO_ADDRESS);
    expect(decoded.functionName).toBe('memo');
    expect(decoded.args[0]).toBe(TARGET);
    expect(decoded.args[1]).toBe('0x12345678');
    expect(decoded.args[2]).toBe(wrapped.memoId);
    expect(decoded.args[3]).toBe(wrapped.memoData);
  });
});
