import { createPublicClient, encodeFunctionData, formatUnits, isAddress, parseEventLogs, parseUnits, type Address, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { getArcConfig, collateralSymbolForAddress, collateralUnit } from './arcConfig';
import { ARC_READ_BATCH, arcReadTransport } from './arcClient';
import { buildMarketMetadataURI } from './marketMetadata';
import { executeCircleChallenge, getStoredConnectedWallet, refreshCircleSessionIfNeeded, type CircleSession } from './walletProvider';
import { requestCircleConfirmation, type CircleConfirmDetails } from './circleConfirm';
import { getAgentResolverSelectionError, getResolveFeeUsdc, isAgentResolutionMode } from './resolveFee';
import { erc20Abi, prestoLmsrMarketAbi, prestoMarketAbi, prestoMarketFactoryAbi, prestoMultiOutcomeMarketFactoryAbi } from './contracts';
import { GATEWAY_MINTER, GATEWAY_MINT_SIGNATURE } from './gatewayActions';
import { buildMemoContractExecution, encodeMemoWrappedCall, type PrestoMemoAction } from './arcMemos';
import type { CreateLiveMarketInput, LiveActionResult } from './liveActions';
import type { MarketType } from './markets';
import { isRecord } from './typeGuards';

const ARC_EXPLORER_ADDRESS = 'https://testnet.arcscan.app/address/';

const MIN_TRADE_USDC = 0.01;
const TX_POLL_INTERVAL_MS = 3_000;
// Arc finalizes quickly, so once Circle exposes a tx hash we verify the Arc receipt directly.
// If Circle does not expose a hash fast enough, return a pending result instead of trapping
// users in a long spinner.
const TX_POLL_TIMEOUT_MS = 75_000;
const TX_SOFT_CONFIRM_TIMEOUT_MS = 8_000;
const TX_SUBMIT_LOOKUP_TIMEOUT_MS = 8_000;
const ARC_RECEIPT_TIMEOUT_MS = 20_000;
// Arc is the source of truth and finalizes sub-second. When a caller can observe the
// transaction's on-chain effect directly (e.g. the buyer's shares increased), we confirm
// from Arc instead of waiting on Circle's slower transaction indexer — which otherwise
// leaves the progress toast spinning long after the trade has actually landed.
const ONCHAIN_CONFIRM_TIMEOUT_MS = 30_000;
const ONCHAIN_CONFIRM_POLL_MS = 1_500;
const QUICK_TXHASH_LOOKUP_MS = 3_000;

function memoContractExecution(input: {
  target: Address;
  data: Hex;
  action: PrestoMemoAction;
  marketId?: Address;
  outcome?: string;
  outcomeIndex?: number;
  amount6?: string;
  collateral?: string;
  ref?: string;
}) {
  return buildMemoContractExecution({
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
}

function memoBatchLeg(input: {
  target: Address;
  data: Hex;
  action: PrestoMemoAction;
  marketId?: Address;
  outcome?: string;
  outcomeIndex?: number;
  amount6?: string;
  collateral?: string;
  ref?: string;
}): [Address, string, Hex] {
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
  return [wrapped.to, '0', wrapped.data];
}

type CircleTxStatus =
  | 'INITIATED'
  | 'PENDING_RISK_SCREENING'
  | 'QUEUED'
  | 'SENT'
  | 'CONFIRMED'
  | 'COMPLETE'
  | 'FAILED'
  | 'CANCELLED'
  | 'DENIED';

type CircleTransaction = {
  id: string;
  state: CircleTxStatus;
  txHash?: string;
  errorReason?: string;
};

async function waitForArcReceipt(txHash: string): Promise<boolean> {
  if (!txHash) return false;
  const publicClient = getPublicClient();
  const deadline = Date.now() + ARC_RECEIPT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const receipt = await publicClient
      .getTransactionReceipt({ hash: txHash as Hex })
      .catch(() => null);

    if (receipt) {
      if (receipt.status === 'success') return true;
      throw new Error('Arc transaction reverted.');
    }

    await new Promise((r) => setTimeout(r, 1_500));
  }

  return false;
}

async function hasSuccessfulArcReceipt(txHash: string): Promise<boolean> {
  if (!txHash) return false;
  const receipt = await getPublicClient()
    .getTransactionReceipt({ hash: txHash as Hex })
    .catch(() => null);
  if (!receipt) return false;
  if (receipt.status === 'success') return true;
  throw new Error('Arc transaction reverted.');
}

function isCircleTxSuccess(tx: CircleTransaction): boolean {
  return tx.state === 'CONFIRMED' || tx.state === 'COMPLETE';
}

function isCircleTxFailure(tx: CircleTransaction): boolean {
  return tx.state === 'FAILED' || tx.state === 'CANCELLED' || tx.state === 'DENIED';
}

function isErrorResponse(value: unknown): value is { error?: string } {
  return isRecord(value) && (typeof (value as Record<string, unknown>).error === 'string' || !('error' in value));
}

async function callProvider<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/circle/wallet/provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const err = isErrorResponse(data) ? data.error : undefined;
    throw new Error(err || 'Circle wallet request failed.');
  }

  if (data === null) {
    throw new Error('Circle returned empty response');
  }

  return data as T;
}

async function executeChallenge(session: CircleSession, challengeId: string): Promise<void> {
  // Reuse the single shared Web SDK instance from walletProvider. Creating a fresh
  // `new W3SSdk` here (a second instance, after sign-in already created one) leaves a
  // stale global postMessage listener that swallows the iframe callback, so the PIN
  // screen silently never appears after the buy confirmation modal closes.
  await executeCircleChallenge({
    appId: session.appId,
    userToken: session.userToken,
    encryptionKey: session.encryptionKey,
    challengeId,
  });
}

async function getCircleTransaction(session: CircleSession, transactionId: string): Promise<CircleTransaction> {
  return callProvider<CircleTransaction>({
    action: 'getTransaction',
    userToken: session.userToken,
    transactionId,
  });
}

async function waitForTx(
  session: CircleSession,
  transactionId: string,
  timeoutMs = TX_POLL_TIMEOUT_MS,
): Promise<{ txHash: string; pending: boolean }> {
  const started = Date.now();
  let lastTxHash = '';
  while (Date.now() - started < timeoutMs) {
    const tx = await getCircleTransaction(session, transactionId);
    if (tx.txHash) {
      lastTxHash = tx.txHash;
      if (await waitForArcReceipt(tx.txHash)) {
        return { txHash: tx.txHash, pending: false };
      }
    }
    if (isCircleTxSuccess(tx)) {
      return { txHash: tx.txHash ?? '', pending: false };
    }
    if (isCircleTxFailure(tx)) {
      throw new Error(`Circle transaction ${tx.state.toLowerCase()}: ${tx.errorReason ?? 'no reason given'}`);
    }
    await new Promise((r) => setTimeout(r, TX_POLL_INTERVAL_MS));
  }
  // Timeout reached but no terminal failure — Arc finalizes in <1s so the tx is almost
  // certainly already onchain; Circle's indexer is just slow. Return what we have so the
  // UI can show a pending state with the explorer link instead of an error.
  return { txHash: lastTxHash, pending: true };
}

// Transient Circle/RPC failures (gas estimation, node blips, rate limits) that are worth retrying.
function isTransientCircleError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return msg.includes('estimation') || msg.includes('rpc') || msg.includes('429')
    || msg.includes('rate limit') || msg.includes('timeout') || msg.includes('timed out')
    || msg.includes('fetch failed') || msg.includes('failed to fetch') || msg.includes('network')
    || msg.includes('econn') || msg.includes('temporar') || msg.includes('try again')
    || msg.includes('unavailable') || msg.includes('502') || msg.includes('503') || msg.includes('504');
}

async function runContractExecution(input: {
  session: CircleSession;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: unknown[];
  amount?: string;
  refId?: string;
  preview?: Partial<CircleConfirmDetails>;
  waitForConfirmation?: boolean;
  // Optional Arc-direct confirmation: returns true once the transaction's on-chain effect
  // is observed. When provided, success is detected from Arc (sub-second) rather than from
  // Circle's transaction indexer, so the UI confirms promptly.
  confirmOnchain?: () => Promise<boolean>;
}): Promise<string> {
  // Show our own preview modal before Circle's PIN prompt. Circle's confirmation UI is
  // patchy for PIN-auth users on arbitrary contracts (no token icon, missing fee line),
  // so we always show transaction details we know on our side and only proceed when the
  // user confirms.
  const previewDetails: CircleConfirmDetails = {
    label: input.preview?.label ?? 'Sign with Circle wallet',
    action: input.preview?.action ?? 'You\'re about to sign a contract call on Arc Testnet.',
    contractAddress: input.preview?.contractAddress ?? input.contractAddress,
    functionSignature: input.preview?.functionSignature ?? input.abiFunctionSignature,
    amountDisplay: input.preview?.amountDisplay,
    parameters: input.preview?.parameters ?? input.abiParameters.map((p) => String(p)),
    contractExplorerUrl: input.preview?.contractExplorerUrl ?? `${ARC_EXPLORER_ADDRESS}${input.contractAddress}`,
  };
  const approved = await requestCircleConfirmation(previewDetails);
  if (!approved) {
    throw new Error('You cancelled the Circle signing request.');
  }

  // Circle's user-controlled contractExecution returns only a challengeId. The transactionId
  // is created server-side and the transactions list endpoint does NOT echo challengeId in
  // its response, so we time-anchor: record now() right before POSTing, then after the PIN
  // challenge resolves, pick the most recent transaction whose createDate is after our anchor.
  const anchor = Date.now() - 2_000; // 2s skew tolerance
  // Circle's gas estimation / node connection fails transiently (ESTIMATION_ERROR, RPC blips) and
  // the same call usually succeeds on a retry — matching the "goes through after some time" the
  // user reported. Retry transient failures with backoff before surfacing the error.
  const { challengeId } = await (async (): Promise<{ challengeId: string }> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await callProvider<{ challengeId: string }>({
          action: 'contractExecution',
          userToken: input.session.userToken,
          walletId: input.session.walletId,
          contractAddress: input.contractAddress,
          abiFunctionSignature: input.abiFunctionSignature,
          abiParameters: input.abiParameters,
          ...(input.amount ? { amount: input.amount } : {}),
          ...(input.refId ? { refId: input.refId } : {}),
        });
      } catch (error) {
        if (attempt < 2 && isTransientCircleError(error)) {
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
  })();

  if (!challengeId) {
    throw new Error('Circle did not return a challenge id.');
  }

  await executeChallenge(input.session, challengeId);
  const waitForConfirmation = input.waitForConfirmation ?? true;
  let observedTransactionId = '';
  let observedTxHash = '';

  // Fast path: confirm from Arc directly when the caller can observe the on-chain effect.
  // Arc finalizes sub-second, so this flips the UI to success promptly instead of spinning
  // on Circle's transaction indexer (which can lag the chain by tens of seconds).
  if (waitForConfirmation && input.confirmOnchain) {
    const deadline = Date.now() + ONCHAIN_CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!observedTransactionId) {
        observedTransactionId = await findRecentTransactionIdOnce(input.session, anchor).catch(() => '');
      }
      if (observedTransactionId) {
        const status = await checkCircleTransactionOnce(input.session, observedTransactionId)
          .catch(() => ({ confirmed: false, txHash: observedTxHash }));
        observedTxHash = status.txHash || observedTxHash;
        if (status.confirmed) return status.txHash;
      }
      if (await input.confirmOnchain().catch(() => false)) {
        // Confirmed on Arc. Best-effort: fetch Circle's tx hash for the explorer link, but do
        // not block success on the indexer — an empty hash just means "no link yet".
        return observedTxHash || await quickCircleTxHash(input.session, anchor).catch(() => '');
      }
      await new Promise((r) => setTimeout(r, ONCHAIN_CONFIRM_POLL_MS));
    }
    // Arc effect not observed in the budget — fall through to Circle's view, which still
    // detects real failures and the slow-indexer "pending" case.
  }

  let transactionId = '';
  try {
    transactionId = observedTransactionId || await findRecentTransactionId(
      input.session,
      anchor,
      waitForConfirmation ? 30_000 : TX_SUBMIT_LOOKUP_TIMEOUT_MS,
    );
  } catch (error) {
    if (!waitForConfirmation) {
      throw new Error(PENDING_TAG);
    }
    throw error;
  }

  const waitResult = await waitForTx(
    input.session,
    transactionId,
    waitForConfirmation ? TX_POLL_TIMEOUT_MS : TX_SOFT_CONFIRM_TIMEOUT_MS,
  );
  if (waitResult.pending) {
    // Tag the error string so action wrappers can convert this into a friendly
    // 'submitted, still confirming' result instead of an error toast.
    throw new Error(`__CIRCLE_PENDING__:${waitResult.txHash}`);
  }
  return waitResult.txHash;
}

const PENDING_TAG = '__CIRCLE_PENDING__:';

function pendingResultFromError(err: unknown, label: string): { ok: boolean; message: string; txHash?: `0x${string}`; pending?: boolean } | null {
  const msg = err instanceof Error ? err.message : '';
  if (!msg.startsWith(PENDING_TAG)) return null;
  const hashPart = msg.slice(PENDING_TAG.length).trim();
  const hash = hashPart && hashPart !== 'undefined' ? hashPart : '';
  return {
    ok: true,
    pending: true,
    message: `${label} submitted. Arc confirmation is updating in the background.`,
    txHash: hash ? (hash as `0x${string}`) : undefined,
  };
}

type ListedTransaction = {
  id: string;
  createDate?: string;
  walletId?: string;
  state?: string;
};

// Best-effort, short lookup of the Arc tx hash Circle assigned to the just-submitted tx.
// Used only to attach an explorer link after Arc has already confirmed the effect; returns
// '' if Circle has not indexed the transaction record yet.
async function quickCircleTxHash(session: CircleSession, anchorMs: number): Promise<string> {
  const transactionId = await findRecentTransactionId(session, anchorMs, QUICK_TXHASH_LOOKUP_MS);
  const tx = await getCircleTransaction(session, transactionId);
  return tx.txHash ?? '';
}

async function checkCircleTransactionOnce(
  session: CircleSession,
  transactionId: string,
): Promise<{ confirmed: boolean; txHash: string }> {
  const tx = await getCircleTransaction(session, transactionId);
  const txHash = tx.txHash ?? '';
  if (txHash && await hasSuccessfulArcReceipt(txHash)) {
    return { confirmed: true, txHash };
  }
  if (isCircleTxSuccess(tx)) {
    return { confirmed: true, txHash };
  }
  if (isCircleTxFailure(tx)) {
    throw new Error(`Circle transaction ${tx.state.toLowerCase()}: ${tx.errorReason ?? 'no reason given'}`);
  }
  return { confirmed: false, txHash };
}

async function findRecentTransactionIdOnce(session: CircleSession, anchorMs: number): Promise<string> {
  const list = await callProvider<{ transactions?: ListedTransaction[] }>({
    action: 'findTransactionByChallenge',
    userToken: session.userToken,
    walletId: session.walletId,
  });
  const candidates = (list.transactions ?? [])
    .filter((t) => t.id && t.createDate)
    .filter((t) => new Date(t.createDate!).getTime() >= anchorMs)
    .sort((a, b) => new Date(b.createDate!).getTime() - new Date(a.createDate!).getTime());
  return candidates[0]?.id ?? '';
}

async function findRecentTransactionId(session: CircleSession, anchorMs: number, timeoutMs = 30_000): Promise<string> {
  // Poll briefly: Circle may not have indexed the transaction the instant the challenge resolves.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const transactionId = await findRecentTransactionIdOnce(session, anchorMs);
    if (transactionId) return transactionId;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error('Could not locate the transaction after challenge approval.');
}

async function requireSession(): Promise<CircleSession> {
  // Auto-refresh the userToken if it's near Circle's 60-minute expiry. The user keeps
  // transacting without re-signing in for as long as the tab is open.
  const session = await refreshCircleSessionIfNeeded();
  if (!session) {
    // Session is null — either no session exists or refresh failed/timed out
    throw new Error('Circle wallet session expired. Please sign in again to continue.');
  }
  return session;
}

function requireArcConfig() {
  const config = getArcConfig();
  if (!config.factoryAddress || !isAddress(config.factoryAddress)) {
    throw new Error('NEXT_PUBLIC_MARKET_FACTORY_ADDRESS must be a valid address.');
  }
  if (!config.usdcAddress || !isAddress(config.usdcAddress)) {
    throw new Error('NEXT_PUBLIC_USDC_ADDRESS must be a valid address.');
  }
  return config;
}

function getPublicClient() {
  const config = getArcConfig();
  if (!config.rpcUrl) {
    throw new Error('NEXT_PUBLIC_ARC_RPC_URL is required for live Arc reads.');
  }

  return createPublicClient({
    chain: arcTestnet,
    transport: arcReadTransport(config.rpcUrl),
    batch: ARC_READ_BATCH,
  });
}

async function assertMarketOpenForTrading(marketAddress: Address) {
  const publicClient = getPublicClient();
  const [state, closeTime] = await Promise.all([
    publicClient.readContract({
      address: marketAddress,
      abi: prestoMarketAbi,
      functionName: 'state',
    }),
    publicClient.readContract({
      address: marketAddress,
      abi: prestoMarketAbi,
      functionName: 'closeTime',
    }),
  ]);

  if (Number(state) !== 0) {
    throw new Error('This market is already settled and cannot be traded.');
  }

  if (Number(closeTime) <= Math.floor(Date.now() / 1000)) {
    throw new Error('This market is closed for trading.');
  }
}

async function readCircleTradeFunding(input: {
  marketAddress: Address;
  ownerAddress: Address;
  usdcAddress: Address;
  amount: bigint;
}) {
  const publicClient = getPublicClient();
  const [balance, allowance] = await Promise.all([
    publicClient.readContract({
      address: input.usdcAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [input.ownerAddress],
    }),
    publicClient.readContract({
      address: input.usdcAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [input.ownerAddress, input.marketAddress],
    }),
  ]);

  if (balance < input.amount) {
    throw new Error(`Insufficient USDC balance. You have $${Number(formatUnits(balance, 6)).toFixed(2)} but this trade needs $${Number(formatUnits(input.amount, 6)).toFixed(2)}.`);
  }

  return { allowance };
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

function getMarketKind(type: MarketType): number {
  if (type === 'Opinion') return 1;
  return 0;
}

async function readCreatedMarketAddress(txHash: string, multiOutcome = false): Promise<Address | undefined> {
  const config = getArcConfig();
  if (!config.rpcUrl || !txHash) return undefined;
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: arcReadTransport(config.rpcUrl),
    batch: ARC_READ_BATCH,
  });
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
  const created = parseEventLogs({
    abi: multiOutcome ? prestoMultiOutcomeMarketFactoryAbi : prestoMarketFactoryAbi,
    eventName: 'MarketCreated',
    logs: receipt.logs,
  })[0];
  return created?.args.market;
}

function getCloseTimestamp(closeDate: string): bigint {
  const closeTime = Math.floor(new Date(closeDate).getTime() / 1000);
  if (!Number.isFinite(closeTime) || closeTime <= Math.floor(Date.now() / 1000)) {
    throw new Error('Close date must be in the future.');
  }
  return BigInt(closeTime);
}

export async function createCircleMarket(input: CreateLiveMarketInput): Promise<LiveActionResult> {
  try {
    const session = await requireSession();
    const config = requireArcConfig();
    if (!isAddress(input.resolver)) {
      throw new Error('Resolver must be a valid wallet address.');
    }
    const agentResolverError = getAgentResolverSelectionError(input);
    if (agentResolverError) throw new Error(agentResolverError);
    const feeHuman = getResolveFeeUsdc();
    const feeAmount = isAgentResolutionMode(input.resolutionMode)
      ? parseUnits(feeHuman, 6)
      : BigInt(0);
    const closeStamp = getCloseTimestamp(input.closeDate);
    const closeReadable = new Date(Number(closeStamp) * 1000).toLocaleString();
    const outcomeOptions = cleanOutcomeOptions(input);
    const useMultiOutcome = shouldUseMultiOutcomeFactory(input);
    // Euro markets route to the EURC-collateral factories.
    const isEurc = input.collateral === 'EURC';
    const factoryAddress = isEurc
      ? (useMultiOutcome ? config.eurcMultiOutcomeFactoryAddress : config.eurcFactoryAddress)
      : (useMultiOutcome ? config.multiOutcomeFactoryAddress : config.factoryAddress);
    if (!factoryAddress || !isAddress(factoryAddress)) {
      throw new Error(isEurc
        ? 'EURC factory is not configured. Set NEXT_PUBLIC_EURC_MARKET_FACTORY_ADDRESS.'
        : 'Set NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS before launching poll markets.');
    }
    const metadataURI = buildMarketMetadataURI({ ...input, outcomeOptions });
    const createSignature = useMultiOutcome
      ? 'createMarket(address,uint256,string,uint8,uint8)'
      : 'createMarket(address,uint256,string,uint8)';
    const createData = encodeFunctionData({
      abi: useMultiOutcome ? prestoMultiOutcomeMarketFactoryAbi : prestoMarketFactoryAbi,
      functionName: 'createMarket',
      args: useMultiOutcome ? [
        input.resolver as Address,
        closeStamp,
        metadataURI,
        getMarketKind(input.type),
        outcomeOptions.length,
      ] : [
        input.resolver as Address,
        closeStamp,
        metadataURI,
        getMarketKind(input.type),
      ],
    });
    const memoCreate = memoContractExecution({
      target: factoryAddress as Address,
      data: createData,
      action: 'market_create',
      ref: input.agent?.trendUrl ?? input.title.slice(0, 80),
    });
    const txHash = await runContractExecution({
      session,
      contractAddress: memoCreate.contractAddress,
      abiFunctionSignature: memoCreate.abiFunctionSignature,
      abiParameters: memoCreate.abiParameters,
      preview: {
        label: `Launch "${input.title.slice(0, 60)}${input.title.length > 60 ? '…' : ''}"`,
        action: `Deploys a new ${input.type} market via the Presto factory. The resolver address you picked will sign settlement.`,
        contractAddress: factoryAddress,
        functionSignature: createSignature,
        parameters: [
          `resolver: ${input.resolver.slice(0, 6)}…${input.resolver.slice(-4)}`,
          `closes: ${closeReadable}`,
          `kind: ${input.type}`,
        ],
      },
      waitForConfirmation: feeAmount > BigInt(0),
    });
    const marketAddress = await readCreatedMarketAddress(txHash, useMultiOutcome).catch(() => undefined);
    let message = 'Live market created via Circle wallet.';
    if (feeAmount > BigInt(0)) {
      try {
        const feeData = encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [input.resolver as Address, feeAmount],
        });
        const memoFee = memoContractExecution({
          target: config.usdcAddress as Address,
          data: feeData,
          action: 'resolution_fee',
          marketId: marketAddress,
          amount6: feeAmount.toString(),
          collateral: 'USDC',
          ref: input.agent?.trendUrl,
        });
        await runContractExecution({
          session,
          contractAddress: memoFee.contractAddress,
          abiFunctionSignature: memoFee.abiFunctionSignature,
          abiParameters: memoFee.abiParameters,
          refId: `presto-resolve-fee-${Date.now()}`,
          preview: {
            label: `Fund automatic resolution - $${feeHuman} USDC`,
            action: `Funds the Presto agent to settle this market automatically after it closes. Sent directly to ${input.resolver.slice(0, 6)}...${input.resolver.slice(-4)}.`,
            contractAddress: config.usdcAddress,
            functionSignature: 'transfer(address,uint256)',
            amountDisplay: `$${feeHuman} USDC`,
            parameters: [
              `recipient: ${input.resolver.slice(0, 6)}...${input.resolver.slice(-4)} (agent wallet)`,
              `amount: $${feeHuman} USDC`,
            ],
          },
        });
        message = 'Live market created via Circle wallet. Automatic resolution funded.';
      } catch {
        message = 'Live market created via Circle wallet, but automatic resolution funding was not completed. Fund the agent resolver before this market closes.';
      }
    }
    return { ok: true, message, txHash: txHash as `0x${string}`, marketAddress };
  } catch (error) {
    const pending = pendingResultFromError(error, 'Market creation');
    if (pending) return pending;
    return { ok: false, message: error instanceof Error ? error.message : 'Market creation failed.' };
  }
}

// Submit the Arc mint leg of a Move-to-Arc from the Circle wallet itself. The external EOA
// deposited on the source chain and signed the (gasless) burn intent; here the Circle UCW
// submits the Gateway-attested mint via contractExecution, so the EOA needs no Arc gas. The mint
// is callable by anyone and fully gated by the attestation, so the Circle wallet submitting it is
// safe. Returns the Arc mint tx hash (throws on failure).
export async function mintGatewayViaCircle(attestation: string, apiSignature: string): Promise<string> {
  const session = await requireSession();
  const gatewayData = encodeFunctionData({
    abi: [{
      type: 'function',
      name: 'gatewayMint',
      inputs: [{ name: 'attestationPayload', type: 'bytes' }, { name: 'signature', type: 'bytes' }],
      outputs: [],
      stateMutability: 'nonpayable',
    }] as const,
    functionName: 'gatewayMint',
    args: [attestation as Hex, apiSignature as Hex],
  });
  const memoMint = memoContractExecution({
    target: GATEWAY_MINTER,
    data: gatewayData,
    action: 'gateway_mint',
    ref: `presto-gateway-mint-${Date.now()}`,
  });
  return runContractExecution({
    session,
    contractAddress: memoMint.contractAddress,
    abiFunctionSignature: memoMint.abiFunctionSignature,
    abiParameters: memoMint.abiParameters,
    refId: `presto-gateway-mint-${Date.now()}`,
    waitForConfirmation: true,
    preview: {
      label: 'Receive USDC on Arc',
      action: 'Completes your cross-chain move by minting the USDC into your Circle wallet on Arc.',
      contractAddress: GATEWAY_MINTER,
      functionSignature: GATEWAY_MINT_SIGNATURE,
      parameters: ['Circle Gateway attested transfer', 'destination: your Arc balance'],
    },
  });
}

export async function buyCircleShares(input: { marketAddress: string; outcome: string; outcomeIndex?: number; amount: number }): Promise<LiveActionResult> {
  try {
    const session = await requireSession();
    const config = requireArcConfig();
    if (!isAddress(input.marketAddress)) throw new Error('Market address is invalid.');
    const marketAddress = input.marketAddress as Address;
    await assertMarketOpenForTrading(marketAddress);
    if (!Number.isFinite(input.amount) || input.amount < MIN_TRADE_USDC) {
      throw new Error(`Minimum trade is $${MIN_TRADE_USDC} USDC.`);
    }
    // Spend the market's own collateral token (USDC for nearly all markets, EURC for euro
    // markets). Older markets without collateral() fall back to the configured USDC address.
    const usdcAddress = (await getPublicClient().readContract({
      address: marketAddress, abi: prestoMarketAbi, functionName: 'collateral',
    }).catch(() => config.usdcAddress!)) as Address;
    const collateralSymbol = collateralSymbolForAddress(usdcAddress);
    const collUnit = collateralUnit(collateralSymbol);
    const amount = parseUnits(String(input.amount), 6).toString();
    const amountValue = BigInt(amount);
    const ownerAddress = getStoredConnectedWallet()?.address;
    if (!ownerAddress || !isAddress(ownerAddress)) {
      throw new Error('Circle wallet address is missing. Sign in again.');
    }

    const humanAmount = `${collUnit}${Number(input.amount).toFixed(2)} ${collateralSymbol}`;
    const funding = await readCircleTradeFunding({
      marketAddress,
      ownerAddress: ownerAddress as Address,
      usdcAddress,
      amount: amountValue,
    });
    const buyOutcomeIndex = input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1);

    // Snapshot the buyer's on-chain shares for this outcome so we can confirm the trade
    // directly from Arc (shares increased) rather than waiting on Circle's slower indexer.
    const sharesClient = getPublicClient();
    const readShares = () => sharesClient.readContract({
      address: marketAddress,
      abi: prestoMarketAbi,
      functionName: 'sharesOf',
      args: [buyOutcomeIndex, ownerAddress as Address],
    }) as Promise<bigint>;
    const sharesBefore = await readShares().catch(() => BigInt(0));

    // Batch the (optional) USDC approve + the buy into ONE SCA user-op so the user signs a
    // single PIN challenge instead of two. Circle runs executeBatch on the wallet's own
    // address; each leg is [target, nativeValue, calldata]. The proxy allowlist
    // (circleWalletPolicy.inspectBatch) validates every leg before signing. The signature
    // string must stay in sync with BATCH_SIGNATURE in circleWalletPolicy.ts.
    const legs: Array<[Address, string, Hex]> = [];
    if (funding.allowance < amountValue) {
      // Exact-amount approval by default so the allowance never exceeds the stated buy (trust-first).
      // The approve + buy are already batched into ONE signature here, so exact approval costs the
      // user nothing extra. Opt into max approval (skips the approve leg on future buys) with
      // NEXT_PUBLIC_BATCH_APPROVAL=true.
      const approveValue = process.env.NEXT_PUBLIC_BATCH_APPROVAL === 'true'
        ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        : amountValue;
      legs.push(memoBatchLeg({
        target: usdcAddress,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [marketAddress, approveValue] }),
        action: 'buy',
        marketId: marketAddress,
        outcome: input.outcome,
        outcomeIndex: buyOutcomeIndex,
        amount6: amountValue.toString(),
        collateral: collateralSymbol,
        ref: 'approve',
      }));
    }
    legs.push(memoBatchLeg({
      target: marketAddress,
      data: encodeFunctionData({ abi: prestoMarketAbi, functionName: 'buy', args: [buyOutcomeIndex, amountValue] }),
      action: 'buy',
      marketId: marketAddress,
      outcome: input.outcome,
      outcomeIndex: buyOutcomeIndex,
      amount6: amountValue.toString(),
      collateral: collateralSymbol,
    }));

    const txHash = await runContractExecution({
      session,
      contractAddress: ownerAddress,
      abiFunctionSignature: 'executeBatch((address, uint256, bytes)[])',
      abiParameters: [legs],
      refId: `presto-buy-${input.marketAddress}-${Date.now()}`,
      preview: {
        label: `Buy ${input.outcome} · ${humanAmount}`,
        action: legs.length > 1
          ? `Approves USDC and buys ${input.outcome} shares in a single signature.`
          : `Mints ${input.outcome} shares for this market against your approved USDC.`,
        amountDisplay: humanAmount,
        parameters: [
          `outcome: ${input.outcome} (${buyOutcomeIndex})`,
          `amount: ${humanAmount}`,
          legs.length > 1 ? 'one signature: approve + buy' : 'approval already set',
        ],
      },
      waitForConfirmation: true,
      confirmOnchain: async () => (await readShares()) > sharesBefore,
    });
    return { ok: true, message: `Bought ${input.outcome} shares via Circle wallet.`, txHash: txHash as `0x${string}` };
  } catch (error) {
    const pending = pendingResultFromError(error, `Buy ${input.outcome}`);
    if (pending) return pending;
    return { ok: false, message: error instanceof Error ? error.message : 'Buy transaction failed.' };
  }
}

// ---- V3 LMSR share-denominated trading (Circle wallet) ----

export async function buyCircleLmsrShares(input: { marketAddress: string; outcome: string; outcomeIndex: number; shares: number; maxCost: number }): Promise<LiveActionResult> {
  try {
    const session = await requireSession();
    const config = requireArcConfig();
    if (!isAddress(input.marketAddress)) throw new Error('Market address is invalid.');
    const marketAddress = input.marketAddress as Address;
    await assertMarketOpenForTrading(marketAddress);
    const shares6 = parseUnits(String(input.shares), 6);
    const maxCost6 = parseUnits(String(input.maxCost), 6);
    if (shares6 <= BigInt(0)) throw new Error('Enter a share amount.');

    const collateralToken = (await getPublicClient().readContract({
      address: marketAddress, abi: prestoLmsrMarketAbi, functionName: 'collateral',
    }).catch(() => config.usdcAddress!)) as Address;
    const collateralSymbol = collateralSymbolForAddress(collateralToken);
    const collUnit = collateralUnit(collateralSymbol);
    const ownerAddress = getStoredConnectedWallet()?.address;
    if (!ownerAddress || !isAddress(ownerAddress)) throw new Error('Circle wallet address is missing. Sign in again.');

    const funding = await readCircleTradeFunding({ marketAddress, ownerAddress: ownerAddress as Address, usdcAddress: collateralToken, amount: maxCost6 });
    const sharesClient = getPublicClient();
    const readShares = () => sharesClient.readContract({
      address: marketAddress, abi: prestoLmsrMarketAbi, functionName: 'sharesOf', args: [input.outcomeIndex, ownerAddress as Address],
    }) as Promise<bigint>;
    const sharesBefore = await readShares().catch(() => BigInt(0));

    // Batch the (optional) approve + the slippage-guarded buy into one SCA user-op (one PIN).
    const legs: Array<[Address, string, Hex]> = [];
    if (funding.allowance < maxCost6) {
      const approveValue = process.env.NEXT_PUBLIC_BATCH_APPROVAL === 'true'
        ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        : maxCost6;
      legs.push(memoBatchLeg({
        target: collateralToken,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [marketAddress, approveValue] }),
        action: 'buy',
        marketId: marketAddress,
        outcome: input.outcome,
        outcomeIndex: input.outcomeIndex,
        amount6: maxCost6.toString(),
        collateral: collateralSymbol,
        ref: 'approve-lmsr',
      }));
    }
    legs.push(memoBatchLeg({
      target: marketAddress,
      data: encodeFunctionData({ abi: prestoLmsrMarketAbi, functionName: 'buy', args: [input.outcomeIndex, shares6, maxCost6] }),
      action: 'buy',
      marketId: marketAddress,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      amount6: shares6.toString(),
      collateral: collateralSymbol,
    }));

    const humanCost = `${collUnit}${Number(input.maxCost).toFixed(2)} ${collateralSymbol}`;
    const txHash = await runContractExecution({
      session,
      contractAddress: ownerAddress,
      abiFunctionSignature: 'executeBatch((address, uint256, bytes)[])',
      abiParameters: [legs],
      refId: `presto-lmsrbuy-${input.marketAddress}-${Date.now()}`,
      preview: {
        label: `Buy ${input.shares} ${input.outcome} shares`,
        action: legs.length > 1
          ? `Approves ${collateralSymbol} and buys ${input.outcome} shares in a single signature. Max cost ${humanCost}.`
          : `Buys ${input.outcome} shares against your approved ${collateralSymbol}. Max cost ${humanCost}.`,
        amountDisplay: humanCost,
        parameters: [`outcome: ${input.outcome} (${input.outcomeIndex})`, `shares: ${input.shares}`, `max cost: ${humanCost}`],
      },
      waitForConfirmation: true,
      confirmOnchain: async () => (await readShares()) > sharesBefore,
    });
    return { ok: true, message: `Bought ${input.shares} ${input.outcome} shares via Circle wallet.`, txHash: txHash as `0x${string}` };
  } catch (error) {
    const pending = pendingResultFromError(error, `Buy ${input.outcome}`);
    if (pending) return pending;
    return { ok: false, message: error instanceof Error ? error.message : 'Buy transaction failed.' };
  }
}

export async function sellCircleLmsrShares(input: { marketAddress: string; outcome: string; outcomeIndex: number; shares: number; minRefund: number }): Promise<LiveActionResult> {
  try {
    const session = await requireSession();
    if (!isAddress(input.marketAddress)) throw new Error('Market address is invalid.');
    const marketAddress = input.marketAddress as Address;
    await assertMarketOpenForTrading(marketAddress);
    const shares6 = parseUnits(String(input.shares), 6);
    const minRefund6 = parseUnits(String(input.minRefund ?? 0), 6);
    if (shares6 <= BigInt(0)) throw new Error('Enter a share amount to sell.');

    // Selling returns collateral to the holder — confirm from Arc the moment their balance rises.
    const owner = getStoredConnectedWallet()?.address;
    const collateralToken = (await getPublicClient().readContract({
      address: marketAddress, abi: prestoLmsrMarketAbi, functionName: 'collateral',
    }).catch(() => getArcConfig().usdcAddress)) as Address | undefined;
    let confirmOnchain: (() => Promise<boolean>) | undefined;
    if (owner && isAddress(owner) && collateralToken && isAddress(collateralToken)) {
      const client = getPublicClient();
      const readBalance = () => client.readContract({ address: collateralToken, abi: erc20Abi, functionName: 'balanceOf', args: [owner as Address] }) as Promise<bigint>;
      const before = await readBalance().catch(() => BigInt(0));
      confirmOnchain = async () => (await readBalance().catch(() => before)) > before;
    }

    const sellData = encodeFunctionData({
      abi: prestoLmsrMarketAbi,
      functionName: 'sell',
      args: [input.outcomeIndex, shares6, minRefund6],
    });
    const memoSell = memoContractExecution({
      target: marketAddress,
      data: sellData,
      action: 'sell',
      marketId: marketAddress,
      outcome: input.outcome,
      outcomeIndex: input.outcomeIndex,
      amount6: shares6.toString(),
    });
    const txHash = await runContractExecution({
      session,
      contractAddress: memoSell.contractAddress,
      abiFunctionSignature: memoSell.abiFunctionSignature,
      abiParameters: memoSell.abiParameters,
      refId: `presto-lmsrsell-${input.marketAddress}-${Date.now()}`,
      preview: {
        label: `Sell ${input.shares} ${input.outcome} shares`,
        action: `Sells ${input.outcome} shares back to the market at the live price. You receive at least ${Number(input.minRefund).toFixed(2)} collateral.`,
        contractAddress: marketAddress,
        functionSignature: 'sell(uint8,uint256,uint256)',
        parameters: [`outcome: ${input.outcome} (${input.outcomeIndex})`, `shares: ${input.shares}`, `min refund: ${Number(input.minRefund).toFixed(2)}`],
      },
      waitForConfirmation: true,
      confirmOnchain,
    });
    return { ok: true, message: `Sold ${input.shares} ${input.outcome} shares via Circle wallet.`, txHash: txHash as `0x${string}` };
  } catch (error) {
    const pending = pendingResultFromError(error, `Sell ${input.outcome}`);
    if (pending) return pending;
    return { ok: false, message: error instanceof Error ? error.message : 'Sell transaction failed.' };
  }
}

export async function resolveCircleMarket(input: { marketAddress: string; outcome: string; outcomeIndex?: number; resolutionURI: string }): Promise<LiveActionResult> {
  try {
    const session = await requireSession();
    if (!isAddress(input.marketAddress)) throw new Error('Market address is invalid.');
    const outcomeIndex = input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1);
    const data = encodeFunctionData({
      abi: prestoMarketAbi,
      functionName: 'resolve',
      args: [outcomeIndex, input.resolutionURI],
    });
    const memoResolve = memoContractExecution({
      target: input.marketAddress as Address,
      data,
      action: 'resolve',
      marketId: input.marketAddress as Address,
      outcome: input.outcome,
      outcomeIndex,
      ref: input.resolutionURI,
    });
    const txHash = await runContractExecution({
      session,
      contractAddress: memoResolve.contractAddress,
      abiFunctionSignature: memoResolve.abiFunctionSignature,
      abiParameters: memoResolve.abiParameters,
      waitForConfirmation: true,
      preview: {
        contractAddress: input.marketAddress,
        functionSignature: 'resolve(uint8,string)',
        parameters: [`outcome: ${input.outcome} (${outcomeIndex})`],
      },
    });
    return { ok: true, message: 'Market resolved via Circle wallet.', txHash: txHash as `0x${string}` };
  } catch (error) {
    const pending = pendingResultFromError(error, 'Market resolution');
    if (pending) return pending;
    return { ok: false, message: error instanceof Error ? error.message : 'Resolve transaction failed.' };
  }
}

async function noArgAction(
  marketAddress: string,
  signature: string,
  label: string,
  confirmOnchain?: () => Promise<boolean>,
): Promise<LiveActionResult> {
  try {
    const session = await requireSession();
    if (!isAddress(marketAddress)) throw new Error('Market address is invalid.');
    const functionName = signature.replace('()', '') as 'cancel' | 'claim' | 'refund';
    const data = encodeFunctionData({
      abi: prestoMarketAbi,
      functionName,
    });
    const memoCall = memoContractExecution({
      target: marketAddress as Address,
      data,
      action: functionName,
      marketId: marketAddress as Address,
    });
    const txHash = await runContractExecution({
      session,
      contractAddress: memoCall.contractAddress,
      abiFunctionSignature: memoCall.abiFunctionSignature,
      abiParameters: memoCall.abiParameters,
      waitForConfirmation: true,
      confirmOnchain,
      preview: {
        contractAddress: marketAddress,
        functionSignature: signature,
      },
    });
    return { ok: true, message: `${label} via Circle wallet.`, txHash: txHash as `0x${string}` };
  } catch (error) {
    const pending = pendingResultFromError(error, label);
    if (pending) return pending;
    return { ok: false, message: error instanceof Error ? error.message : `${label} failed.` };
  }
}

// Claim and refund pay USDC out to the caller's own wallet, so we confirm directly from Arc
// the moment the wallet's USDC balance rises - the same fast-path used for buys - instead of
// waiting on Circle's slower transaction indexer. (Cancel moves no funds to the caller, so it
// keeps the default Circle-indexer confirmation.)
async function settleWithUsdcConfirm(marketAddress: string, signature: string, label: string): Promise<LiveActionResult> {
  const owner = getStoredConnectedWallet()?.address;
  const config = getArcConfig();
  if (owner && isAddress(owner) && config.usdcAddress && isAddress(config.usdcAddress)) {
    const usdc = config.usdcAddress as Address;
    const wallet = owner as Address;
    const client = getPublicClient();
    const readBalance = () => client.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [wallet],
    }) as Promise<bigint>;
    const balanceBefore = await readBalance().catch(() => BigInt(0));
    return noArgAction(marketAddress, signature, label, async () => (await readBalance()) > balanceBefore);
  }
  return noArgAction(marketAddress, signature, label);
}

export const cancelCircleMarket = (m: string) => noArgAction(m, 'cancel()', 'Market canceled');
export const claimCircleMarket = (m: string) => settleWithUsdcConfirm(m, 'claim()', 'Claim submitted');
export const refundCircleMarket = (m: string) => settleWithUsdcConfirm(m, 'refund()', 'Refund submitted');

// Dispute a proposed resolution (V2 optimistic markets). Blocks the unchallenged settle path;
// the resolver must then settle directly with evidence.
export async function disputeCircleResolution(marketAddress: string, reason: string): Promise<LiveActionResult> {
  try {
    const session = await requireSession();
    if (!isAddress(marketAddress)) throw new Error('Market address is invalid.');
    const data = encodeFunctionData({
      abi: prestoMarketAbi,
      functionName: 'disputeResolution',
      args: [reason],
    });
    const memoDispute = memoContractExecution({
      target: marketAddress as Address,
      data,
      action: 'dispute',
      marketId: marketAddress as Address,
      ref: reason.slice(0, 120),
    });
    const txHash = await runContractExecution({
      session,
      contractAddress: memoDispute.contractAddress,
      abiFunctionSignature: memoDispute.abiFunctionSignature,
      abiParameters: memoDispute.abiParameters,
      waitForConfirmation: true,
      preview: {
        contractAddress: marketAddress,
        functionSignature: 'disputeResolution(string)',
        parameters: ['reason recorded with the dispute'],
      },
    });
    return { ok: true, message: 'Dispute submitted via Circle wallet - the resolver must now settle directly with evidence.', txHash: txHash as `0x${string}` };
  } catch (error) {
    const pending = pendingResultFromError(error, 'Dispute');
    if (pending) return pending;
    return { ok: false, message: error instanceof Error ? error.message : 'Dispute failed.' };
  }
}
