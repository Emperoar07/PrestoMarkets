/**
 * Server-side agent wallet — signs Arc transactions using AGENT_PRIVATE_KEY.
 * Bypasses the browser wallet entirely so the agent acts autonomously.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getArcConfig, getArcChainId } from './arcConfig';
import { prestoMarketFactoryAbi, prestoMarketAbi } from './contracts';
import { buildMarketMetadataURI } from './marketMetadata';
import type { CreateLiveMarketInput } from './liveActions';

function getMarketKind(type: string) {
  if (type === 'Opinion') return 1;
  if (type === 'Opportunity') return 2;
  return 0;
}

function getCloseTimestamp(closeDate: string) {
  const t = Math.floor(new Date(closeDate).getTime() / 1000);
  if (!Number.isFinite(t) || t <= Math.floor(Date.now() / 1000)) {
    throw new Error('Close date must be in the future.');
  }
  return BigInt(t);
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt === retries) throw e;
      await new Promise<void>((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}

function getClients() {
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) throw new Error('AGENT_PRIVATE_KEY is not set — agent wallet unavailable.');

  const config = getArcConfig();
  if (!config.rpcUrl) throw new Error('NEXT_PUBLIC_ARC_RPC_URL not set.');
  if (!isAddress(config.factoryAddress ?? '')) throw new Error('NEXT_PUBLIC_MARKET_FACTORY_ADDRESS not set.');

  const chain = {
    id: getArcChainId(),
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
    rpcUrls: { default: { http: [config.rpcUrl] as [string] } },
  };

  const account = privateKeyToAccount(pk as Hex);
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  return {
    account,
    publicClient,
    walletClient,
    factoryAddress: config.factoryAddress as Address,
  };
}

// Create a market onchain from the agent wallet
export async function agentCreateMarket(input: CreateLiveMarketInput & { agentResolverAddress?: string }) {
  try {
    const { account, publicClient, walletClient, factoryAddress } = getClients();
    const resolver = (input.agentResolverAddress ?? account.address) as Address;

    const hash = await walletClient.writeContract({
      account,
      address: factoryAddress,
      abi: prestoMarketFactoryAbi,
      functionName: 'createMarket',
      args: [
        resolver,
        getCloseTimestamp(input.closeDate),
        buildMarketMetadataURI({ ...input, agent: { createdByType: 'agent', ...input.agent } }),
        getMarketKind(input.type),
      ],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash, resolverAddress: resolver };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Agent market creation failed.' };
  }
}

// Resolve a market onchain from the agent wallet
export async function agentResolveMarket(marketAddress: string, outcomeIndex: number, resolutionURI: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'resolve',
      args: [outcomeIndex, resolutionURI],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Agent resolution failed.' };
  }
}

export function getAgentAddress(): string | null {
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) return null;
  try {
    return privateKeyToAccount(pk as Hex).address;
  } catch {
    return null;
  }
}
