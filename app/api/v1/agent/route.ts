import { NextRequest, NextResponse } from 'next/server';
import { checkFixedWindowRateLimit, getClientIp } from '@/lib/requestGuards';
import { getPublicApiHeaders, publicOptionsResponse } from '@/lib/publicApi';
import { getAgentAddress } from '@/lib/agentWallet';
import { getAgentIdentityStatus, ERC8004_CONTRACTS } from '@/lib/agentIdentity';
import { getPublicMarkets } from '@/lib/publicMarketSource';
import { computeAgentCalibration } from '@/lib/marketCalibration';

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const cacheSeconds = 30;

const skills = [
  'Superpowers',
  'ADHD divergence',
  'Graphify',
  'Exa research',
];

export async function GET(request: NextRequest) {
  const headers = getPublicApiHeaders(cacheSeconds);
  const ip = getClientIp(request.headers);
  if (!checkFixedWindowRateLimit(rateLimitStore, ip, { max: 120, windowMs: 60_000, maxEntries: 5_000 })) {
    return NextResponse.json({ ok: false, error: 'Rate limit exceeded.' }, { status: 429, headers });
  }

  const address = getAgentAddress();
  const [identity, markets] = await Promise.all([
    address ? getAgentIdentityStatus().catch(() => null) : Promise.resolve(null),
    getPublicMarkets(),
  ]);
  const agentMarkets = markets.filter((market) => market.createdByType === 'agent');
  const calibration = computeAgentCalibration(agentMarkets);

  return NextResponse.json({
    ok: true,
    data: {
      name: 'Presto Market Agent',
      address,
      identity: {
        registered: Boolean(identity?.registered),
        agentId: identity?.agentId ?? null,
        registry: ERC8004_CONTRACTS.IdentityRegistry,
      },
      skills,
      activity: {
        totalMarkets: agentMarkets.length,
        activeMarkets: agentMarkets.filter((market) => market.status === 'Open' || market.status === 'Closing soon').length,
        resolvedMarkets: agentMarkets.filter((market) => market.status === 'Resolved').length,
        canceledMarkets: agentMarkets.filter((market) => market.status === 'Canceled').length,
      },
      calibration,
    },
  }, { headers });
}

export async function OPTIONS() {
  return publicOptionsResponse();
}
