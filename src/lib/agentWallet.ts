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
import { arcTestnet } from 'viem/chains';
import { getArcConfig } from './arcConfig';
import { erc20Abi, prestoMarketFactoryAbi, prestoMarketAbi, prestoMultiOutcomeMarketFactoryAbi } from './contracts';
import { buildMarketMetadataURI } from './marketMetadata';
import { logger } from './logger';
import type { CreateLiveMarketInput } from './liveActions';

// Request validation helpers
function validateMarketCreationRequest(input: CreateLiveMarketInput): { ok: boolean; error?: string } {
  if (!input.title || input.title.length === 0) return { ok: false, error: 'Market title is required' };
  if (input.title.length > 200) return { ok: false, error: 'Title exceeds 200 characters' };

  const outcomeOptions = (input.outcomeOptions ?? []).map((option) => option.trim()).filter(Boolean);
  const outcomes = outcomeOptions.length >= 2 ? outcomeOptions : ['YES', 'NO'];
  if (outcomes.length < 2) return { ok: false, error: 'Market must have at least 2 outcomes' };
  if (outcomes.length > 12) return { ok: false, error: 'Market cannot have more than 12 outcomes' };

  if (!input.closeDate) return { ok: false, error: 'Close date is required' };
  const closeTime = new Date(input.closeDate).getTime();
  const nowTime = Date.now();
  if (closeTime <= nowTime) return { ok: false, error: 'Close date must be in the future' };
  if (closeTime - nowTime < 3600000) return { ok: false, error: 'Market must close at least 1 hour from now' };

  // The on-chain resolver is always the agent wallet (account.address), set inside
  // agentCreateMarket below. input.resolver is only a display label (e.g. "Presto
  // Agent"), so it is intentionally NOT required to be an address — requiring that
  // here previously rejected every agent market with "Invalid resolver address".
  // The agent-vs-configured-resolver match is still enforced via agentResolverAddress.

  return { ok: true };
}

function getMarketKind(type: string) {
  if (type === 'Opinion') return 1;
  return 0;
}

function getCloseTimestamp(closeDate: string) {
  const t = Math.floor(new Date(closeDate).getTime() / 1000);
  if (!Number.isFinite(t) || t <= Math.floor(Date.now() / 1000)) {
    throw new Error('Close date must be in the future.');
  }
  return BigInt(t);
}

function getOutcomeOptions(input: CreateLiveMarketInput) {
  const options = (input.outcomeOptions ?? []).map((option) => option.trim()).filter(Boolean);
  return options.length >= 2 ? options : ['YES', 'NO'];
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
  if (!isAddress(config.factoryAddress ?? '')) throw new Error('NEXT_PUBLIC_MARKET_FACTORY_ADDRESS not set.');

  const account = privateKeyToAccount(pk as Hex);
  const transport = config.rpcUrl ? http(config.rpcUrl) : http();
  const publicClient = createPublicClient({ chain: arcTestnet, transport });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport });

  return {
    account,
    publicClient,
    walletClient,
    factoryAddress: config.factoryAddress as Address,
    multiOutcomeFactoryAddress: isAddress(config.multiOutcomeFactoryAddress)
      ? config.multiOutcomeFactoryAddress as Address
      : undefined,
  };
}

// Create a market onchain from the agent wallet
export async function agentCreateMarket(input: CreateLiveMarketInput & { agentResolverAddress?: string }) {
  try {
    // Validate request before writing onchain
    const validation = validateMarketCreationRequest(input);
    if (!validation.ok) {
      logger.error('agent-wallet', 'Market creation validation failed', { error: validation.error, title: input.title });
      return { ok: false, error: validation.error };
    }

    const { account, publicClient, walletClient, factoryAddress, multiOutcomeFactoryAddress } = getClients();
    if (input.agentResolverAddress && input.agentResolverAddress.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error('Configured agent resolver address must match the agent wallet that signs resolution transactions.');
    }
    const resolver = account.address;
    const outcomeOptions = getOutcomeOptions(input);
    const useMultiOutcome = outcomeOptions.length > 2;
    const selectedFactory = useMultiOutcome ? multiOutcomeFactoryAddress : factoryAddress;

    if (!selectedFactory) {
      throw new Error('NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS not set for poll market creation.');
    }

    const hash = await walletClient.writeContract({
      account,
      address: selectedFactory,
      abi: useMultiOutcome ? prestoMultiOutcomeMarketFactoryAbi : prestoMarketFactoryAbi,
      functionName: 'createMarket',
      args: useMultiOutcome ? [
        resolver,
        getCloseTimestamp(input.closeDate),
        buildMarketMetadataURI({ ...input, outcomeOptions, agent: { createdByType: 'agent', ...input.agent } }),
        getMarketKind(input.type),
        outcomeOptions.length,
      ] : [
        resolver,
        getCloseTimestamp(input.closeDate),
        buildMarketMetadataURI({ ...input, outcomeOptions, agent: { createdByType: 'agent', ...input.agent } }),
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

// Submit a payout or refund for positions owned by the autonomous agent wallet.
export async function agentSettlePosition(marketAddress: string, action: 'claim' | 'refund') {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    const { account, publicClient, walletClient } = getClients();

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: action,
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : `Agent ${action} failed.` };
  }
}

// Buy outcome shares onchain from the agent wallet (approve USDC → call buy)
// Used by the liquidity bot to properly mint shares, not just transfer USDC
export async function agentBuyShares(
  marketAddress: string,
  outcomeIndex: number,
  amountUsdc: string,
) {
  try {
    if (!isAddress(marketAddress)) throw new Error('Invalid market address.');
    if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex > 11) {
      throw new Error('Outcome index must be between 0 and 11.');
    }
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

// Hard ceiling on any single agent-initiated USDC transfer. The autonomous
// agent moves funds without human review (e.g. paying x402 challenges), so an
// upper bound caps the blast radius if an upstream is compromised or misbehaves.
// Override with PRESTO_AGENT_MAX_TRANSFER_USDC; defaults to 5 USDC.
function getMaxTransferUsdc(): number {
  const parsed = Number(process.env.PRESTO_AGENT_MAX_TRANSFER_USDC);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export async function agentTransferUsdc(toAddress: string, amountUsdc: string) {
  try {
    if (!isAddress(toAddress)) throw new Error('Invalid destination address.');

    // Validate the amount is a sane, positive, bounded number before it ever
    // reaches parseUnits or the chain. Rejects NaN, <=0, and over-cap requests.
    const amountNum = Number(amountUsdc);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error('Transfer amount must be a positive number.');
    }
    const maxTransfer = getMaxTransferUsdc();
    if (amountNum > maxTransfer) {
      throw new Error(`Transfer amount ${amountNum} USDC exceeds the agent per-transfer cap of ${maxTransfer} USDC.`);
    }

    const { account, publicClient, walletClient } = getClients();
    const config = getArcConfig();
    if (!config.usdcAddress || !isAddress(config.usdcAddress)) throw new Error('USDC address not configured.');

    const amount = parseUnits(amountUsdc, 6);
    const usdcAddress = config.usdcAddress as Address;

    const hash = await walletClient.writeContract({
      account,
      address: usdcAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [toAddress as Address, amount],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    return { ok: true, txHash: hash };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'USDC transfer failed.' };
  }
}

// Read the onchain total shares staked on a given outcome index for a market.
// Used by auto-resolve to detect outcomes with no winning shares (which the
// contract refuses to resolve) so it can cancel-and-refund instead of locking funds.
export async function agentReadTotalShares(marketAddress: string, outcomeIndex: number): Promise<bigint | null> {
  try {
    if (!isAddress(marketAddress)) return null;
    if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex > 11) return null;
    const { publicClient } = getClients();
    const shares = await publicClient.readContract({
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'totalShares',
      args: [outcomeIndex],
    });
    return typeof shares === 'bigint' ? shares : BigInt(shares as number | string);
  } catch (error) {
    logger.warn('agent-wallet', 'Failed to read total shares', {
      marketAddress,
      outcomeIndex,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
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
