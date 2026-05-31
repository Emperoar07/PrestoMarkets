import { afterEach, describe, expect, it } from 'vitest';
import { buildX402PaymentRequired } from '../circleAgents';
import { isAllowedContractExecution } from '../circleWalletPolicy';

const USDC = '0x3600000000000000000000000000000000000000';
const RESOLVER = '0x1111111111111111111111111111111111111111';
const ATTACKER = '0x2222222222222222222222222222222222222222';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('Circle and Arc policy integration', () => {
  it('requires an explicit x402 payment recipient on Arc Testnet', () => {
    delete process.env.PRESTO_PAYMENT_ADDRESS;

    expect(() => buildX402PaymentRequired('0.001')).toThrow(/PRESTO_PAYMENT_ADDRESS/);

    process.env.PRESTO_PAYMENT_ADDRESS = RESOLVER;
    const payment = buildX402PaymentRequired('0.001').accepts[0];

    expect(payment.network).toBe('arcTestnet');
    expect(payment.asset).toBe(USDC);
    expect(payment.payTo).toBe(RESOLVER);
    expect(payment.maxAmountRequired).toBe('1000');
  });

  it('refuses generic USDC transfers to non-configured recipients', async () => {
    process.env.NEXT_PUBLIC_USDC_ADDRESS = USDC;
    process.env.PRESTO_AGENT_RESOLVER_ADDRESS = RESOLVER;

    await expect(isAllowedContractExecution({
      contractAddress: USDC,
      abiFunctionSignature: 'transfer(address,uint256)',
      abiParameters: [ATTACKER, '1000'],
    })).resolves.toBe(false);
  });

  it('allows bounded USDC transfers only to configured trusted recipients', async () => {
    process.env.NEXT_PUBLIC_USDC_ADDRESS = USDC;
    process.env.PRESTO_AGENT_RESOLVER_ADDRESS = RESOLVER;

    await expect(isAllowedContractExecution({
      contractAddress: USDC,
      abiFunctionSignature: 'transfer(address,uint256)',
      abiParameters: [RESOLVER, '1000'],
    })).resolves.toBe(true);
  });
});
