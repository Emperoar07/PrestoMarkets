import { NextRequest, NextResponse } from 'next/server';
import { getCircleWalletsClient, ARC_CONTRACTS } from '@/lib/circleAgents';
import { agentBuyShares } from '@/lib/agentWallet';

// GET — return liquidity analysis across markets
export async function GET(req: NextRequest) {
  const client = getCircleWalletsClient();
  const walletId = process.env.PRESTO_LIQUIDITY_WALLET_ID;

  let walletBalance: string | null = null;
  let walletAddress: string | null = null;

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
      // wallet not found or API error — proceed with null balance
    }
  }

  return NextResponse.json({
    ok: true,
    agent: {
      name: 'Presto Liquidity Agent',
      description: 'Autonomously funds prediction market liquidity using Circle Developer-Controlled Wallets on Arc Testnet.',
      walletAddress,
      usdcBalance: walletBalance,
      configured: Boolean(client && walletId),
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
    poweredBy: 'Circle Developer-Controlled Wallets · Arc Testnet ERC-8183 · @circle-fin/x402-batching',
  });
}

// POST — trigger liquidity provision for a specific market
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const validKey = process.env.PRESTO_AGENT_API_KEY;
  if (!validKey || apiKey !== validKey) {
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

  const amountNum = Number(body.amount);
  if (isNaN(amountNum) || amountNum <= 0 || amountNum > 25) {
    return NextResponse.json({ error: 'amount must be between 0 and 25 USDC' }, { status: 400 });
  }

  // Sequential: buy YES first, then NO. Parallel risks directional exposure if one side fails.
  const halfAmount = (amountNum / 2).toFixed(6);

  const yesResult = await agentBuyShares(body.marketAddress, 0, halfAmount);
  if (!yesResult.ok) {
    return NextResponse.json(
      { error: `YES buy failed (NO not attempted): ${yesResult.error}`, partialSuccess: false },
      { status: 503 },
    );
  }

  const noResult = await agentBuyShares(body.marketAddress, 1, halfAmount);
  if (!noResult.ok) {
    return NextResponse.json(
      {
        error: `NO buy failed after YES succeeded — agent holds directional YES exposure: ${noResult.error}`,
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
    note: 'Bought YES and NO shares sequentially to provide neutral liquidity depth.',
    poweredBy: 'Presto Agent Wallet · Arc Testnet',
  });
}
