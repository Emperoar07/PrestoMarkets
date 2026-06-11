import { createBundlerClient, toWebAuthnAccount } from 'viem/account-abstraction';
import { createPublicClient, http, parseGwei, type Address, type CustomTransport, type Hex, type PublicClient } from 'viem';
import { arcTestnet } from 'viem/chains';
import {
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  WebAuthnMode,
} from '@circle-fin/modular-wallets-core';
import { getArcConfig } from './arcConfig';

const clientKey = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY?.trim() || '';
const clientUrl = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL?.trim() || '';
const placeholderValues = new Set(['', 'your_circle_client_key_here', 'your_circle_client_url_here']);
const credentialStorageKey = 'presto.circle.passkeyCredential';

type StoredCredential = {
  credentialId: string;
};

export type CirclePasskeyBundlerClient = {
  sendUserOperation: (args: {
    calls: Array<{ to: Hex; data: Hex; value?: bigint }>;
    paymaster: true;
  }) => Promise<Hex>;
  waitForUserOperationReceipt: (args: { hash: Hex }) => Promise<{ receipt: { transactionHash: Hex } }>;
  request: (args: { method: string }) => Promise<unknown>;
};

let passkeyTransportRef: CustomTransport | null = null;
let modularTransportRef: CustomTransport | null = null;
let circlePublicClientRef: PublicClient | null = null;
let directPublicClientRef: PublicClient | null = null;
let bundlerClientRef: CirclePasskeyBundlerClient | null = null;
let addressRef: Address | null = null;

export function isCirclePasskeyConfigured() {
  return !placeholderValues.has(clientKey) && !placeholderValues.has(clientUrl);
}

function assertCirclePasskeyConfigured() {
  if (!isCirclePasskeyConfigured()) {
    throw new Error('Passkey wallets need NEXT_PUBLIC_CIRCLE_CLIENT_KEY and NEXT_PUBLIC_CIRCLE_CLIENT_URL configured for this domain.');
  }
}

function getPasskeyTransport() {
  assertCirclePasskeyConfigured();
  if (!passkeyTransportRef) {
    passkeyTransportRef = toPasskeyTransport(clientUrl, clientKey);
  }
  return passkeyTransportRef;
}

function getModularTransport() {
  assertCirclePasskeyConfigured();
  if (!modularTransportRef) {
    modularTransportRef = toModularTransport(`${clientUrl}/arcTestnet`, clientKey);
  }
  return modularTransportRef;
}

function getCirclePublicClient() {
  assertCirclePasskeyConfigured();
  if (!circlePublicClientRef) {
    circlePublicClientRef = createPublicClient({
      chain: arcTestnet,
      transport: getModularTransport(),
    });
  }
  return circlePublicClientRef;
}

function getDirectPublicClient() {
  if (!directPublicClientRef) {
    directPublicClientRef = createPublicClient({
      chain: arcTestnet,
      transport: http(getArcConfig().rpcUrl || 'https://rpc.testnet.arc.network'),
    });
  }
  return directPublicClientRef;
}

const minPriorityFee = parseGwei('1');
const fallbackBaseFee = parseGwei('48');

async function estimateUserOpFees(input: {
  bundlerClient: unknown;
}): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const fees = await (input.bundlerClient as { request: (args: { method: string }) => Promise<unknown> })
    .request({ method: 'pimlico_getUserOperationGasPrice' })
    .catch(() => null) as {
      fast?: { maxFeePerGas: string; maxPriorityFeePerGas: string };
      standard?: { maxFeePerGas: string; maxPriorityFeePerGas: string };
      slow?: { maxFeePerGas: string; maxPriorityFeePerGas: string };
    } | null;

  const tier = fees?.fast ?? fees?.standard ?? fees?.slow;
  if (tier) {
    const priority = BigInt(tier.maxPriorityFeePerGas);
    return {
      maxFeePerGas: BigInt(tier.maxFeePerGas),
      maxPriorityFeePerGas: priority < minPriorityFee ? minPriorityFee : priority,
    };
  }

  const block = await getDirectPublicClient().getBlock();
  const baseFee = block.baseFeePerGas ?? fallbackBaseFee;
  return {
    maxFeePerGas: baseFee * BigInt(2) + minPriorityFee,
    maxPriorityFeePerGas: minPriorityFee,
  };
}

async function initializePasskeyAccount(credential: Awaited<ReturnType<typeof toWebAuthnCredential>>) {
  const smartAccount = await toCircleSmartAccount({
    client: getCirclePublicClient(),
    owner: toWebAuthnAccount({ credential }),
  });

  const bundlerClient = createBundlerClient({
    account: smartAccount,
    chain: arcTestnet,
    transport: getModularTransport(),
    paymaster: true,
    userOperation: {
      estimateFeesPerGas: estimateUserOpFees,
    },
  });

  addressRef = smartAccount.address;
  bundlerClientRef = bundlerClient as unknown as CirclePasskeyBundlerClient;

  return smartAccount.address;
}

function readStoredCredential(): StoredCredential | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(credentialStorageKey);
    return raw ? JSON.parse(raw) as StoredCredential : null;
  } catch {
    return null;
  }
}

function writeStoredCredential(credentialId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(credentialStorageKey, JSON.stringify({ credentialId }));
}

export async function connectCirclePasskeyWallet(): Promise<{ address: Address }> {
  assertCirclePasskeyConfigured();

  let credential: Awaited<ReturnType<typeof toWebAuthnCredential>>;
  try {
    credential = await toWebAuthnCredential({
      transport: getPasskeyTransport(),
      mode: WebAuthnMode.Login,
    });
  } catch {
    credential = await toWebAuthnCredential({
      transport: getPasskeyTransport(),
      mode: WebAuthnMode.Register,
      username: `presto-${crypto.randomUUID().slice(0, 8)}`,
    });
  }

  const address = await initializePasskeyAccount(credential);
  writeStoredCredential(credential.id);
  return { address };
}

export async function restoreCirclePasskeyWallet(): Promise<{ address: Address } | null> {
  if (!isCirclePasskeyConfigured()) return null;
  const stored = readStoredCredential();
  if (!stored?.credentialId) return null;

  try {
    const credential = await toWebAuthnCredential({
      transport: getPasskeyTransport(),
      mode: WebAuthnMode.Login,
      credentialId: stored.credentialId,
    });
    const address = await initializePasskeyAccount(credential);
    return { address };
  } catch {
    clearCirclePasskeyWallet();
    return null;
  }
}

export function getCirclePasskeyBundlerClient() {
  if (!bundlerClientRef || !addressRef) {
    throw new Error('Passkey wallet is not connected. Sign in with passkey again.');
  }
  return { address: addressRef, bundlerClient: bundlerClientRef };
}

export function clearCirclePasskeyWallet() {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(credentialStorageKey);
  }
  addressRef = null;
  bundlerClientRef = null;
}
