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
  const circleEnabled = process.env.NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED === 'true';

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

  function connectCircle() {
    setStatus(circleEnabled
      ? 'Circle embedded wallet requires the server-side user-token/session flow before activation.'
      : 'Set NEXT_PUBLIC_CIRCLE_WALLETS_ENABLED=true after Circle Wallets session endpoints are configured.');
  }

  if (address) {
    return (
      <button type="button" className="rounded-lg border border-white/10 px-[14px] py-2 text-[13px] font-bold text-[#f1f5f9]">
        {shortAddress(address)}
      </button>
    );
  }

  return (
    <div className="group relative">
      <button type="button" className="rounded-lg bg-[#25c0f4] px-[18px] py-2 text-[13px] font-bold text-[#090e1a] transition-opacity hover:opacity-90">
        Connect Wallet
      </button>
      <div className="invisible absolute right-0 top-11 z-50 w-56 rounded-[14px] border border-white/[0.08] bg-[#141e30] p-2 opacity-0 shadow-2xl transition-all group-hover:visible group-hover:opacity-100">
        <button type="button" onClick={() => void connectWeb3()} className="w-full rounded-[10px] px-3 py-2 text-left text-[13px] font-bold text-[#f1f5f9] hover:bg-white/[0.04]">
          Web3 wallet
        </button>
        <button type="button" onClick={connectCircle} className="w-full rounded-[10px] px-3 py-2 text-left text-[13px] font-bold text-[#94a3b8] hover:bg-white/[0.04]">
          Circle Web2 wallet
        </button>
        {status ? <p className="px-3 py-2 text-[11px] leading-5 text-[#94a3b8]">{status}</p> : null}
      </div>
    </div>
  );
}
