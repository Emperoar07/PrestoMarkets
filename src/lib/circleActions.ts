import { isAddress, parseUnits } from 'viem';
import { getArcConfig } from './arcConfig';
import { buildMarketMetadataURI } from './marketMetadata';
import { getCircleSession, type CircleSession } from './walletProvider';
import { requestCircleConfirmation, type CircleConfirmDetails } from './circleConfirm';
import type { CreateLiveMarketInput, LiveActionResult } from './liveActions';
import type { MarketType } from './markets';

const ARC_EXPLORER_ADDRESS = 'https://testnet.arcscan.app/address/';

const MIN_TRADE_USDC = 0.01;
const TX_POLL_INTERVAL_MS = 2_000;
const TX_POLL_TIMEOUT_MS = 120_000;

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

async function callProvider<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/circle/wallet/provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as { error?: string } | T | null;
  if (!response.ok) {
    const err = (data as { error?: string } | null)?.error || 'Circle wallet request failed.';
    throw new Error(err);
  }
  return data as T;
}

async function executeChallenge(session: CircleSession, challengeId: string): Promise<void> {
  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');
  const sdk = new W3SSdk({
    appSettings: { appId: session.appId },
  });

  // Circle's Web SDK needs a device session before challenge execution, and the
  // auth pair must be applied to the SDK instance that runs this challenge.
  await sdk.getDeviceId();
  sdk.setAuthentication({
    userToken: session.userToken,
    encryptionKey: session.encryptionKey,
  });

  await new Promise<void>((resolve, reject) => {
    sdk.execute(challengeId, (error) => {
      if (error) {
        reject(new Error(error.message || 'Circle PIN/biometric challenge failed.'));
        return;
      }
      resolve();
    });
  });
}

async function waitForTx(session: CircleSession, transactionId: string): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < TX_POLL_TIMEOUT_MS) {
    const tx = await callProvider<CircleTransaction>({
      action: 'getTransaction',
      userToken: session.userToken,
      transactionId,
    });
    if (tx.state === 'CONFIRMED' || tx.state === 'COMPLETE') {
      return tx.txHash ?? '';
    }
    if (tx.state === 'FAILED' || tx.state === 'CANCELLED' || tx.state === 'DENIED') {
      throw new Error(`Circle transaction ${tx.state.toLowerCase()}: ${tx.errorReason ?? 'no reason given'}`);
    }
    await new Promise((r) => setTimeout(r, TX_POLL_INTERVAL_MS));
  }
  throw new Error('Circle transaction timed out waiting for confirmation.');
}

async function runContractExecution(input: {
  session: CircleSession;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: unknown[];
  amount?: string;
  refId?: string;
  preview?: Partial<CircleConfirmDetails>;
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
  const transactionId = await findRecentTransactionId(input.session, anchor);
  return waitForTx(input.session, transactionId);
}

type ListedTransaction = {
  id: string;
  createDate?: string;
  walletId?: string;
  state?: string;
};

async function findRecentTransactionId(session: CircleSession, anchorMs: number): Promise<string> {
  // Poll briefly: Circle may not have indexed the transaction the instant the challenge resolves.
  const deadline = Date.now() + 30_000;
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

function requireSession(): CircleSession {
  const session = getCircleSession();
  if (!session) {
    throw new Error('Circle wallet session expired — sign in again.');
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

function getMarketKind(type: MarketType): number {
  if (type === 'Opinion') return 1;
  if (type === 'Opportunity') return 2;
  return 0;
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
    const session = requireSession();
    const config = requireArcConfig();
    if (!isAddress(input.resolver)) {
      throw new Error('Resolver must be a valid wallet address.');
    }
    const txHash = await runContractExecution({
      session,
      contractAddress: config.factoryAddress!,
      abiFunctionSignature: 'createMarket(address,uint256,string,uint8)',
      // Every Circle abiParameter scalar must be a string. Numbers cause error code 2.
      abiParameters: [
        input.resolver,
        getCloseTimestamp(input.closeDate).toString(),
        buildMarketMetadataURI(input),
        String(getMarketKind(input.type)),
      ],
    });
    return { ok: true, message: 'Live market created via Circle wallet.', txHash: txHash as `0x${string}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Market creation failed.' };
  }
}

export async function buyCircleShares(input: { marketAddress: string; outcome: 'YES' | 'NO'; amount: number }): Promise<LiveActionResult> {
  try {
    const session = requireSession();
    const config = requireArcConfig();
    if (!isAddress(input.marketAddress)) throw new Error('Market address is invalid.');
    if (!Number.isFinite(input.amount) || input.amount < MIN_TRADE_USDC) {
      throw new Error(`Minimum trade is $${MIN_TRADE_USDC} USDC.`);
    }
    const amount = parseUnits(String(input.amount), 6).toString();

    await runContractExecution({
      session,
      contractAddress: config.usdcAddress!,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [input.marketAddress, amount],
      refId: `presto-approve-${input.marketAddress}`,
    });

    const txHash = await runContractExecution({
      session,
      contractAddress: input.marketAddress,
      abiFunctionSignature: 'buy(uint8,uint256)',
      abiParameters: [input.outcome === 'YES' ? '0' : '1', amount],
      refId: `presto-buy-${input.marketAddress}`,
    });
    return { ok: true, message: `Bought ${input.outcome} shares via Circle wallet.`, txHash: txHash as `0x${string}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Buy transaction failed.' };
  }
}

export async function resolveCircleMarket(input: { marketAddress: string; outcome: 'YES' | 'NO'; resolutionURI: string }): Promise<LiveActionResult> {
  try {
    const session = requireSession();
    if (!isAddress(input.marketAddress)) throw new Error('Market address is invalid.');
    const txHash = await runContractExecution({
      session,
      contractAddress: input.marketAddress,
      abiFunctionSignature: 'resolve(uint8,string)',
      abiParameters: [input.outcome === 'YES' ? '0' : '1', input.resolutionURI],
    });
    return { ok: true, message: 'Market resolved via Circle wallet.', txHash: txHash as `0x${string}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Resolve transaction failed.' };
  }
}

async function noArgAction(marketAddress: string, signature: string, label: string): Promise<LiveActionResult> {
  try {
    const session = requireSession();
    if (!isAddress(marketAddress)) throw new Error('Market address is invalid.');
    const txHash = await runContractExecution({
      session,
      contractAddress: marketAddress,
      abiFunctionSignature: signature,
      abiParameters: [],
    });
    return { ok: true, message: `${label} via Circle wallet.`, txHash: txHash as `0x${string}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : `${label} failed.` };
  }
}

export const cancelCircleMarket = (m: string) => noArgAction(m, 'cancel()', 'Market canceled');
export const claimCircleMarket = (m: string) => noArgAction(m, 'claim()', 'Claim submitted');
export const refundCircleMarket = (m: string) => noArgAction(m, 'refund()', 'Refund submitted');
