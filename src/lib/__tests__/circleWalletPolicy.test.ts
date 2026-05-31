import { describe, it, expect } from 'vitest';
import { encodeFunctionData } from 'viem';
import { inspectBatch } from '../circleWalletPolicy';
import { erc20Abi, prestoMarketAbi } from '../contracts';

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
