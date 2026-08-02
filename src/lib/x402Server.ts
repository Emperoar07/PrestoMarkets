import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { arcTestnet } from './chains';
import { getArcConfig } from './arcConfig';
import { arcReadTransport } from './arcClient';

/**
 * Seller-side x402 gate for the public API (`/api/v1`). Monetizes the agent storefront: an
 * unpaid request gets `402 Payment Required`; the caller pays USDC on Arc and retries with a
 * receipt, which we verify on-chain before serving.
 *
 * OFF BY DEFAULT — when `X402_SELL_ENABLED !== 'true'` this is a no-op, so the API stays open
 * until you deliberately turn monetization on. It also fails OPEN on misconfiguration (no/invalid
 * recipient) so a bad env can never take the public API down.
 *
 * Scheme mirrors Presto's own payer client (`x402Client.fetchWithX402`) so the agent can pay its
 * own API: simplified L402-over-Arc.
 *   1. Unpaid     -> 402 + `WWW-Authenticate: L402 address="<recipient>" price="<usdc>" currency="USDC"`
 *   2. Caller pays USDC to <recipient> on Arc, retries with `Authorization: L402 txHash="0x..."`
 *   3. We verify the on-chain USDC Transfer (recipient + amount + freshness + no replay) and serve.
 *
 * NOTE: this binds access to a fresh on-chain payment but not to the specific request (the official
 * Circle Gateway nanopayments scheme uses an EIP-3009 signature per request for that, and is
 * gasless). Replay within the freshness window is blocked by an in-memory used-set; for mainnet,
 * back that with a durable store (Redis) so it holds across instances.
 */

const FRESH_MS = 30 * 60_000; // a payment receipt is valid for 30 minutes
const usedTxHashes = new Map<string, number>(); // lowercased txHash -> first-consumed epoch ms

function config() {
  return {
    enabled: (process.env.X402_SELL_ENABLED ?? 'false').trim() === 'true',
    recipient: (process.env.X402_SELL_RECIPIENT ?? '').trim(),
    price: (process.env.X402_SELL_PRICE_USDC ?? '').trim() || '0.001',
  };
}

function challenge(recipient: string, price: string): NextResponse {
  return new NextResponse(
    JSON.stringify({
      apiVersion: 1,
      error: 'Payment required',
      x402: { address: recipient, price, currency: 'USDC', network: 'arc-testnet' },
    }),
    {
      status: 402,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'www-authenticate': `L402 address="${recipient}", price="${price}", currency="USDC"`,
      },
    },
  );
}

/**
 * Returns a 402 response when payment is required/insufficient, or `null` to allow the request
 * to proceed. Call at the top of a route's GET handler: `const pay = await requireX402Payment(req); if (pay) return pay;`
 */
export async function requireX402Payment(request: NextRequest): Promise<NextResponse | null> {
  const { enabled, recipient, price } = config();
  if (!enabled) return null; // monetization off — open API
  if (!recipient || !isAddress(recipient)) return null; // misconfig — fail OPEN, never break the API

  const auth = request.headers.get('authorization') ?? '';
  const match = auth.match(/txHash="(0x[0-9a-fA-F]{64})"/);
  if (!match) return challenge(recipient, price);
  const txHash = match[1].toLowerCase() as Hex;

  // Replay guard: a receipt is single-use within the freshness window.
  const seen = usedTxHashes.get(txHash);
  if (seen && Date.now() - seen < FRESH_MS) return challenge(recipient, price);

  const paid = await verifyArcUsdcPayment(txHash, recipient as Address, price).catch(() => false);
  if (!paid) return challenge(recipient, price);

  usedTxHashes.set(txHash, Date.now());
  if (usedTxHashes.size > 5_000) {
    const cutoff = Date.now() - FRESH_MS;
    for (const [hash, ts] of usedTxHashes) if (ts < cutoff) usedTxHashes.delete(hash);
  }
  return null; // payment verified — allow
}

async function verifyArcUsdcPayment(txHash: Hex, recipient: Address, priceUsdc: string): Promise<boolean> {
  const cfg = getArcConfig();
  const usdc = cfg.usdcAddress;
  if (!usdc || !isAddress(usdc)) return false;

  const client = createPublicClient({
    chain: arcTestnet,
    // Fail over across the ordered Arc RPCs so an out/throttled provider doesn't break receipt checks.
    transport: arcReadTransport(cfg.rpcUrl || undefined),
  });

  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') return false;

  // Freshness: the paying tx must be recent so old receipts can't be reused indefinitely.
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (Date.now() - Number(block.timestamp) * 1_000 > FRESH_MS) return false;

  const minAmount = parseUnits(priceUsdc, 6);
  const usdcLower = usdc.toLowerCase();
  const recipientLower = recipient.toLowerCase();

  // Sum USDC Transfer outputs to the recipient within this transaction.
  let paid = BigInt(0);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== usdcLower) continue;
    try {
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      if (event.eventName === 'Transfer' && String(event.args.to).toLowerCase() === recipientLower) {
        paid += event.args.value as bigint;
      }
    } catch {
      // not a Transfer log — ignore
    }
  }
  return paid >= minAmount;
}
