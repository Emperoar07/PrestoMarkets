import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { arcTestnet } from 'viem/chains';
import { getArcConfig } from './arcConfig';
import { ARC_READ_BATCH, arcReadTransport, withRpcRetry } from './arcClient';
import { erc20Abi, prestoMarketAbi } from './contracts';
import { getCirclePasskeyBundlerClient } from './circlePasskey';
import type { LiveActionResult } from './liveActions';

const minTradeUsdc = 0.01;
const withRetry = withRpcRetry;

function requireConfig() {
  const config = getArcConfig();
  if (!config.rpcUrl) {
    throw new Error('NEXT_PUBLIC_ARC_RPC_URL is required for live Arc transactions.');
  }
  if (!config.usdcAddress || !isAddress(config.usdcAddress)) {
    throw new Error('NEXT_PUBLIC_USDC_ADDRESS must be a valid USDC address.');
  }
  return {
    ...config,
    usdcAddress: config.usdcAddress as Address,
  };
}

function getPublicClient() {
  const config = requireConfig();
  return createPublicClient({
    chain: arcTestnet,
    transport: arcReadTransport(config.rpcUrl),
    batch: ARC_READ_BATCH,
  });
}

function normalizeError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error || fallback);
  const lower = raw.toLowerCase();

  if (lower.includes('notallowederror') || lower.includes('cancel') || lower.includes('rejected')) {
    return 'Passkey confirmation was canceled.';
  }
  if (lower.includes('securityerror') || lower.includes('domain')) {
    return 'Passkey is not allowed on this domain. Check the Circle passkey domain configuration.';
  }
  if (lower.includes('insufficient') || lower.includes('exceeds balance')) {
    return raw.includes('USDC') ? raw : 'Insufficient USDC balance. Add USDC, then try again.';
  }
  if (lower.includes('aa21') || lower.includes('paymaster')) {
    return 'Circle paymaster could not sponsor this operation. Try again in a moment or use the app wallet PIN flow.';
  }
  if (lower.includes('nonce')) {
    return 'A passkey operation is already pending. Wait for it to finish, then retry.';
  }

  return raw || fallback;
}

async function assertMarketOpenForTrading(publicClient: ReturnType<typeof getPublicClient>, marketAddress: Address) {
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

async function runPasskeyCalls(calls: Array<{ to: Address; data: Hex }>) {
  const { bundlerClient } = getCirclePasskeyBundlerClient();
  const userOpHash = await bundlerClient.sendUserOperation({
    calls: calls.map((call) => ({ ...call, to: call.to as Hex })),
    paymaster: true,
  });
  const { receipt } = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
  return receipt.transactionHash;
}

export async function buyPasskeyShares(input: {
  marketAddress: string;
  outcome: string;
  outcomeIndex?: number;
  amount: number;
}): Promise<LiveActionResult> {
  try {
    const config = requireConfig();
    const publicClient = getPublicClient();
    const { address } = getCirclePasskeyBundlerClient();

    if (!isAddress(input.marketAddress)) {
      throw new Error('Market address is invalid.');
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error('Enter a valid USDC amount.');
    }
    if (input.amount < minTradeUsdc) {
      throw new Error(`Minimum trade is $${minTradeUsdc} USDC.`);
    }

    const marketAddress = input.marketAddress as Address;
    await assertMarketOpenForTrading(publicClient, marketAddress);

    const amount = parseUnits(String(input.amount), 6);
    const [balance, allowance] = await Promise.all([
      withRetry(() => publicClient.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      })),
      withRetry(() => publicClient.readContract({
        address: config.usdcAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, marketAddress],
      })),
    ]);

    if (balance < amount) {
      const have = Number(formatUnits(balance, 6)).toFixed(2);
      throw new Error(`Insufficient USDC balance. You have $${have} but the trade needs $${input.amount}.`);
    }

    const calls: Array<{ to: Address; data: Hex }> = [];
    if (allowance < amount) {
      calls.push({
        to: config.usdcAddress,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [marketAddress, amount],
        }),
      });
    }
    calls.push({
      to: marketAddress,
      data: encodeFunctionData({
        abi: prestoMarketAbi,
        functionName: 'buy',
        args: [input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1), amount],
      }),
    });

    const txHash = await runPasskeyCalls(calls);
    return {
      ok: true,
      message: calls.length > 1 ? `Bought ${input.outcome} shares with one passkey approve + buy.` : `Bought ${input.outcome} shares with passkey.`,
      txHash,
    };
  } catch (error) {
    return { ok: false, message: normalizeError(error, 'Passkey buy failed.') };
  }
}

async function callPasskeyMarket(
  marketAddress: string,
  functionName: 'cancel' | 'claim' | 'refund',
  success: string,
): Promise<LiveActionResult> {
  try {
    if (!isAddress(marketAddress)) {
      throw new Error('Market address is invalid.');
    }
    const txHash = await runPasskeyCalls([{
      to: marketAddress as Address,
      data: encodeFunctionData({
        abi: prestoMarketAbi,
        functionName,
      }),
    }]);
    return { ok: true, message: success, txHash };
  } catch (error) {
    return { ok: false, message: normalizeError(error, `${success} failed.`) };
  }
}

export function cancelPasskeyMarket(marketAddress: string) {
  return callPasskeyMarket(marketAddress, 'cancel', 'Market canceled with passkey.');
}

export function claimPasskeyMarket(marketAddress: string) {
  return callPasskeyMarket(marketAddress, 'claim', 'Claim settled in USDC with passkey.');
}

export function refundPasskeyMarket(marketAddress: string) {
  return callPasskeyMarket(marketAddress, 'refund', 'Refund settled in USDC with passkey.');
}

export async function resolvePasskeyMarket(input: {
  marketAddress: string;
  outcome: string;
  outcomeIndex?: number;
  resolutionURI: string;
}): Promise<LiveActionResult> {
  try {
    if (!isAddress(input.marketAddress)) {
      throw new Error('Market address is invalid.');
    }
    const txHash = await runPasskeyCalls([{
      to: input.marketAddress as Address,
      data: encodeFunctionData({
        abi: prestoMarketAbi,
        functionName: 'resolve',
        args: [input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1), input.resolutionURI],
      }),
    }]);
    return { ok: true, message: 'Market resolved with passkey.', txHash };
  } catch (error) {
    return { ok: false, message: normalizeError(error, 'Passkey resolve failed.') };
  }
}
