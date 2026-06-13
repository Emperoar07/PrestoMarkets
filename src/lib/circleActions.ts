import { createPublicClient, encodeFunctionData, formatUnits, isAddress, parseEventLogs, parseUnits, type Address, type Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { getArcConfig, collateralSymbolForAddress, collateralUnit } from './arcConfig';
import { ARC_READ_BATCH, arcReadTransport } from './arcClient';
import { buildMarketMetadataURI } from './marketMetadata';
import { executeCircleChallenge, getStoredConnectedWallet, refreshCircleSessionIfNeeded, type CircleSession } from './walletProvider';
import { requestCircleConfirmation, type CircleConfirmDetails } from './circleConfirm';
import { getAgentResolverSelectionError, getResolveFeeUsdc, isAgentResolutionMode } from './resolveFee';
import { erc20Abi, prestoMarketAbi, prestoMarketFactoryAbi, prestoMultiOutcomeMarketFactoryAbi } from './contracts';
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

async function waitForTx(
  session: CircleSession,
  transactionId: string,
  timeoutMs = TX_POLL_TIMEOUT_MS,
): Promise<{ txHash: string; pending: boolean }> {
  const started = Date.now();
  let lastTxHash = '';
  while (Date.now() - started < timeoutMs) {
    const tx = await callProvider<CircleTransaction>({
      action: 'getTransaction',
      userToken: session.userToken,
      transactionId,
    });
    if (tx.txHash) {
      lastTxHash = tx.txHash;
      if (await waitForArcReceipt(tx.txHash)) {
        return { txHash: tx.txHash, pending: false };
      }
    }
    if (tx.state === 'CONFIRMED' || tx.state === 'COMPLETE') {
      return { txHash: tx.txHash ?? '', pending: false };
    }
    if (tx.state === 'FAILED' || tx.state === 'CANCELLED' || tx.state === 'DENIED') {
      throw new Error(`Circle transaction ${tx.state.toLowerCase()}: ${tx.errorReason ?? 'no reason given'}`);
    }
    await new Promise((r) => setTimeout(r, TX_POLL_INTERVAL_MS));
  }
  // Timeout reached but no terminal failure — Arc finalizes in <1s so the tx is almost
  // certainly already onchain; Circle's indexer is just slow. Return what we have so the
  // UI can show a pending state with the explorer link instead of an error.
  return { txHash: lastTxHash, pending: true };
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
    contractAddress: input.contractAddress,
    functionSignature: input.abiFunctionSignature,
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
  const { challengeId } = await callProvider<{ challengeId: string }>({
    action: 'contractExecution',
    userToken: input.session.userToken,
    walletId: input.session.walletId,
    contractAddress: input.contractAddress,
    abiFunctionSignature: input.abiFunctionSignature,
    abiParameters: input.abiParameters,
    ...(input.amount ? { amount: input.amount } : {}),
    ...(input.refId ? { refId: input.refId } : {}),
  });

  if (!challengeId) {
    throw new Error('Circle did not return a challenge id.');
  }

  await executeChallenge(input.session, challengeId);
  const waitForConfirmation = input.waitForConfirmation ?? true;

  // Fast path: confirm from Arc directly when the caller can observe the on-chain effect.
  // Arc finalizes sub-second, so this flips the UI to success promptly instead of spinning
  // on Circle's transaction indexer (which can lag the chain by tens of seconds).
  if (waitForConfirmation && input.confirmOnchain) {
    const deadline = Date.now() + ONCHAIN_CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await input.confirmOnchain().catch(() => false)) {
        // Confirmed on Arc. Best-effort: fetch Circle's tx hash for the explorer link, but do
        // not block success on the indexer — an empty hash just means "no link yet".
        return await quickCircleTxHash(input.session, anchor).catch(() => '');
      }
      await new Promise((r) => setTimeout(r, ONCHAIN_CONFIRM_POLL_MS));
    }
    // Arc effect not observed in the budget — fall through to Circle's view, which still
    // detects real failures and the slow-indexer "pending" case.
  }

  let transactionId = '';
  try {
    transactionId = await findRecentTransactionId(
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
  const tx = await callProvider<CircleTransaction>({
    action: 'getTransaction',
    userToken: session.userToken,
    transactionId,
  });
  return tx.txHash ?? '';
}

async function findRecentTransactionId(session: CircleSession, anchorMs: number, timeoutMs = 30_000): Promise<string> {
  // Poll briefly: Circle may not have indexed the transaction the instant the challenge resolves.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await callProvider<{ transactions?: ListedTransaction[] }>({
      action: 'findTransactionByChallenge',
      userToken: session.userToken,
      walletId: session.walletId,
    });
    const candidates = (list.transactions ?? [])
      .filter((t) => t.id && t.createDate)
      .filter((t) => new Date(t.createDate!).getTime() >= anchorMs)
      .sort((a, b) => new Date(b.createDate!).getTime() - new Date(a.createDate!).getTime());
    if (candidates[0]?.id) return candidates[0].id;
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
    const factoryAddress = useMultiOutcome ? config.multiOutcomeFactoryAddress : config.factoryAddress;
    if (!factoryAddress || !isAddress(factoryAddress)) {
      throw new Error('Set NEXT_PUBLIC_MULTI_OUTCOME_MARKET_FACTORY_ADDRESS before launching poll markets.');
    }
    const txHash = await runContractExecution({
      session,
      contractAddress: factoryAddress,
      abiFunctionSignature: useMultiOutcome
        ? 'createMarket(address,uint256,string,uint8,uint8)'
        : 'createMarket(address,uint256,string,uint8)',
      // Every Circle abiParameter scalar must be a string. Numbers cause error code 2.
      abiParameters: useMultiOutcome ? [
        input.resolver,
        closeStamp.toString(),
        buildMarketMetadataURI({ ...input, outcomeOptions }),
        String(getMarketKind(input.type)),
        String(outcomeOptions.length),
      ] : [
        input.resolver,
        closeStamp.toString(),
        buildMarketMetadataURI({ ...input, outcomeOptions }),
        String(getMarketKind(input.type)),
      ],
      preview: {
        label: `Launch "${input.title.slice(0, 60)}${input.title.length > 60 ? '…' : ''}"`,
        action: `Deploys a new ${input.type} market via the Presto factory. The resolver address you picked will sign settlement.`,
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
        await runContractExecution({
          session,
          contractAddress: config.usdcAddress!,
          abiFunctionSignature: 'transfer(address,uint256)',
          abiParameters: [input.resolver, feeAmount.toString()],
          refId: `presto-resolve-fee-${Date.now()}`,
          preview: {
            label: `Fund automatic resolution - $${feeHuman} USDC`,
            action: `Funds the Presto agent to settle this market automatically after it closes. Sent directly to ${input.resolver.slice(0, 6)}...${input.resolver.slice(-4)}.`,
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
    const legs: Array<[string, string, string]> = [];
    if (funding.allowance < amountValue) {
      legs.push([
        usdcAddress,
        '0',
        encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [marketAddress, amountValue] }),
      ]);
    }
    legs.push([
      marketAddress,
      '0',
      encodeFunctionData({ abi: prestoMarketAbi, functionName: 'buy', args: [buyOutcomeIndex, amountValue] }),
    ]);

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

export async function resolveCircleMarket(input: { marketAddress: string; outcome: string; outcomeIndex?: number; resolutionURI: string }): Promise<LiveActionResult> {
  try {
    const session = await requireSession();
    if (!isAddress(input.marketAddress)) throw new Error('Market address is invalid.');
    const txHash = await runContractExecution({
      session,
      contractAddress: input.marketAddress,
      abiFunctionSignature: 'resolve(uint8,string)',
      abiParameters: [String(input.outcomeIndex ?? (input.outcome === 'YES' ? 0 : 1)), input.resolutionURI],
      waitForConfirmation: true,
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
    const txHash = await runContractExecution({
      session,
      contractAddress: marketAddress,
      abiFunctionSignature: signature,
      abiParameters: [],
      waitForConfirmation: true,
      confirmOnchain,
    });
    return { ok: true, message: `${label} via Circle wallet.`, txHash: txHash as `0x${string}` };
  } catch (error) {
    const pending = pendingResultFromError(error, label);
    if (pending) return pending;
    return { ok: false, message: error instanceof Error ? error.message : `${label} failed.` };
  }
}

// Claim and refund pay USDC out to the caller's own wallet, so we confirm directly from Arc
// the moment the wallet's USDC balance rises — the same fast-path used for buys — instead of
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
    const txHash = await runContractExecution({
      session,
      contractAddress: marketAddress,
      abiFunctionSignature: 'disputeResolution(string)',
      abiParameters: [reason],
      waitForConfirmation: true,
    });
    return { ok: true, message: 'Dispute submitted via Circle wallet — the resolver must now settle directly with evidence.', txHash: txHash as `0x${string}` };
  } catch (error) {
    const pending = pendingResultFromError(error, 'Dispute');
    if (pending) return pending;
    return { ok: false, message: error instanceof Error ? error.message : 'Dispute failed.' };
  }
}
