import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { getArcConfig } from './arcConfig';
import { erc20Abi, prestoMarketAbi, prestoMarketFactoryAbi } from './contracts';
import type { MarketType } from './markets';

const ARC_CHAIN_ID = 5042002;
const ARC_CHAIN_HEX = '0x4cef52';

const arcChain = {
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
  },
} as const;

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

function buildMetadataURI(input: CreateLiveMarketInput) {
  const metadata = {
    name: input.title,
    description: input.description,
    category: input.category,
    imageURI: input.imageURI,
    rules: input.rules,
    sourceOfTruth: input.sourceOfTruth,
    resolutionMode: input.resolutionMode,
  };

  return `data:application/json,${encodeURIComponent(JSON.stringify(metadata))}`;
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

  const chain = {
    ...arcChain,
    rpcUrls: {
      default: { http: [config.rpcUrl] },
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

  if (connectedChainId !== ARC_CHAIN_ID) {
    try {
      await walletClient.switchChain({ id: ARC_CHAIN_ID });
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
        buildMetadataURI(input),
        getMarketKind(input.type),
      ],
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return { ok: true, message: 'Live market created on Arc.', txHash: hash };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Market creation failed.' };
  }
}

export async function buyLiveShares(input: { marketAddress: string; outcome: 'YES' | 'NO'; amount: number }): Promise<LiveActionResult> {
  try {
    const { account, config, publicClient, walletClient } = await getClients();

    if (!isAddress(input.marketAddress)) {
      throw new Error('Market address is invalid.');
    }

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('Enter a valid USDC amount.');
    }

    const marketAddress = input.marketAddress as Address;
    const amount = parseUnits(String(input.amount), 6);
    const allowance = await publicClient.readContract({
      address: config.usdcAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account, marketAddress],
    });

    if (allowance < amount) {
      const approveHash = await walletClient.writeContract({
        account,
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [marketAddress, amount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const hash = await walletClient.writeContract({
      account,
      address: marketAddress,
      abi: prestoMarketAbi,
      functionName: 'buy',
      args: [input.outcome === 'YES' ? 0 : 1, amount],
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return { ok: true, message: `Bought ${input.outcome} shares on Arc.`, txHash: hash };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Buy transaction failed.' };
  }
}

export async function resolveLiveMarket(input: { marketAddress: string; outcome: 'YES' | 'NO'; resolutionURI: string }): Promise<LiveActionResult> {
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

    await publicClient.waitForTransactionReceipt({ hash });

    return { ok: true, message: 'Market resolved on Arc.', txHash: hash };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Resolve transaction failed.' };
  }
}

export async function cancelLiveMarket(marketAddress: string): Promise<LiveActionResult> {
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

    await publicClient.waitForTransactionReceipt({ hash });

    return { ok: true, message: 'Market canceled on Arc.', txHash: hash };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Cancel transaction failed.' };
  }
}

export async function claimLiveMarket(marketAddress: string): Promise<LiveActionResult> {
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

    await publicClient.waitForTransactionReceipt({ hash });

    return { ok: true, message: 'Claim submitted on Arc.', txHash: hash };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Claim transaction failed.' };
  }
}

export async function refundLiveMarket(marketAddress: string): Promise<LiveActionResult> {
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

    await publicClient.waitForTransactionReceipt({ hash });

    return { ok: true, message: 'Refund submitted on Arc.', txHash: hash };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Refund transaction failed.' };
  }
}
