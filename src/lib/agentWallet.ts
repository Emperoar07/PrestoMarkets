/**
 * Server-side agent wallet — signs Arc transactions using AGENT_PRIVATE_KEY.
 * Bypasses the browser wallet entirely so the agent acts autonomously.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getArcConfig, getArcChainId } from './arcConfig';
import { erc20Abi, prestoMarketFactoryAbi, prestoMarketAbi } from './contracts';
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
  // Accept both names so existing Vercel configs with PRESTO_AGENT_PRIVATE_KEY still work
  const pk = process.env.AGENT_PRIVATE_KEY ?? process.env.PRESTO_AGENT_PRIVATE_KEY;
  if (!pk) throw new Error('AGENT_PRIVATE_KEY is not set — agent wallet unavailable.');

  const config = getArcConfig();
  if (!config.rpcUrl) throw new Error('NEXT_PUBLIC_ARC_RPC_URL not set.');
  if (!isAddress(config.factoryAddress ?? '')) throw new Error('NEXT_PUBLIC_MARKET_FACTORY_ADDRESS not set.');

  const chain = {
    id: getArcChainId(),
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
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

export async function agentCancelMarket(marketAddress: string) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'cancel',
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Agent cancellation failed.' };
  }
}

// Buy outcome shares onchain from the agent wallet (approve USDC → call buy)
// Used by the liquidity bot to properly mint shares, not just transfer USDC
export async function agentBuyShares(
  marketAddress: string,
  outcomeIndex: 0 | 1,
  amountUsdc: string,
) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();
    const config = getArcConfig();
    if (!config.usdcAddress || !isAddress(config.usdcAddress)) throw new Error('USDC address not configured.');

    const amount = parseUnits(amountUsdc, 6);
    const usdcAddress = config.usdcAddress as Address;
    const market = marketAddress as Address;

    // Check current allowance — only approve if needed
    const allowance = await publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, market],
    }) as bigint;

    if (allowance < amount) {
      const approveHash = await walletClient.writeContract({
        account,
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [market, amount],
      });
      await withRetry(() => publicClient.waitForTransactionReceipt({ hash: approveHash }));
    }

    const hash = await walletClient.writeContract({
      account,
      address: market,
      abi: prestoMarketAbi,
      functionName: 'buy',
      args: [outcomeIndex, amount],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Liquidity buy failed.' };
  }
}

export function getAgentAddress(): string | null {
  const pk = process.env.AGENT_PRIVATE_KEY ?? process.env.PRESTO_AGENT_PRIVATE_KEY;
  if (!pk) return null;
  try {
    return privateKeyToAccount(pk as Hex).address;
  } catch {
    return null;
  }
}
