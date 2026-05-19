/**
 * Shared helpers for Circle Agent integrations:
 *   - Developer-Controlled Wallets (liquidity bot)
 *   - X402 nanopayment protocol (market data API)
 *   - Arc ERC-8004 agent identity contracts
 *   - Arc ERC-8183 agentic commerce (job escrow)
 */

// Arc Testnet contract addresses (from Arc docs MCP)
export const ARC_CONTRACTS = {
  USDC: '0x3600000000000000000000000000000000000000',
  EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  // ERC-8004 agent identity
  IdentityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  ReputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  ValidationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
  // ERC-8183 agentic commerce
  AgenticCommerce: '0x0747EEf0706327138c69792bF28Cd525089e4583',
} as const;

// X402 payment details for the market data API
export function buildX402PaymentRequired(priceUsd = '0.001') {
  const payTo = process.env.PRESTO_PAYMENT_ADDRESS ?? process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? '';
  return {
    error: 'Payment Required',
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'arcTestnet',
        maxAmountRequired: String(Math.round(Number(priceUsd) * 1_000_000)), // USDC 6-decimal base units
        resource: 'presto-markets/api/v1/markets',
        description: 'Presto Markets real-time prediction market data',
        mimeType: 'application/json',
        payTo,
        maxTimeoutSeconds: 300,
        asset: ARC_CONTRACTS.USDC,
        outputSchema: null,
        extra: { name: 'GatewayWalletBatched', version: '1' },
      },
    ],
  };
}

// Verify an X402 payment header (signature check delegated to Circle Gateway)
export async function verifyX402Payment(paymentHeader: string): Promise<boolean> {
  if (!paymentHeader) return false;
  // In production: call Circle Gateway facilitator to verify the EIP-3009 signature.
  // For testnet: accept any well-formed base64 payload as valid.
  try {
    const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return Boolean(parsed?.x402Version && parsed?.payload);
  } catch {
    return false;
  }
}

// Initialise the Circle Developer-Controlled Wallets SDK lazily
export function getCircleWalletsClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) return null;

  // Dynamic import so the module is only loaded server-side
  const { initiateDeveloperControlledWalletsClient } =
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@circle-fin/developer-controlled-wallets') as typeof import('@circle-fin/developer-controlled-wallets');

  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

// Transfer USDC from the dev-controlled liquidity wallet to a recipient
export async function sendUsdc(destinationAddress: string, amount: string) {
  const client = getCircleWalletsClient();
  const walletId = process.env.PRESTO_LIQUIDITY_WALLET_ID;
  if (!client || !walletId) {
    return { ok: false, error: 'Circle wallets not configured' };
  }

  const tx = await client.createTransaction({
    walletId,
    destinationAddress,
    tokenAddress: ARC_CONTRACTS.USDC,
    blockchain: 'ARC-TESTNET' as never,
    amount: [amount],
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
  });

  return { ok: true, txId: tx.data?.id };
}
