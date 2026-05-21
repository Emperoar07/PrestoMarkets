import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  http,
  isAddress,
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
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
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
};

export type CreateLiveMarketInput = {
  type: MarketType;
  title: string;
  description: string;
  category: string;
  closeDate: string;
  rules: string;
  sourceOfTruth: string;
  resolver: string;
  resolutionMode: string;
  imageURI?: string;
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
          nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
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

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));

    return { ok: true, message: 'Live market created on Arc.', txHash: hash };
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
    // settles in USDC at the contract level. The swap-result amountOut becomes the buy amount.
    let usdcAmountToBuy = String(input.amount);
    if (input.payWith === 'EURC') {
      const swapResult = await executeSwap({
        tokenIn: 'EURC',
        tokenOut: 'USDC',
        amountIn: String(input.amount),
      });
      usdcAmountToBuy = swapResult.amountOut;
    }

    const marketAddress = input.marketAddress as Address;
    const amount = parseUnits(usdcAmountToBuy, 6);

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

async function swapBackIfNeeded(payWith: StableSymbol | undefined, txHash: Hex, label: string): Promise<LiveActionResult> {
  if (!payWith || payWith === 'USDC') {
    return { ok: true, message: `${label} settled in USDC.`, txHash };
  }
  // Swap the USDC payout we just received back to the user's chosen pay-with token.
  // We sweep the wallet's USDC balance delta is hard to read exactly, so the UI passes the
  // expected payout amount via a separate flow; for now we try a best-effort full-balance swap.
  try {
    const { account, config, publicClient } = await getClients();
    const balance = await publicClient.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    });
    if (balance === BigInt(0)) {
      return { ok: true, message: `${label} succeeded; nothing to swap back.`, txHash };
    }
    const human = formatUnits(balance, 6);
    await executeSwap({ tokenIn: 'USDC', tokenOut: payWith, amountIn: human });
    return { ok: true, message: `${label} settled and swapped to ${payWith}.`, txHash };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'swap-back failed';
    return { ok: true, message: `${label} settled in USDC. Swap to ${payWith} failed: ${msg}`, txHash };
  }
}

export async function claimLiveMarket(marketAddress: string, payWith?: StableSymbol): Promise<LiveActionResult> {
  if (isCircleWallet()) return claimCircleMarket(marketAddress);
  try {
    const { account, publicClient, walletClient } = await getClients();

    if (!isAddress(marketAddress)) {
      throw new Error('Market address is invalid.');
    }

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'claim',
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));

    return swapBackIfNeeded(payWith, hash, 'Claim');
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Claim transaction failed.' };
  }
}

export async function refundLiveMarket(marketAddress: string, payWith?: StableSymbol): Promise<LiveActionResult> {
  if (isCircleWallet()) return refundCircleMarket(marketAddress);
  try {
    const { account, publicClient, walletClient } = await getClients();

    if (!isAddress(marketAddress)) {
      throw new Error('Market address is invalid.');
    }

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress as Address,
      abi: prestoMarketAbi,
      functionName: 'refund',
    });

    await withRetry(() => publicClient.waitForTransactionReceipt({ hash }));

    return swapBackIfNeeded(payWith, hash, 'Refund');
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Refund transaction failed.' };
  }
}
