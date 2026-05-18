/**
 * X402-gated market data API.
 *
 * Flow (per Circle docs MCP + x402 protocol):
 *   1. Client requests GET /api/v1/markets
 *   2. No X-PAYMENT header → 402 with payment details (USDC on Arc Testnet)
 *   3. Client deposits USDC into Circle Gateway wallet, attaches signed EIP-3009
 *      payload as X-PAYMENT header, retries
 *   4. Server verifies → returns market JSON + X-PAYMENT-RESPONSE header
 *
 * Price: $0.001 USDC per request (1000 base units, 6 decimals)
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildX402PaymentRequired, verifyX402Payment, ARC_CONTRACTS } from '@/lib/circleAgents';
import { markets } from '@/lib/markets';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';

const PRICE_USD = '0.001';

export async function GET(req: NextRequest) {
  const paymentHeader = req.headers.get('x-payment') ?? '';

  // ── No payment → 402 ──
  if (!paymentHeader) {
    const paymentRequired = buildX402PaymentRequired(PRICE_USD);
    return NextResponse.json(paymentRequired, {
      status: 402,
      headers: {
        'X-402-Version': '1',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE',
      },
    });
  }

  // ── Verify payment ──
  const valid = await verifyX402Payment(paymentHeader);
  if (!valid) {
    return NextResponse.json(
      { error: 'Invalid or expired payment. Obtain a fresh signed EIP-3009 authorization.' },
      { status: 402 },
    );
  }

  // ── Serve market data ──
  const liveMarkets = await fetchOnchainMarkets().catch(() => []);
  const sourceMarkets = liveMarkets.length > 0 ? liveMarkets : markets;
  const payload = sourceMarkets.map((m) => ({
    id: m.id,
    title: m.title,
    category: m.category,
    type: m.type,
    status: m.status,
    outcomes: m.outcomes.map((o) => ({ label: o.label, odds: o.odds })),
    volume: m.volume,
    liquidity: m.liquidity,
    closeLabel: m.closeLabel,
    chain: m.chain,
    collateral: m.collateral,
    sourceOfTruth: m.sourceOfTruth,
    createdByType: m.createdByType ?? 'user',
    agent: m.createdByType === 'agent'
      ? {
          name: m.agentName,
          source: m.agentSource,
          model: m.agentModel,
          confidence: m.agentConfidence,
          reason: m.agentReason,
          trendSource: m.trendSource,
          trendUrl: m.trendUrl,
          momentumScore: m.momentumScore,
          safetyScore: m.safetyScore,
        }
      : null,
  }));

  return NextResponse.json(
    {
      ok: true,
      count: payload.length,
      markets: payload,
      meta: {
        chain: 'Arc Testnet',
        usdc: ARC_CONTRACTS.USDC,
        agenticCommerce: ARC_CONTRACTS.AgenticCommerce,
        identityRegistry: ARC_CONTRACTS.IdentityRegistry,
        pricePerRequest: `$${PRICE_USD} USDC`,
        protocol: 'x402 · Circle Gateway · Arc Testnet',
      },
    },
    {
      status: 200,
      headers: {
        'X-PAYMENT-RESPONSE': 'settled',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    },
  );
}

// Preflight for browser-based agents
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'X-PAYMENT, Content-Type',
      'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE',
    },
  });
}
