import { NextRequest, NextResponse } from 'next/server';
import { getCircleWalletsClient, ARC_CONTRACTS } from '@/lib/circleAgents';
import { agentBuyShares } from '@/lib/agentWallet';
import { verifyApiKey } from '@/lib/authCompare';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { fetchWithX402 } from '@/lib/x402Client';

// GET - return liquidity analysis across markets
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const isAuthorized = verifyApiKey(apiKey, process.env.PRESTO_AGENT_API_KEY);

  let walletBalance: string | null = null;
  let walletAddress: string | null = null;

  if (isAuthorized) {
    const client = getCircleWalletsClient();
    const walletId = process.env.PRESTO_LIQUIDITY_WALLET_ID;
    if (client && walletId) {
      try {
        const [walletRes, balRes] = await Promise.all([
          client.getWallet({ id: walletId }),
          client.getWalletTokenBalance({ id: walletId }),
        ]);
        walletAddress = walletRes.data?.wallet?.address ?? null;
        const usdcBalance = balRes.data?.tokenBalances?.find(
          (b) => b.token?.tokenAddress?.toLowerCase() === ARC_CONTRACTS.USDC.toLowerCase(),
        );
        walletBalance = usdcBalance?.amount ?? '0';
      } catch {
        // wallet not found or API error - proceed with null balance
      }
    }
  }

  return NextResponse.json({
    ok: true,
    agent: {
      name: 'Presto Liquidity Agent',
      description: 'Autonomously funds prediction market liquidity using Circle Developer-Controlled Wallets on Arc Testnet.',
      ...(isAuthorized ? { walletAddress, usdcBalance: walletBalance } : {}),
      configured: Boolean(getCircleWalletsClient() && process.env.PRESTO_LIQUIDITY_WALLET_ID),
      arcContracts: {
        usdc: ARC_CONTRACTS.USDC,
        agenticCommerce: ARC_CONTRACTS.AgenticCommerce,
        identityRegistry: ARC_CONTRACTS.IdentityRegistry,
      },
    },
    strategy: {
      minLiquidityThreshold: '$50',
      targetLiquidityPerMarket: '$100',
      maxPositionSize: '$25',
      description: 'Deposits USDC into thin markets (liquidity < $50) to ensure minimum depth for new traders.',
    },
    poweredBy: 'Circle Developer-Controlled Wallets - Arc Testnet ERC-8183 - @circle-fin/x402-batching',
  });
}

// POST - trigger liquidity provision for a specific market
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  if (!verifyApiKey(apiKey, process.env.PRESTO_AGENT_API_KEY)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { marketAddress: string; amount: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.marketAddress || !body.amount) {
    return NextResponse.json({ error: 'marketAddress and amount are required' }, { status: 400 });
  }

  const markets = await fetchOnchainMarkets();
  const market = markets.find(m => m.id === body.marketAddress.toLowerCase());
  if (!market) {
    return NextResponse.json({ error: 'marketAddress is not a legitimate factory-deployed Presto market' }, { status: 403 });
  }

  const amountNum = Number(body.amount);
  if (isNaN(amountNum) || amountNum <= 0 || amountNum > 25) {
    return NextResponse.json({ error: 'amount must be between 0 and 25 USDC' }, { status: 400 });
  }

  if (market.outcomes.length > 2) {
    const minimumAmount = market.outcomes.length * 0.01;
    if (amountNum < minimumAmount) {
      return NextResponse.json(
        { error: `amount must be at least ${minimumAmount.toFixed(2)} USDC to seed every poll outcome` },
        { status: 400 },
      );
    }

    const perOutcome = (amountNum / market.outcomes.length).toFixed(6);
    const txHashes: string[] = [];
    const fundedOutcomes: string[] = [];

    for (const [outcomeIndex, outcome] of market.outcomes.entries()) {
      const result = await agentBuyShares(body.marketAddress, outcomeIndex, perOutcome);
      if (!result.ok) {
        return NextResponse.json(
          {
            error: `${outcome.label} buy failed after funding ${fundedOutcomes.join(', ') || 'no prior outcomes'}: ${result.error}`,
            partialSuccess: fundedOutcomes.length > 0,
            txHashes,
          },
          { status: 503 },
        );
      }
      fundedOutcomes.push(outcome.label);
      if (result.txHash) txHashes.push(result.txHash);
    }

    return NextResponse.json({
      ok: true,
      txHashes,
      marketAddress: body.marketAddress,
      amountUsdc: body.amount,
      note: `Bought ${perOutcome} USDC of each outcome to provide neutral poll liquidity depth.`,
      poweredBy: 'Presto Agent Wallet - Arc Testnet',
    });
  }

  // --- Stoa x402 Integration ---
  const stoaUrl = process.env.STOA_API_URL || 'https://stoa.blockrun.ai/api/x402/analyze';
  let stoaVerdict = null;
  let kellyFraction = 0.5; // Default to symmetric

  try {
    const stoaRes = await fetchWithX402(stoaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        url: `https://presto.markets/market/${market.id}`, // Pass dummy URL in case Stoa requires it
        title: market.title, 
        description: market.description 
      })
    });
    
    if (stoaRes.ok) {
      const data = await stoaRes.json();
      if (data.verdict) stoaVerdict = data.verdict.toUpperCase();
      if (typeof data.kellyFraction === 'number') kellyFraction = data.kellyFraction;
    }
  } catch (error) {
    console.error('Stoa x402 analysis failed:', error);
    // Proceed with symmetric liquidity if Stoa fails
  }

  // Directional weighting based on Stoa's Kelly Fraction.
  // We treat Stoa's "BUY" as YES and "SELL" as NO.
  // If PASS or failed, we deploy 50/50.
  let yesAmount = amountNum / 2;
  let noAmount = amountNum / 2;
  
  if (stoaVerdict === 'BUY' || stoaVerdict === 'YES') {
    yesAmount = amountNum * kellyFraction;
    noAmount = amountNum * (1 - kellyFraction);
  } else if (stoaVerdict === 'SELL' || stoaVerdict === 'NO') {
    noAmount = amountNum * kellyFraction;
    yesAmount = amountNum * (1 - kellyFraction);
  }

  const yesStr = yesAmount.toFixed(6);
  const noStr = noAmount.toFixed(6);

  const yesResult = await agentBuyShares(body.marketAddress, 0, yesStr);
  if (!yesResult.ok) {
    return NextResponse.json(
      { error: `YES buy failed (NO not attempted): ${yesResult.error}`, partialSuccess: false },
      { status: 503 },
    );
  }

  const noResult = await agentBuyShares(body.marketAddress, 1, noStr);
  if (!noResult.ok) {
    return NextResponse.json(
      {
        error: `NO buy failed after YES succeeded - agent holds directional YES exposure: ${noResult.error}`,
        partialSuccess: true,
        yesTxHash: yesResult.txHash,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    yesTxHash: yesResult.txHash,
    noTxHash: noResult.txHash,
    marketAddress: body.marketAddress,
    amountUsdc: body.amount,
    note: stoaVerdict
      ? `Bought ${yesStr} YES and ${noStr} NO based on Stoa's analysis (${stoaVerdict}, Kelly ${kellyFraction})`
      : 'Bought YES and NO shares sequentially to provide neutral liquidity depth.',
    poweredBy: 'Presto Agent Wallet - Stoa x402 - Arc Testnet',
  });
}
