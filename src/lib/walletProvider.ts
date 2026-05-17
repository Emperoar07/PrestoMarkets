export type WalletProviderMode = 'circle-user-controlled' | 'external-eoa';

export type ConnectedWallet = {
  address: string;
  mode: WalletProviderMode;
  walletId?: string;
  userId?: string;
};

const ARC_CHAIN_HEX = '0x4cef52';
const connectedWalletStorageKey = 'presto.connectedWallet';
const connectedWalletEventName = 'presto:wallet';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getStoredConnectedWallet(): ConnectedWallet | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(connectedWalletStorageKey);
    return stored ? JSON.parse(stored) as ConnectedWallet : null;
  } catch {
    return null;
  }
}

export function setStoredConnectedWallet(wallet: ConnectedWallet | null) {
  if (typeof window === 'undefined') return;

  if (wallet) {
    window.localStorage.setItem(connectedWalletStorageKey, JSON.stringify(wallet));
  } else {
    window.localStorage.removeItem(connectedWalletStorageKey);
  }

  window.dispatchEvent(new CustomEvent<ConnectedWallet | null>(connectedWalletEventName, { detail: wallet }));
}

export function subscribeConnectedWallet(listener: (wallet: ConnectedWallet | null) => void) {
  function handleWalletEvent(event: Event) {
    listener((event as CustomEvent<ConnectedWallet | null>).detail);
  }

  window.addEventListener(connectedWalletEventName, handleWalletEvent);
  return () => window.removeEventListener(connectedWalletEventName, handleWalletEvent);
}

async function ensureArc(provider: EthereumProvider) {
  const chainId = await provider.request({ method: 'eth_chainId' });

  if (chainId === ARC_CHAIN_HEX) {
    return;
  }

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_CHAIN_HEX }],
    });
  } catch {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: ARC_CHAIN_HEX,
        chainName: 'Arc Testnet',
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
        rpcUrls: [process.env.NEXT_PUBLIC_ARC_RPC_URL || 'https://rpc.testnet.arc.network'],
      }],
    });
  }
}

export async function getExistingExternalWallet(): Promise<ConnectedWallet | null> {
  if (!window.ethereum) {
    return getStoredConnectedWallet();
  }

  const accounts = await window.ethereum.request({ method: 'eth_accounts' }) as string[];
  const [address] = accounts;

  return address ? { address, mode: 'external-eoa' } : getStoredConnectedWallet();
}

export async function disconnectExternalWallet() {
  if (!window.ethereum) {
    return;
  }

  try {
    await window.ethereum.request({
      method: 'wallet_revokePermissions',
      params: [{ eth_accounts: {} }],
    });
  } catch {
    // Some injected wallets do not expose programmatic disconnect.
  }

  setStoredConnectedWallet(null);
}

export async function connectOfficialWalletProvider(input?: { userId?: string }): Promise<ConnectedWallet> {
  const circleWallet = await connectCircleUserControlledWalletProvider(input);
  if (circleWallet) {
    setStoredConnectedWallet(circleWallet);
    return circleWallet;
  }

  const externalWallet = await connectExternalWalletProvider();
  setStoredConnectedWallet(externalWallet);
  return externalWallet;
}

async function connectCircleUserControlledWalletProvider(input?: { userId?: string }): Promise<ConnectedWallet | null> {
  const enabled = process.env.NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED === 'true';

  if (!enabled) {
    return null;
  }

  const userId = input?.userId?.trim();

  if (!userId) {
    return null;
  }

  const config = await callCircleWalletProvider<{ appId: string; blockchain: string; accountType: string }>({ action: 'config' });
  await callCircleWalletProvider({ action: 'createUser', userId });
  const session = await callCircleWalletProvider<{ userToken: string; encryptionKey: string }>({ action: 'session', userId });
  let wallet = await getFirstCircleWallet(session.userToken, config.blockchain);

  if (!wallet) {
    const challenge = await callCircleWalletProvider<{ challengeId: string }>({
      action: 'initialize',
      userToken: session.userToken,
    });

    await executeCircleChallenge({
      appId: config.appId,
      userToken: session.userToken,
      encryptionKey: session.encryptionKey,
      challengeId: challenge.challengeId,
    });
    wallet = await getFirstCircleWallet(session.userToken, config.blockchain);
  }

  if (!wallet?.address) {
    throw new Error('Circle User-Controlled Wallets did not return an Arc wallet address.');
  }

  return {
    address: wallet.address,
    walletId: wallet.id,
    userId,
    mode: 'circle-user-controlled',
  };
}

async function callCircleWalletProvider<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/circle/wallet/provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as { error?: string } | T | null;

  if (!response.ok) {
    throw new Error((data as { error?: string } | null)?.error || 'Circle User-Controlled Wallet provider failed.');
  }

  return data as T;
}

async function getFirstCircleWallet(userToken: string, blockchain: string) {
  const data = await callCircleWalletProvider<{ wallets?: Array<{ id: string; address: string; blockchain?: string }> }>({
    action: 'wallets',
    userToken,
  });
  const wallets = data.wallets || [];

  return wallets.find((wallet) => wallet.blockchain === blockchain) || wallets[0] || null;
}

async function executeCircleChallenge(input: {
  appId: string;
  userToken: string;
  encryptionKey: string;
  challengeId: string;
}) {
  const { W3SSdk } = await import('@circle-fin/w3s-pw-web-sdk');
  const sdk = new W3SSdk({
    appSettings: { appId: input.appId },
    authentication: {
      userToken: input.userToken,
      encryptionKey: input.encryptionKey,
    },
  });

  await new Promise<void>((resolve, reject) => {
    sdk.execute(input.challengeId, (error) => {
      if (error) {
        reject(new Error(error.message || 'Circle wallet challenge failed.'));
        return;
      }

      resolve();
    });
  });
}

async function connectExternalWalletProvider(): Promise<ConnectedWallet> {
  if (!window.ethereum) {
    throw new Error('Circle User-Controlled Wallets are not configured and no browser wallet was found.');
  }

  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
  const [address] = accounts;

  if (!address) {
    throw new Error('No wallet account was returned.');
  }

  await ensureArc(window.ethereum);

  return { address, mode: 'external-eoa' };
}
