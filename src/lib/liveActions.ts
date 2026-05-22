import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  http,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { getArcConfig, getArcChainId } from './arcConfig';
import { erc20Abi, prestoMarketAbi, prestoMarketFactoryAbi } from './contracts';
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
import { executeSwap, type StableSymbol } from './swap';

function isCircleWallet(): boolean {
  return getStoredConnectedWallet()?.mode === 'circle-user-controlled';
}

const ARC_CHAIN_HEX = '0x4cef52';
const MIN_TRADE_USDC = 0.01;

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise<void>((resolve) => { setTimeout(resolve, 400 * (attempt + 1)); });
    }
  }
  throw new Error('unreachable');
}

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
    usdcAddress: config.usdcAddress as Address,
  };
}

function getMarketKind(type: MarketType) {
  if (type === 'Opinion') return 1;
  if (type === 'Opportunity') return 2;
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
    transport: http(config.rpcUrl),
  });

  return { account, config, publicClient, walletClient };
}

export async function createLiveMarket(input: CreateLiveMarketInput): Promise<LiveActionResult> {
  if (isCircleWallet()) return createCircleMarket(input);
  try {
    const { account, config, publicClient, walletClient } = await getClients();

    if (!isAddress(input.resolver)) {
      throw new Error('Resolver must be a valid wallet address.');
    }

    const hash = await walletClient.writeContract({
      account,
      address: config.factoryAddress,
      abi: prestoMarketFactoryAbi,
      functionName: 'createMarket',
      args: [
        input.resolver as Address,
        getCloseTimestamp(input.closeDate),
        buildMarketMetadataURI(input),
        getMarketKind(input.type),
      ],
    });

    const receipt = await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));
    const created = parseEventLogs({
      abi: prestoMarketFactoryAbi,
      eventName: 'MarketCreated',
      logs: receipt.logs,
    })[0];
    const marketAddress = created?.args.market;

    return { ok: true, message: 'Live market created on Arc.', txHash: hash, marketAddress };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Market creation failed.' };
  }
}

export async function buyLiveShares(input: { marketAddress: string; outcome: 'YES' | 'NO'; amount: number; payWith?: StableSymbol }): Promise<LiveActionResult> {
  if (isCircleWallet()) {
    if (input.payWith && input.payWith !== 'USDC') {
      return { ok: false, message: 'Paying with EURC requires an external EVM wallet. Circle app wallets sign through PIN per call and cannot batch a swap.' };
    }
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

    // If the user picked EURC, swap it to USDC first since every market deployed by the factory
    // settles in USDC at the contract level. Circle's swap response returns estimatedAmount as
    // a base-units string (e.g. '10800000' for 10.8 USDC) — use BigInt directly, NOT parseUnits.
    const marketAddress = input.marketAddress as Address;
    let amount: bigint;
    if (input.payWith === 'EURC') {
      const swapResult = await executeSwap({
        tokenIn: 'EURC',
        tokenOut: 'USDC',
        amountIn: String(input.amount),
      });
      amount = BigInt(swapResult.amountOut);
    } else {
      amount = parseUnits(String(input.amount), 6);
    }

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
      args: [input.outcome === 'YES' ? 0 : 1, amount],
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));

    return { ok: true, message: `Bought ${input.outcome} shares on Arc.`, txHash: hash };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Buy transaction failed.' };
  }
}

export async function addLiveLiquidity(input: { marketAddress: string; amount: number; payWith?: StableSymbol }): Promise<LiveActionResult> {
  if (!Number.isFinite(input.amount) || input.amount < MIN_TRADE_USDC * 2) {
    return { ok: false, message: `Balanced liquidity needs at least $${(MIN_TRADE_USDC * 2).toFixed(2)} USDC.` };
  }

  const half = input.amount / 2;
  const yesResult = await buyLiveShares({
    marketAddress: input.marketAddress,
    outcome: 'YES',
    amount: half,
    payWith: input.payWith,
  });

  if (!yesResult.ok) {
    return { ok: false, message: `YES side liquidity failed: ${yesResult.message}` };
  }

  const noResult = await buyLiveShares({
    marketAddress: input.marketAddress,
    outcome: 'NO',
    amount: half,
    payWith: input.payWith,
  });

  if (!noResult.ok) {
    return {
      ok: false,
      message: `NO side liquidity failed after YES succeeded. You now hold directional YES exposure: ${noResult.message}`,
      txHash: yesResult.txHash,
    };
  }

  return {
    ok: true,
    message: `Added balanced liquidity: $${half.toFixed(2)} YES and $${half.toFixed(2)} NO.`,
    txHash: noResult.txHash ?? yesResult.txHash,
  };
}

export async function resolveLiveMarket(input: { marketAddress: string; outcome: 'YES' | 'NO'; resolutionURI: string }): Promise<LiveActionResult> {
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
      args: [input.outcome === 'YES' ? 0 : 1, input.resolutionURI],
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
 * After a settlement-style call (claim or refund) that pays the user in USDC, swap *only*
 * the delta between pre- and post-USDC balance back to the user's chosen payWith token.
 * The earlier full-balance sweep would have swapped the user's unrelated USDC holdings too.
 */
async function settleAndMaybeSwapBack(input: {
  marketAddress: Address;
  functionName: 'claim' | 'refund';
  payWith: StableSymbol | undefined;
  label: string;
}): Promise<LiveActionResult> {
  const { account, config, publicClient, walletClient } = await getClients();
  const wantsSwapBack = input.payWith === 'EURC';

  // Snapshot the user's USDC balance BEFORE the on-chain settle so we can swap exactly the
  // payout delta, not whatever USDC they had sitting in the wallet.
  const preBalance = wantsSwapBack
    ? await publicClient.readContract({ address: config.usdcAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account] })
    : BigInt(0);

  const hash = await walletClient.writeContract({
    account,
    address: input.marketAddress,
    abi: prestoMarketAbi,
    functionName: input.functionName,
  });
  await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));

  if (!wantsSwapBack) {
    return { ok: true, message: `${input.label} settled in USDC.`, txHash: hash };
  }

  try {
    const postBalance = await publicClient.readContract({ address: config.usdcAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
    const delta = postBalance > preBalance ? postBalance - preBalance : BigInt(0);
    if (delta === BigInt(0)) {
      return { ok: true, message: `${input.label} settled; no USDC payout to swap back.`, txHash: hash };
    }
    const human = formatUnits(delta, 6);
    await executeSwap({ tokenIn: 'USDC', tokenOut: input.payWith!, amountIn: human });
    return { ok: true, message: `${input.label} settled and swapped to ${input.payWith}.`, txHash: hash };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'swap-back failed';
    return { ok: true, message: `${input.label} settled in USDC. Swap to ${input.payWith} failed: ${msg}`, txHash: hash };
  }
}

export async function claimLiveMarket(marketAddress: string, payWith?: StableSymbol): Promise<LiveActionResult> {
  if (isCircleWallet()) return claimCircleMarket(marketAddress);
  if (!isAddress(marketAddress)) {
    return { ok: false, message: 'Market address is invalid.' };
  }
  try {
    return await settleAndMaybeSwapBack({
      marketAddress: marketAddress as Address,
      functionName: 'claim',
      payWith,
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
    return await settleAndMaybeSwapBack({
      marketAddress: marketAddress as Address,
      functionName: 'refund',
      payWith,
      label: 'Refund',
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Refund transaction failed.' };
  }
}
