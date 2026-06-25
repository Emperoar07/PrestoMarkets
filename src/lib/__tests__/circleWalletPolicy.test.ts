import { describe, it, expect } from 'vitest';
import { encodeFunctionData } from 'viem';
import { inspectBatch } from '../circleWalletPolicy';
import { erc20Abi, prestoMarketAbi } from '../contracts';
import { ARC_MEMO_ADDRESS, encodeMemoWrappedCall } from '../arcMemos';

const USDC = '0x3600000000000000000000000000000000000000';
const MARKET = `0x${'11'.repeat(20)}`;
const AMOUNT = BigInt(1_000_000); // 1 USDC (6 decimals)

const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [MARKET as `0x${string}`, AMOUNT] });
const buyData = encodeFunctionData({ abi: prestoMarketAbi, functionName: 'buy', args: [0, AMOUNT] });

describe('inspectBatch', () => {
  it('accepts an approve + buy batch and normalizes the ops', () => {
    const result = inspectBatch([[
      [USDC, '0', approveData],
      [MARKET, '0', buyData],
    ]]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops).toHaveLength(2);
    expect(result.ops[0]).toEqual({ kind: 'approve', usdcTarget: USDC.toLowerCase(), spender: MARKET.toLowerCase(), amount: AMOUNT });
    expect(result.ops[1]).toEqual({ kind: 'buy', market: MARKET.toLowerCase() });
  });

  it('accepts a single buy leg (approval already set)', () => {
    const result = inspectBatch([[[MARKET, '0', buyData]]]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops).toEqual([{ kind: 'buy', market: MARKET.toLowerCase() }]);
  });

  it('accepts memo-wrapped approve + buy legs and validates the inner targets', () => {
    const memoApprove = encodeMemoWrappedCall({
      target: USDC as `0x${string}`,
      data: approveData,
      memo: { action: 'buy', target: USDC as `0x${string}`, marketId: MARKET as `0x${string}`, amount6: AMOUNT.toString(), at: '2026-06-24T00:00:00.000Z' },
    });
    const memoBuy = encodeMemoWrappedCall({
      target: MARKET as `0x${string}`,
      data: buyData,
      memo: { action: 'buy', target: MARKET as `0x${string}`, marketId: MARKET as `0x${string}`, amount6: AMOUNT.toString(), at: '2026-06-24T00:00:00.000Z' },
    });

    const result = inspectBatch([[[
      ARC_MEMO_ADDRESS,
      '0',
      memoApprove.data,
    ], [
      ARC_MEMO_ADDRESS,
      '0',
      memoBuy.data,
    ]]]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ops[0]).toEqual({ kind: 'approve', usdcTarget: USDC.toLowerCase(), spender: MARKET.toLowerCase(), amount: AMOUNT });
    expect(result.ops[1]).toEqual({ kind: 'buy', market: MARKET.toLowerCase() });
  });

  it('rejects nested memo legs', () => {
    const inner = encodeMemoWrappedCall({
      target: MARKET as `0x${string}`,
      data: buyData,
      memo: { action: 'buy', target: MARKET as `0x${string}`, marketId: MARKET as `0x${string}`, at: '2026-06-24T00:00:00.000Z' },
    });
    const outer = encodeMemoWrappedCall({
      target: ARC_MEMO_ADDRESS,
      data: inner.data,
      memo: { action: 'buy', target: ARC_MEMO_ADDRESS, marketId: MARKET as `0x${string}`, at: '2026-06-24T00:00:00.000Z' },
    });

    expect(inspectBatch([[[ARC_MEMO_ADDRESS, '0', outer.data]]]).ok).toBe(false);
  });

  it('rejects a leg with non-zero native value', () => {
    expect(inspectBatch([[[MARKET, '1', buyData]]]).ok).toBe(false);
  });

  it('rejects an unknown selector', () => {
    const bogus = `0xdeadbeef${'00'.repeat(32)}`;
    expect(inspectBatch([[[MARKET, '0', bogus]]]).ok).toBe(false);
  });

  it('rejects a malformed leg (wrong tuple arity)', () => {
    expect(inspectBatch([[[USDC, '0']]]).ok).toBe(false);
  });

  it('rejects an empty batch', () => {
    expect(inspectBatch([[]]).ok).toBe(false);
  });

  it('rejects too many legs', () => {
    const leg = [MARKET, '0', buyData];
    expect(inspectBatch([[leg, leg, leg, leg, leg]]).ok).toBe(false);
  });

  it('rejects a non-address target', () => {
    expect(inspectBatch([[['not-an-address', '0', buyData]]]).ok).toBe(false);
  });
});
