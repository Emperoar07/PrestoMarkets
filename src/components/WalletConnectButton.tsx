'use client';

import { useEffect, useState } from 'react';

const ARC_CHAIN_ID = 5042002;
const ARC_CHAIN_HEX = '0x4cef52';

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function shortAddress(address: string) {
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

export function WalletConnectButton() {
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!window.ethereum) {
      return;
    }

    window.ethereum.request({ method: 'eth_accounts' })
      .then((accounts) => {
        const [account] = accounts as string[];
        if (account) setAddress(account);
      })
      .catch(() => undefined);
  }, []);

  async function connectWeb3() {
    if (!window.ethereum) {
      setStatus('Install a wallet or enable Circle Wallets.');
      return;
    }

    setStatus('Connecting wallet...');
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
    await ensureArc(window.ethereum);
    setAddress(accounts[0] ?? '');
    setStatus('');
  }

  if (address) {
    return (
      <button type="button" className="rounded-lg border border-white/10 px-[14px] py-2 text-[13px] font-bold text-[#f1f5f9]">
        {shortAddress(address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void connectWeb3()}
      title={status || 'Connect an Arc-compatible wallet'}
      className="rounded-lg bg-[#25c0f4] px-[18px] py-2 text-[13px] font-bold text-[#090e1a] transition-opacity hover:opacity-90"
    >
      {status ? 'Connecting...' : 'Connect Wallet'}
    </button>
  );
}
