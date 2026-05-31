import { NextResponse } from 'next/server';
import { createPublicClient, formatUnits, http, isAddress, type Address } from 'viem';
import { ERC8004_CONTRACTS, getAgentIdentityStatus } from '@/lib/agentIdentity';
import { getAgentAddress } from '@/lib/agentWallet';
import { getArcConfig, getArcChainId } from '@/lib/arcConfig';
import { erc20Abi } from '@/lib/contracts';
import { disputePolicy, grantDemoStory } from '@/lib/disputePolicy';
import { fetchOnchainMarkets } from '@/lib/onchainMarkets';
import { getResolveFeeUsdc } from '@/lib/resolveFee';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const agentSkills = [
  {
    name: 'Superpowers',
    summary: 'Plans before drafting, checks source quality, picks the market structure, and verifies how the market will settle.',
  },
  {
    name: 'ADHD divergence',
    summary: 'Compares trader, skeptic, resolver, and reader frames before choosing the clearest market writeup.',
  },
  {
    name: 'Graphify',
    summary: 'Builds and queries a codebase knowledge graph so the agent can inspect relationships before changing connected systems.',
  },
  {
    name: 'Exa research',
    summary: 'Grounds market ideas with fresh source highlights, primary URLs, image candidates, and provenance before drafting.',
  },
];

function formatStable(value: bigint) {
  return `$${Number(formatUnits(value, 6)).toFixed(2)}`;
}

async function readTokenBalance(address: Address, token: string | undefined) {
  const config = getArcConfig();
  if (!config.rpcUrl || !token || !isAddress(token)) return null;

  const client = createPublicClient({
    chain: {
      id: getArcChainId(),
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    },
    transport: http(config.rpcUrl),
  });

  const balance = await client.readContract({
    address: token as Address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  });
  return formatStable(balance);
}

export async function GET() {
  const agentAddress = getAgentAddress();
  if (!agentAddress || !isAddress(agentAddress)) {
    return NextResponse.json({
      ok: false,
      error: 'Agent wallet is not configured.',
      skills: agentSkills,
      policy: disputePolicy,
      demoStory: grantDemoStory,
    }, { status: 200 });
  }

  const config = getArcConfig();
  const [identity, markets, usdcBalance, eurcBalance] = await Promise.all([
    getAgentIdentityStatus().catch(() => null),
    fetchOnchainMarkets({ force: true }).catch(() => []),
    readTokenBalance(agentAddress as Address, config.usdcAddress).catch(() => null),
    readTokenBalance(agentAddress as Address, config.eurcAddress).catch(() => null),
  ]);
  const agentMarkets = markets.filter((market) => market.createdByType === 'agent');
  const activeAgentMarkets = agentMarkets.filter((market) => market.status === 'Open' || market.status === 'Closing soon');

  return NextResponse.json({
    ok: true,
    agent: {
      name: 'Presto Market Agent',
      address: agentAddress,
      registered: Boolean(identity?.registered),
      agentId: identity?.agentId ?? null,
      explorerUrl: identity?.agentId
        ? `https://testnet.arcscan.app/token/${ERC8004_CONTRACTS.IdentityRegistry}/instance/${identity.agentId}`
        : `https://testnet.arcscan.app/address/${agentAddress}`,
      contracts: {
        identityRegistry: ERC8004_CONTRACTS.IdentityRegistry,
        reputationRegistry: ERC8004_CONTRACTS.ReputationRegistry,
        validationRegistry: ERC8004_CONTRACTS.ValidationRegistry,
      },
    },
    treasury: {
      usdcBalance,
      eurcBalance,
      resolveFee: `$${Number(getResolveFeeUsdc()).toFixed(2)} USDC per agent-assisted market`,
    },
    limits: {
      perRunCap: Number(process.env.PRESTO_AGENT_PER_RUN_CAP ?? 1),
      activeMarketCap: Number(process.env.PRESTO_AGENT_ACTIVE_MARKET_CAP ?? 2),
      minSafetyScore: Number(process.env.PRESTO_AGENT_MIN_SAFETY_SCORE ?? 70),
      minMomentumScore: Number(process.env.PRESTO_AGENT_MIN_MOMENTUM_SCORE ?? 60),
      compositeSignalGate: Number(process.env.PRESTO_AGENT_MIN_COMPOSITE_SIGNAL ?? 0.62),
    },
    activity: {
      totalAgentMarkets: agentMarkets.length,
      activeAgentMarkets: activeAgentMarkets.length,
      resolvedAgentMarkets: agentMarkets.filter((market) => market.status === 'Resolved').length,
      canceledAgentMarkets: agentMarkets.filter((market) => market.status === 'Canceled').length,
    },
    skills: agentSkills,
    policy: disputePolicy,
    demoStory: grantDemoStory,
  });
}
