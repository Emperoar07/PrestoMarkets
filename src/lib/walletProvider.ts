export type WalletProviderMode = 'circle-user-controlled' | 'external-eoa';

export type ConnectedWallet = {
  address: string;
  mode: WalletProviderMode;
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

  const response = await fetch('/api/circle/wallet/provider', { method: 'POST' });

  if (response.status === 404 || response.status === 501) {
    return null;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || 'Circle User-Controlled Wallet provider failed.');
  }

  const wallet = await response.json() as { address?: string };

  if (!wallet.address) {
    throw new Error('Circle User-Controlled Wallet provider did not return an address.');
  }

  return { address: wallet.address, mode: 'circle-user-controlled' };
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
