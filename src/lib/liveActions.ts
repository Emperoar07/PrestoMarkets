import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { getArcConfig, getArcChainId } from './arcConfig';
import { erc20Abi, prestoMarketAbi, prestoMarketFactoryAbi, prestoMultiOutcomeMarketFactoryAbi } from './contracts';
import { getStoredConnectedWallet } from './walletProvider';
import { buildMarketMetadataURI, type AgentMarketMetadata } from './marketMetadata';
import type { MarketType } from './markets';
import {
  buyCircleShares,
  cancelCircleMarket,
  claimCircleMarket,
  createCircleMarket,
  refundCircleMarket,
  resolveCircleMarket,
} from './circleActions';
import type { StableSymbol } from './walletBalance';
import { getAgentResolverSelectionError, getResolveFeeUsdc, isAgentResolutionMode } from './resolveFee';
import { ARC_READ_BATCH, arcReadTransport, withRpcRetry } from './arcClient';

function isCircleWallet(): boolean {
  return getStoredConnectedWallet()?.mode === 'circle-user-controlled';
}

const ARC_CHAIN_HEX = '0x4cef52';
const MIN_TRADE_USDC = 0.01;

// Shared 429-aware retry with exponential backoff (see arcClient).
const withRetry = withRpcRetry;

function getArcChain() {
  return {
    id: getArcChainId(),
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: {
      default: { http: ['https://rpc.testnet.arc.network'] as [string] },
    },
  };
}

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export type LiveActionResult = {
  ok: boolean;
  message: string;
  txHash?: Hex;
  marketAddress?: Address;
  /** True when submitted and finalized on Arc but Circle's indexer is still catching up. */
  pending?: boolean;
};

export type CreateLiveMarketInput = {
  type: MarketType;
  title: string;
  description: string;
  category: string;
  categories?: string[];
  closeDate: string;
  rules: string;
  sourceOfTruth: string;
  resolver: string;
  agentResolverAddress?: string;
  resolutionMode: string;
  imageURI?: string;
  outcomeOptions?: string[];
  collateral?: 'USDC' | 'EURC';
  agent?: AgentMarketMetadata;
};

function requireConfig() {
  const config = getArcConfig();

  if (!config.rpcUrl) {
    throw new Error('NEXT_PUBLIC_ARC_RPC_URL is required for live Arc transactions.');
  }

  if (!config.factoryAddress || !isAddress(config.factoryAddress)) {
    throw new Error('NEXT_PUBLIC_MARKET_FACTORY_ADDRESS must be a valid deployed factory address.');
  }

  if (!config.usdcAddress || !isAddress(config.usdcAddress)) {
    throw new Error('NEXT_PUBLIC_USDC_ADDRESS must be a valid USDC address.');
  }

  return {
    ...config,
    factoryAddress: config.factoryAddress as Address,
    multiOutcomeFactoryAddress: isAddress(config.multiOutcomeFactoryAddress) ? config.multiOutcomeFactoryAddress as Address : undefined,
    usdcAddress: config.usdcAddress as Address,
  };
}

function cleanOutcomeOptions(input: CreateLiveMarketInput) {
  const cleaned = (input.outcomeOptions ?? [])
    .map((option) => option.trim())
    .filter(Boolean);
  return cleaned.length >= 2 ? cleaned : ['YES', 'NO'];
}

function shouldUseMultiOutcomeFactory(input: CreateLiveMarketInput) {
  return cleanOutcomeOptions(input).length > 2;
}

function getMarketKind(type: MarketType) {
  if (type === 'Opinion') return 1;
  return 0;
}

function getCloseTimestamp(closeDate: string) {
  const closeTime = Math.floor(new Date(closeDate).getTime() / 1000);

  if (!Number.isFinite(closeTime) || closeTime <= Math.floor(Date.now() / 1000)) {
    throw new Error('Close date must be in the future.');
  }

  return BigInt(closeTime);
}

async function getClients() {
  const config = requireConfig();

  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No browser wallet was found. Open Presto Markets in a wallet-enabled browser.');
  }

  const arcChainId = getArcChainId();
  const chain = {
    ...getArcChain(),
    rpcUrls: {
      default: { http: [config.rpcUrl] as [string] },
    },
  };

  await window.ethereum.request({ method: 'eth_requestAccounts' });

  const walletClient = createWalletClient({
    chain,
    transport: custom(window.ethereum),
  });
  const [account] = await walletClient.getAddresses();

  if (!account) {
    throw new Error('No wallet account was returned.');
  }

  const connectedChainId = await walletClient.getChainId();

  if (connectedChainId !== arcChainId) {
    try {
      await walletClient.switchChain({ id: arcChainId });
    } catch {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: ARC_CHAIN_HEX,
          chainName: 'Arc Testnet',
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
          rpcUrls: [config.rpcUrl],
        }],
      });
    }
  }

  const publicClient = createPublicClient({
    chain,
    transport: arcReadTransport(config.rpcUrl),
    batch: ARC_READ_BATCH,
  });

  return { account, config, publicClient, walletClient };
}

async function assertMarketOpenForTrading(
  publicClient: ReturnType<typeof createPublicClient>,
  marketAddress: Address,
) {
  const [state, closeTime] = await Promise.all([
    withRetry(() => publicClient.readContract({
      address: marketAddress,
      abi: prestoMarketAbi,
      functionName: 'state',
    })),
    withRetry(() => publicClient.readContract({
      address: marketAddress,
      abi: prestoMarketAbi,
      functionName: 'closeTime',
    })),
  ]);

  if (Number(state) !== 0) {
    throw new Error('This market is already settled and cannot be traded.');
  }

  if (Number(closeTime) <= Math.floor(Date.now() / 1000)) {
    throw new Error('This market is closed for trading.');
  }
}

export async function createLiveMarket(input: CreateLiveMarketInput): Promise<LiveActionResult> {
  if (isCircleWallet()) return createCircleMarket(input);
  try {
    const { account, config, publicClient, walletClient } = await getClients();

    if (!isAddress(input.resolver)) {
      throw new Error('Resolver must be a valid wallet address.');
    }

    const agentResolverError = getAgentResolverSelectionError(input);
    if (agentResolverError) throw new Error(agentResolverError);

    // Check that automatic settlement can be funded before the market transaction.
    // The actual transfer occurs only after market creation succeeds.
    const feeAmount = isAgentResolutionMode(input.resolutionMode)
      ? parseUnits(getResolveFeeUsdc(), 6)
      : BigInt(0);
    if (feeAmount > BigInt(0)) {
      const balance = await withRetry(() => publicClient.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
      }));
      if (balance < feeAmount) {
        throw new Error(`Need at least $${getResolveFeeUsdc()} USDC to fund automatic resolution. You have $${Number(formatUnits(balance, 6)).toFixed(2)}.`);
      }
    }

    const outcomeOptions = cleanOutcomeOptions(input);
    const useMultiOutcome = shouldUseMultiOutcomeFactory(input);
    const factoryAddress = useMultiOutcome ? config.multiOutcomeFactoryAddress : config.factoryAddress;
    const factoryAbi = useMultiOutcome ? prestoMultiOutcomeMarketFactoryAbi : prestoMarketFactoryAbi;

    if (!factoryAddress) {
      throw new Error('Set NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS before launching poll markets.');
    }

    const hash = await walletClient.writeContract({
      account,
      address: factoryAddress,
      abi: factoryAbi,
      functionName: 'createMarket',
      args: useMultiOutcome ? [
        input.resolver as Address,
        getCloseTimestamp(input.closeDate),
        buildMarketMetadataURI({ ...input, outcomeOptions }),
        getMarketKind(input.type),
        outcomeOptions.length,
      ] : [
        input.resolver as Address,
        getCloseTimestamp(input.closeDate),
        buildMarketMetadataURI({ ...input, outcomeOptions }),
        getMarketKind(input.type),
      ],
    });

    const receipt = await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    const created = parseEventLogs({
      abi: factoryAbi,
      eventName: 'MarketCreated',
      logs: receipt.logs,
    })[0];
    const marketAddress = created?.args.market;
    let message = 'Live market created on Arc.';

    // Fund only after creation succeeds so an abandoned launch cannot charge the fee.
    if (feeAmount > BigInt(0)) {
      try {
        const feeTx = await walletClient.writeContract({
          account,
          address: config.usdcAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [input.resolver as Address, feeAmount],
        });
        await withRetry(() => publicClient.waitForTransactionReceipt({ hash: feeTx }));
        message = 'Live market created on Arc. Automatic resolution funded.';
      } catch {
        message = 'Live market created on Arc, but automatic resolution funding was not completed. Fund the agent resolver before this market closes.';
      }
    }

    return { ok: true, message, txHash: hash, marketAddress };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Market creation failed.' };
  }
}

export async function buyLiveShares(input: { marketAddress: string; outcome: string; outcomeIndex?: number; amount: number; payWith?: StableSymbol }): Promise<LiveActionResult> {
  if (isCircleWallet()) {
    return buyCircleShares(input);
  }
  try {
    const { account, config, publicClient, walletClient } = await getClients();

    if (!isAddress(input.marketAddress)) {
      throw new Error('Market address is invalid.');
    }

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('Enter a valid USDC amount.');
    }

    if (input.amount < MIN_TRADE_USDC) {
      throw new Error(`Minimum trade is $${MIN_TRADE_USDC} USDC.`);
    }

    // Every market deployed by the factory settles in USDC at the contract level, and the
    // app is USDC-only, so trades always spend USDC (6-decimal ERC-20 interface on Arc).
    const marketAddress = input.marketAddress as Address;
    await assertMarketOpenForTrading(publicClient, marketAddress);

    const amount = parseUnits(String(input.amount), 6);

    const [balance, allowance] = await Promise.all([
      withRetry(() => publicClient.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
      })),
      withRetry(() => publicClient.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [account, marketAddress],
      })),
    ]);

    if (balance < amount) {
      const have = Number(formatUnits(balance, 6)).toFixed(2);
      throw new Error(`Insufficient USDC balance. You have $${have} but the trade needs $${input.amount}.`);
    }

    if (allowance < amount) {
      const approveHash = await walletClient.writeContract({
        account,
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [marketAddress, amount],
      });
      await withRetry(() => publicClient.waitForTransactionReceipt({ hash: approveHash }));
    }

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress,
      abi: prestoMarketAbi,
      functionName: 'buy',
      args: [input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1), amount],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));

    return { ok: true, message: `Bought ${input.outcome} shares on Arc.`, txHash: hash };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Buy transaction failed.' };
  }
}

export async function addLiveLiquidity(input: { marketAddress: string; amount: number; outcomes?: string[]; payWith?: StableSymbol }): Promise<LiveActionResult> {
  const outcomes = (input.outcomes ?? ['YES', 'NO']).map((outcome) => outcome.trim()).filter(Boolean);
  const outcomeLabels = outcomes.length >= 2 ? outcomes : ['YES', 'NO'];
  const minimumAmount = MIN_TRADE_USDC * outcomeLabels.length;

  if (!Number.isFinite(input.amount) || input.amount < minimumAmount) {
    return { ok: false, message: `Balanced liquidity needs at least $${minimumAmount.toFixed(2)} USDC for ${outcomeLabels.length} outcomes.` };
  }

  const amountPerOutcome = input.amount / outcomeLabels.length;
  let latestTxHash: Hex | undefined;
  const completed: string[] = [];

  for (const [outcomeIndex, outcome] of outcomeLabels.entries()) {
    const result = await buyLiveShares({
      marketAddress: input.marketAddress,
      outcome,
      outcomeIndex,
      amount: amountPerOutcome,
      payWith: input.payWith,
    });

    if (!result.ok) {
      const prior = completed.length > 0
        ? ` ${completed.join(', ')} already received liquidity, leaving directional exposure.`
        : '';
      return {
        ok: false,
        message: `${outcome} liquidity failed.${prior} ${result.message}`.trim(),
        txHash: latestTxHash,
      };
    }
    completed.push(outcome);
    latestTxHash = result.txHash ?? latestTxHash;
  }

  return {
    ok: true,
    message: `Added balanced liquidity: $${amountPerOutcome.toFixed(2)} to each of ${outcomeLabels.length} outcomes.`,
    txHash: latestTxHash,
  };
}

export async function resolveLiveMarket(input: { marketAddress: string; outcome: string; outcomeIndex?: number; resolutionURI: string }): Promise<LiveActionResult> {
  if (isCircleWallet()) return resolveCircleMarket(input);
  try {
    const { account, publicClient, walletClient } = await getClients();

    if (!isAddress(input.marketAddress)) {
      throw new Error('Market address is invalid.');
    }

    const hash = await walletClient.writeContract({
      account,
      address: input.marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'resolve',
      args: [input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1), input.resolutionURI],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));

    return { ok: true, message: 'Market resolved on Arc.', txHash: hash };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Resolve transaction failed.' };
  }
}

export async function cancelLiveMarket(marketAddress: string): Promise<LiveActionResult> {
  if (isCircleWallet()) return cancelCircleMarket(marketAddress);
  try {
    const { account, publicClient, walletClient } = await getClients();

    if (!isAddress(marketAddress)) {
      throw new Error('Market address is invalid.');
    }

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'cancel',
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));

    return { ok: true, message: 'Market canceled on Arc.', txHash: hash };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Cancel transaction failed.' };
  }
}

/**
 * Settlement-style call (claim or refund). The app is USDC-only, so payouts simply land
 * in the user's USDC balance — there is no cross-collateral swap-back step.
 */
async function settleInUsdc(input: {
  marketAddress: Address;
  functionName: 'claim' | 'refund';
  label: string;
}): Promise<LiveActionResult> {
  const { account, publicClient, walletClient } = await getClients();

  const hash = await walletClient.writeContract({
    account,
    address: input.marketAddress,
    abi: prestoMarketAbi,
    functionName: input.functionName,
  });
  await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));

  return { ok: true, message: `${input.label} settled in USDC.`, txHash: hash };
}

export async function claimLiveMarket(marketAddress: string, payWith?: StableSymbol): Promise<LiveActionResult> {
  if (isCircleWallet()) return claimCircleMarket(marketAddress);
  if (!isAddress(marketAddress)) {
    return { ok: false, message: 'Market address is invalid.' };
  }
  try {
    return await settleInUsdc({
      marketAddress: marketAddress as Address,
      functionName: 'claim',
      label: 'Claim',
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Claim transaction failed.' };
  }
}

export async function refundLiveMarket(marketAddress: string, payWith?: StableSymbol): Promise<LiveActionResult> {
  if (isCircleWallet()) return refundCircleMarket(marketAddress);
  if (!isAddress(marketAddress)) {
    return { ok: false, message: 'Market address is invalid.' };
  }
  try {
    return await settleInUsdc({
      marketAddress: marketAddress as Address,
      functionName: 'refund',
      label: 'Refund',
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Refund transaction failed.' };
  }
}
