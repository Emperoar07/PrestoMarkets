export type WalletProviderMode = 'circle-user-controlled' | 'external-eoa';

export type ConnectedWallet = {
  address: string;
  mode: WalletProviderMode;
  walletId?: string;
  userId?: string;
};

const ARC_CHAIN_HEX = '0x4cef52';

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
    return null;
  }

  const accounts = await window.ethereum.request({ method: 'eth_accounts' }) as string[];
  const [address] = accounts;

  return address ? { address, mode: 'external-eoa' } : null;
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
}

export async function connectOfficialWalletProvider(): Promise<ConnectedWallet> {
  const circleWallet = await connectCircleUserControlledWalletProvider();
  if (circleWallet) {
    return circleWallet;
  }

  return connectExternalWalletProvider();
}

async function connectCircleUserControlledWalletProvider(): Promise<ConnectedWallet | null> {
  const enabled = process.env.NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED === 'true';

  if (!enabled) {
    return null;
  }

  const userId = window.prompt('Enter your Presto Circle wallet email or user ID.');

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
