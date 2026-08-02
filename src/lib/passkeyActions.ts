import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { arcTestnet } from './chains';
import { collateralSymbolForAddress, collateralUnit, getArcConfig } from './arcConfig';
import { ARC_READ_BATCH, arcReadTransport, withRpcRetry } from './arcClient';
import { erc20Abi, prestoLmsrMarketAbi, prestoMarketAbi } from './contracts';
import { GATEWAY_MINTER } from './gatewayActions';
import { requestCircleConfirmation, type CircleConfirmDetails } from './circleConfirm';
import { encodeMemoWrappedCall, type PrestoMemoAction } from './arcMemos';
import type { LiveActionResult, LmsrBuyInput, LmsrSellInput } from './liveActions';

// Lazy: circlePasskey drags in the Circle modular-wallets + viem account-abstraction stack
// (~1MB client JS). Every use here is inside an async action, so load it on first use.
const getCirclePasskeyBundlerClient = async () =>
  (await import('./circlePasskey')).getCirclePasskeyBundlerClient();

const minTradeUsdc = 0.01;
const withRetry = withRpcRetry;

function memoPasskeyCall(input: {
  target: Address;
  data: Hex;
  action: PrestoMemoAction;
  marketId?: Address;
  outcome?: string;
  outcomeIndex?: number;
  amount6?: string;
  collateral?: string;
  ref?: string;
}): { to: Address; data: Hex } {
  const wrapped = encodeMemoWrappedCall({
    target: input.target,
    data: input.data,
    memo: {
      action: input.action,
      target: input.target,
      marketId: input.marketId,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      amount6: input.amount6,
      collateral: input.collateral,
      ref: input.ref,
    },
  });
  return { to: wrapped.to, data: wrapped.data };
}

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

const PASSKEY_PENDING_TAG = '__PASSKEY_PENDING__:';

// A passkey op that was submitted but hadn't surfaced a receipt in our polling window isn't a
// failure — it's almost certainly finalizing on Arc. Convert the tagged error into a soft
// "submitted, confirming" result so the UI doesn't show a scary red Failed toast.
export function passkeyPendingResult(error: unknown, label: string): LiveActionResult | null {
  const msg = error instanceof Error ? error.message : '';
  if (!msg.startsWith(PASSKEY_PENDING_TAG)) return null;
  return {
    ok: true,
    pending: true,
    message: `${label} submitted with passkey — confirming on Arc. Your balance updates shortly.`,
  };
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

const PASSKEY_RECEIPT_TIMEOUT_MS = 150_000;
// Arc finalizes sub-second; the limiting factor is Circle's bundler inclusion, so once the userOp
// lands we detect the on-chain effect on the next tight tick instead of waiting out a 1.5s poll.
const PASSKEY_RECEIPT_POLL_MS = 700;

// The Circle paymaster sometimes can't sponsor (policy limit, transient outage), surfacing as an
// AA-prefixed paymaster error. When that persists we retry the user op WITHOUT the paymaster so the
// passkey smart account pays its own gas — Arc's gas token is USDC, which the wallet holds.
function isPaymasterError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return msg.includes('paymaster') || msg.includes('sponsor') || msg.includes('aa21')
    || msg.includes('aa31') || msg.includes('aa33') || msg.includes('aa34') || msg.includes('aa40');
}

// Circle's bundler + paymaster + their modular RPC fail transiently ("unavailable for a moment",
// estimation errors, RPC blips) and the op usually succeeds on a retry — which is exactly the
// "goes through after some time" the user sees. Treat these as retryable.
function isTransientOpError(error: unknown): boolean {
  if (isPaymasterError(error)) return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return msg.includes('estimation') || msg.includes('rpc') || msg.includes('timeout')
    || msg.includes('timed out') || msg.includes('429') || msg.includes('rate limit')
    || msg.includes('fetch failed') || msg.includes('failed to fetch') || msg.includes('network')
    || msg.includes('econn') || msg.includes('temporar') || msg.includes('try again');
}

export async function runPasskeyCalls(
  calls: Array<{ to: Address; data: Hex }>,
  // confirmOnchain: optional Arc-direct confirmation that resolves true once the op's on-chain
  // effect is observed (e.g. the buyer's shares increased), so the progress modal flips to success
  // promptly instead of waiting on Circle's slower bundler receipt.
  // preview: optional details for a confirmation modal shown BEFORE the passkey prompt, so the user
  // reviews exactly what they are signing (same modal the Circle wallet flow uses).
  opts: { confirmOnchain?: () => Promise<boolean>; preview?: Partial<CircleConfirmDetails> } = {},
) {
  if (opts.preview) {
    const last = calls[calls.length - 1]?.to ?? '';
    const approved = await requestCircleConfirmation({
      label: opts.preview.label ?? 'Confirm with passkey',
      action: opts.preview.action ?? 'You are about to sign this on Arc Testnet with your passkey.',
      contractAddress: opts.preview.contractAddress ?? last,
      functionSignature: opts.preview.functionSignature ?? '',
      amountDisplay: opts.preview.amountDisplay,
      parameters: opts.preview.parameters,
      contractExplorerUrl: opts.preview.contractExplorerUrl ?? (last ? `https://testnet.arcscan.app/address/${last}` : undefined),
      gasDisplay: opts.preview.gasDisplay ?? 'Sponsored, gasless',
      heading: 'Confirm with passkey',
      footnote: 'Your device will ask for Face ID or a fingerprint next. Gas is sponsored, so there is no network fee.',
      proceedLabel: 'Continue with passkey',
    });
    if (!approved) {
      throw new Error('You cancelled the passkey signing request.');
    }
  }

  const { bundlerClient } = await getCirclePasskeyBundlerClient();
  const userOpCalls = calls.map((call) => ({ ...call, to: call.to as Hex }));
  // Circle's bundler + paymaster + modular RPC fail transiently ("sponsorship unavailable for a
  // moment", estimation errors, RPC blips) and the op usually succeeds on a retry — exactly the
  // "goes through after some time" behavior. Retry transient failures with backoff. (Circle Modular
  // Wallets require paymaster sponsorship at the bundler, so self-funded gas is not an option here.)
  const userOpHash: Hex = await (async (): Promise<Hex> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await bundlerClient.sendUserOperation({ calls: userOpCalls, paymaster: true });
      } catch (error) {
        if (attempt < 3 && isTransientOpError(error)) {
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
  })();

  // Generous window because Circle's Arc bundler can take much longer than viem's ~24s default to
  // expose the receipt. We return early the moment EITHER the on-chain effect is visible (fast
  // path) OR the bundler returns the receipt.
  const deadline = Date.now() + PASSKEY_RECEIPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (opts.confirmOnchain && await opts.confirmOnchain().catch(() => false)) {
      // Confirmed on Arc. Best-effort tx hash for the explorer link — never block success on the
      // slow indexer; an empty hash just means "no link yet".
      const quick = await bundlerClient.getUserOperationReceipt({ hash: userOpHash }).catch(() => null);
      return quick?.receipt?.transactionHash ?? '';
    }
    const received = await bundlerClient.getUserOperationReceipt({ hash: userOpHash }).catch(() => null);
    if (received?.receipt?.transactionHash) {
      if (received.success === false) {
        throw new Error('The passkey transaction was included but reverted on-chain.');
      }
      return received.receipt.transactionHash;
    }
    await new Promise((resolve) => setTimeout(resolve, PASSKEY_RECEIPT_POLL_MS));
  }
  // Submitted but not yet confirmed within the window — surface a soft "still confirming" message
  // (tagged) instead of a hard failure, since the op is almost certainly finalizing on Arc.
  throw new Error(`__PASSKEY_PENDING__:${userOpHash}`);
}

const gatewayMinterAbi = [{
  type: 'function',
  name: 'gatewayMint',
  inputs: [{ name: 'attestationPayload', type: 'bytes' }, { name: 'signature', type: 'bytes' }],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const;

// Submit the Arc mint leg of a Move-to-Arc from the passkey smart account (gasless via the Circle
// paymaster), so the external EOA that signed the burn intent never needs Arc gas. Mirrors
// mintGatewayViaCircle for the user-controlled wallet. Returns the Arc mint tx hash.
export async function mintGatewayViaPasskey(attestation: string, apiSignature: string): Promise<string> {
  return runPasskeyCalls([memoPasskeyCall({
    target: GATEWAY_MINTER,
    data: encodeFunctionData({
      abi: gatewayMinterAbi,
      functionName: 'gatewayMint',
      args: [attestation as Hex, apiSignature as Hex],
    }),
    action: 'gateway_mint',
    ref: `presto-gateway-mint-${Date.now()}`,
  })]);
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
    const { address } = await getCirclePasskeyBundlerClient();

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

    const buyOutcomeIndex = input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1);
    const calls: Array<{ to: Address; data: Hex }> = [];
    if (allowance < amount) {
      calls.push(memoPasskeyCall({
        target: config.usdcAddress,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [marketAddress, amount],
        }),
        action: 'buy',
        marketId: marketAddress,
        outcome: input.outcome,
        outcomeIndex: buyOutcomeIndex,
        amount6: amount.toString(),
        collateral: 'USDC',
        ref: 'approve',
      }));
    }
    calls.push(memoPasskeyCall({
      target: marketAddress,
      data: encodeFunctionData({
        abi: prestoMarketAbi,
        functionName: 'buy',
        args: [buyOutcomeIndex, amount],
      }),
      action: 'buy',
      marketId: marketAddress,
      outcome: input.outcome,
      outcomeIndex: buyOutcomeIndex,
      amount6: amount.toString(),
      collateral: 'USDC',
    }));

    // Snapshot the buyer's shares so we can confirm the trade directly from Arc (sub-second) the
    // moment they increase, instead of spinning on Circle's slower bundler receipt.
    const readShares = () => publicClient.readContract({
      address: marketAddress, abi: prestoMarketAbi, functionName: 'sharesOf', args: [buyOutcomeIndex, address],
    }) as Promise<bigint>;
    const sharesBefore = await readShares().catch(() => BigInt(0));

    const txHash = await runPasskeyCalls(calls, {
      confirmOnchain: async () => (await readShares().catch(() => sharesBefore)) > sharesBefore,
      preview: {
        label: `Buy ${input.outcome} · $${Number(input.amount).toFixed(2)}`,
        action: calls.length > 1
          ? `Approve USDC and buy ${input.outcome} shares in a single passkey signature.`
          : `Buy ${input.outcome} shares in this market with your passkey.`,
        amountDisplay: `$${Number(input.amount).toFixed(2)} USDC`,
        functionSignature: 'buy(uint8,uint256)',
        contractAddress: marketAddress,
        parameters: [
          `outcome: ${input.outcome} (${buyOutcomeIndex})`,
          `amount: $${Number(input.amount).toFixed(2)} USDC`,
          calls.length > 1 ? 'one signature: approve + buy' : 'approval already set',
        ],
      },
    });
    return {
      ok: true,
      message: calls.length > 1 ? `Bought ${input.outcome} shares with one passkey approve + buy.` : `Bought ${input.outcome} shares with passkey.`,
      txHash: txHash ? txHash as Hex : undefined,
    };
  } catch (error) {
    return passkeyPendingResult(error, `Buy ${input.outcome}`) ?? { ok: false, message: normalizeError(error, 'Passkey buy failed.') };
  }
}

export async function buyPasskeyLmsrShares(input: LmsrBuyInput): Promise<LiveActionResult> {
  try {
    const config = requireConfig();
    const publicClient = getPublicClient();
    const { address } = await getCirclePasskeyBundlerClient();

    if (!isAddress(input.marketAddress)) throw new Error('Market address is invalid.');
    const marketAddress = input.marketAddress as Address;
    await assertMarketOpenForTrading(publicClient, marketAddress);

    const shares6 = parseUnits(String(input.shares), 6);
    const maxCost6 = parseUnits(String(input.maxCost), 6);
    if (shares6 <= BigInt(0) || maxCost6 <= BigInt(0)) {
      throw new Error('Enter a valid share amount and max cost.');
    }

    const collateralToken = (await withRetry(() => publicClient.readContract({
      address: marketAddress,
      abi: prestoLmsrMarketAbi,
      functionName: 'collateral',
    })).catch(() => config.usdcAddress)) as Address;
    const collateralSymbol = collateralSymbolForAddress(collateralToken);
    const unit = collateralUnit(collateralSymbol);
    const [balance, allowance] = await Promise.all([
      withRetry(() => publicClient.readContract({
        address: collateralToken,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      })),
      withRetry(() => publicClient.readContract({
        address: collateralToken,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, marketAddress],
      })),
    ]);

    if (balance < maxCost6) {
      throw new Error(`Insufficient ${collateralSymbol} balance. You have ${unit}${Number(formatUnits(balance, 6)).toFixed(2)} but this buy may cost up to ${unit}${input.maxCost}.`);
    }

    const calls: Array<{ to: Address; data: Hex }> = [];
    if (allowance < maxCost6) {
      calls.push(memoPasskeyCall({
        target: collateralToken,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [marketAddress, maxCost6] }),
        action: 'buy',
        marketId: marketAddress,
        outcome: input.outcome,
        outcomeIndex: input.outcomeIndex,
        amount6: maxCost6.toString(),
        collateral: collateralSymbol,
        ref: 'approve-lmsr',
      }));
    }
    calls.push(memoPasskeyCall({
      target: marketAddress,
      data: encodeFunctionData({ abi: prestoLmsrMarketAbi, functionName: 'buy', args: [input.outcomeIndex, shares6, maxCost6] }),
      action: 'buy',
      marketId: marketAddress,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      amount6: shares6.toString(),
      collateral: collateralSymbol,
    }));

    const readShares = () => publicClient.readContract({
      address: marketAddress,
      abi: prestoLmsrMarketAbi,
      functionName: 'sharesOf',
      args: [input.outcomeIndex, address],
    }) as Promise<bigint>;
    const sharesBefore = await readShares().catch(() => BigInt(0));

    const txHash = await runPasskeyCalls(calls, {
      confirmOnchain: async () => (await readShares().catch(() => sharesBefore)) > sharesBefore,
      preview: {
        label: `Buy ${input.outcome} shares`,
        action: calls.length > 1
          ? `Approve ${collateralSymbol} and buy LMSR shares in one passkey signature.`
          : `Buy LMSR shares with your passkey.`,
        amountDisplay: `${unit}${Number(input.maxCost).toFixed(2)} max ${collateralSymbol}`,
        functionSignature: 'buy(uint8,uint256,uint256)',
        contractAddress: marketAddress,
        parameters: [
          `shares: ${input.shares}`,
          `max cost: ${unit}${Number(input.maxCost).toFixed(2)} ${collateralSymbol}`,
          `outcome: ${input.outcome} (${input.outcomeIndex})`,
        ],
      },
    });
    return { ok: true, message: `Bought ${input.outcome} LMSR shares with passkey.`, txHash: txHash ? txHash as Hex : undefined };
  } catch (error) {
    return passkeyPendingResult(error, `Buy ${input.outcome}`) ?? { ok: false, message: normalizeError(error, 'Passkey LMSR buy failed.') };
  }
}

export async function sellPasskeyLmsrShares(input: LmsrSellInput): Promise<LiveActionResult> {
  try {
    if (!isAddress(input.marketAddress)) throw new Error('Market address is invalid.');
    const marketAddress = input.marketAddress as Address;
    const shares6 = parseUnits(String(input.shares), 6);
    const minRefund6 = parseUnits(String(input.minRefund ?? 0), 6);
    if (shares6 <= BigInt(0)) throw new Error('Enter a share amount to sell.');

    const txHash = await runPasskeyCalls([memoPasskeyCall({
      target: marketAddress,
      data: encodeFunctionData({
        abi: prestoLmsrMarketAbi,
        functionName: 'sell',
        args: [input.outcomeIndex, shares6, minRefund6],
      }),
      action: 'sell',
      marketId: marketAddress,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      amount6: shares6.toString(),
    })], {
      preview: {
        label: `Sell ${input.outcome} shares`,
        action: 'Sell LMSR shares with your passkey.',
        functionSignature: 'sell(uint8,uint256,uint256)',
        contractAddress: marketAddress,
        parameters: [
          `shares: ${input.shares}`,
          `minimum refund: ${input.minRefund}`,
          `outcome: ${input.outcome} (${input.outcomeIndex})`,
        ],
      },
    });
    return { ok: true, message: `Sold ${input.outcome} LMSR shares with passkey.`, txHash: txHash ? txHash as Hex : undefined };
  } catch (error) {
    return passkeyPendingResult(error, `Sell ${input.outcome}`) ?? { ok: false, message: normalizeError(error, 'Passkey LMSR sell failed.') };
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
    // claim/refund pay USDC out to the caller — confirm from Arc the moment their balance rises
    // (sub-second) rather than waiting on Circle's bundler receipt. cancel moves no funds to the
    // caller, so it keeps the plain receipt wait.
    let confirmOnchain: (() => Promise<boolean>) | undefined;
    if (functionName === 'claim' || functionName === 'refund') {
      const config = requireConfig();
      const publicClient = getPublicClient();
      const { address } = await getCirclePasskeyBundlerClient();
      const readBalance = () => publicClient.readContract({
        address: config.usdcAddress, abi: erc20Abi, functionName: 'balanceOf', args: [address],
      }) as Promise<bigint>;
      const balanceBefore = await readBalance().catch(() => BigInt(0));
      confirmOnchain = async () => (await readBalance().catch(() => balanceBefore)) > balanceBefore;
    }
    const txHash = await runPasskeyCalls([memoPasskeyCall({
      target: marketAddress as Address,
      data: encodeFunctionData({
        abi: prestoMarketAbi,
        functionName,
      }),
      action: functionName,
      marketId: marketAddress as Address,
    })], {
      confirmOnchain,
      preview: {
        label: success,
        action: `Sign ${functionName}() on this market with your passkey.`,
        functionSignature: `${functionName}()`,
        contractAddress: marketAddress,
      },
    });
    return { ok: true, message: success, txHash: txHash ? txHash as `0x${string}` : undefined };
  } catch (error) {
    return passkeyPendingResult(error, success) ?? { ok: false, message: normalizeError(error, `${success} failed.`) };
  }
}

// Settle EVERY claimable position in ONE userOp (one biometric prompt): claim()/refund() calls
// batched through the smart account. Confirms from Arc the moment the wallet's USDC balance rises.
export async function claimAllPasskeyMarkets(
  items: Array<{ marketAddress: string; mode: 'claim' | 'refund' }>,
): Promise<LiveActionResult> {
  try {
    const valid = items.filter((item) => isAddress(item.marketAddress));
    if (valid.length === 0) return { ok: false, message: 'Nothing to claim.' };
    const config = requireConfig();
    const publicClient = getPublicClient();
    const { address } = await getCirclePasskeyBundlerClient();
    const readBalance = () => publicClient.readContract({
      address: config.usdcAddress, abi: erc20Abi, functionName: 'balanceOf', args: [address],
    }) as Promise<bigint>;
    const balanceBefore = await readBalance().catch(() => BigInt(0));

    const calls = valid.map((item) => memoPasskeyCall({
      target: item.marketAddress as Address,
      data: encodeFunctionData({ abi: prestoMarketAbi, functionName: item.mode }),
      action: item.mode,
      marketId: item.marketAddress as Address,
    }));

    const txHash = await runPasskeyCalls(calls, {
      confirmOnchain: async () => (await readBalance().catch(() => balanceBefore)) > balanceBefore,
      preview: {
        label: `Claim all (${valid.length})`,
        action: `Settle ${valid.length} position${valid.length === 1 ? '' : 's'} (claims and refunds) with one passkey signature.`,
        functionSignature: 'claim() / refund()',
        parameters: valid.slice(0, 6).map((item) => `${item.mode}: ${item.marketAddress.slice(0, 10)}…`),
      },
    });
    return { ok: true, message: `Settled ${valid.length} positions with passkey.`, txHash: txHash ? txHash as Hex : undefined };
  } catch (error) {
    return passkeyPendingResult(error, 'Claim all') ?? { ok: false, message: normalizeError(error, 'Claim all failed.') };
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

export async function disputePasskeyMarket(marketAddress: string, reason: string): Promise<LiveActionResult> {
  try {
    if (!isAddress(marketAddress)) {
      throw new Error('Market address is invalid.');
    }
    const txHash = await runPasskeyCalls([memoPasskeyCall({
      target: marketAddress as Address,
      data: encodeFunctionData({ abi: prestoMarketAbi, functionName: 'disputeResolution', args: [reason] }),
      action: 'dispute',
      marketId: marketAddress as Address,
      ref: reason.slice(0, 120),
    })], {
      preview: {
        label: 'Dispute the proposed result',
        action: 'Sign a dispute with your passkey. This blocks the unchallenged settle, and the resolver must then settle directly with evidence.',
        functionSignature: 'disputeResolution(string)',
        contractAddress: marketAddress,
      },
    });
    return {
      ok: true,
      message: 'Dispute submitted with passkey — automatic settlement is blocked; the resolver must settle directly with evidence.',
      txHash: txHash ? txHash as `0x${string}` : undefined,
    };
  } catch (error) {
    return passkeyPendingResult(error, 'Dispute') ?? { ok: false, message: normalizeError(error, 'Passkey dispute failed.') };
  }
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
    const outcomeIndex = input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1);
    const txHash = await runPasskeyCalls([memoPasskeyCall({
      target: input.marketAddress as Address,
      data: encodeFunctionData({
        abi: prestoMarketAbi,
        functionName: 'resolve',
        args: [outcomeIndex, input.resolutionURI],
      }),
      action: 'resolve',
      marketId: input.marketAddress as Address,
      outcome: input.outcome,
      outcomeIndex,
      ref: input.resolutionURI,
    })], {
      preview: {
        label: `Resolve as ${input.outcome}`,
        action: 'Sign the final outcome with your passkey. The evidence URI is recorded on the contract.',
        functionSignature: 'resolve(uint8,string)',
        contractAddress: input.marketAddress,
        parameters: [`outcome: ${input.outcome} (${outcomeIndex})`],
      },
    });
    return { ok: true, message: 'Market resolved with passkey.', txHash: txHash ? txHash as `0x${string}` : undefined };
  } catch (error) {
    return passkeyPendingResult(error, 'Resolve') ?? { ok: false, message: normalizeError(error, 'Passkey resolve failed.') };
  }
}
