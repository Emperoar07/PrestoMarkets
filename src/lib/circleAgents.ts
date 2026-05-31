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
  // ERC-8004 agent identity
  IdentityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
  ReputationRegistry: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  ValidationRegistry: '0x8004Cb1BF31DAf7788923b405b754f57acEB4272',
  // ERC-8183 agentic commerce
  AgenticCommerce: '0x0747EEf0706327138c69792bF28Cd525089e4583',
} as const;

const ARC_TESTNET_NETWORK = 'arcTestnet';
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function requirePaymentAddress(): string {
  const payTo = (process.env.PRESTO_PAYMENT_ADDRESS ?? '').trim();
  if (!ADDRESS_RE.test(payTo)) {
    throw new Error('PRESTO_PAYMENT_ADDRESS must be configured as the Arc Testnet USDC payment recipient.');
  }
  return payTo;
}

function priceToUsdcBaseUnits(priceUsd: string): string {
  const price = Number(priceUsd);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('x402 price must be a positive USDC amount.');
  }
  return String(Math.round(price * 1_000_000));
}

// X402 payment details for the market data API
export function buildX402PaymentRequired(priceUsd = '0.001') {
  const payTo = requirePaymentAddress();
  const amount = priceToUsdcBaseUnits(priceUsd);
  return {
    error: 'Payment Required',
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: ARC_TESTNET_NETWORK,
        amount, // Circle Gateway x402 field
        maxAmountRequired: amount, // USDC 6-decimal ERC-20 base units
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

type X402Record = Record<string, unknown>;

function asRecord(value: unknown): X402Record {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as X402Record : {};
}

function firstString(records: X402Record[], keys: string[]): string {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
  }
  return '';
}

function sameAddress(a: string, b: string): boolean {
  return Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
}

function sameText(a: string, b: string): boolean {
  return Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
}

function sameBaseUnitAmount(a: string, b: string): boolean {
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

function buildGatewayPaymentRequirements(priceUsd: string) {
  const accepted = buildX402PaymentRequired(priceUsd).accepts[0];
  return {
    scheme: accepted.scheme,
    network: accepted.network,
    asset: accepted.asset,
    amount: accepted.amount,
    payTo: accepted.payTo,
    maxTimeoutSeconds: accepted.maxTimeoutSeconds,
    extra: accepted.extra,
  };
}

// Verify an X402 payment header.
// Structural check: validates EIP-3009 authorization shape, exact Arc USDC terms, and expiry.
// Signature check: delegated to Circle Gateway facilitator when CIRCLE_GATEWAY_FACILITATOR_URL is set.
export async function verifyX402Payment(paymentHeader: string, priceUsd = '0.001'): Promise<boolean> {
  if (!paymentHeader) return false;
  try {
    const decoded = Buffer.from(paymentHeader, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as X402Record;

    // Must be a valid x402 envelope
    if (!parsed?.x402Version || !parsed?.payload) return false;

    const paymentRequired = buildX402PaymentRequired(priceUsd).accepts[0];
    const gatewayRequirements = buildGatewayPaymentRequirements(priceUsd);
    const payload = asRecord(parsed.payload);
    const auth = asRecord(payload?.authorization ?? payload);
    const accepted = asRecord(parsed.accepted ?? payload.accepted);
    const paymentRequirements = asRecord(parsed.paymentRequirements);
    const requirementRecords = Array.isArray(parsed.accepts)
      ? (parsed.accepts.map(asRecord))
      : [];
    const records = [auth, accepted, payload, parsed, paymentRequirements, ...requirementRecords];

    // Must contain EIP-3009 TransferWithAuthorization fields
    const required = ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'];
    if (!required.every((k) => auth[k] !== undefined)) return false;

    // Must be the exact market-data payment we advertised: Arc Testnet, exact USDC amount,
    // known recipient, and this API resource.
    const scheme = firstString(records, ['scheme']);
    const network = firstString(records, ['network', 'chain']);
    const asset = firstString(records, ['asset', 'token', 'tokenAddress']);
    const resource = firstString(records, ['resource']);
    const recipient = firstString([auth, payload, parsed], ['to', 'payTo', 'recipient']);
    const amount = firstString([auth, accepted, payload, parsed], ['value', 'amount', 'maxAmountRequired']);

    if (scheme !== 'exact') return false;
    if (!sameText(network, paymentRequired.network)) return false;
    if (!sameAddress(asset, paymentRequired.asset)) return false;
    if (resource && resource !== paymentRequired.resource) return false;
    if (!sameAddress(recipient, paymentRequired.payTo)) return false;
    if (!sameBaseUnitAmount(amount, paymentRequired.maxAmountRequired)) return false;

    // Must be currently valid and not expired.
    const validAfter = Number(auth.validAfter);
    const validBefore = Number(auth.validBefore);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(validAfter) || validAfter > now) return false;
    if (!Number.isFinite(validBefore) || validBefore < now) return false;

    // Must have signature components
    if (!auth.v || !auth.r || !auth.s) return false;

    const facilitatorUrl = process.env.CIRCLE_GATEWAY_FACILITATOR_URL;
    if (!facilitatorUrl) {
      return false;
    }

    const res = await fetch(`${facilitatorUrl.replace(/\/$/, '')}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentPayload: parsed,
        paymentRequirements: gatewayRequirements,
      }),
    });

    if (!res.ok) return false;
    const result = await res.json().catch(() => null) as { isValid?: boolean } | null;
    return result?.isValid === true;
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
