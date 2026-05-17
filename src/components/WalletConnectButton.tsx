'use client';

import { useEffect, useState } from 'react';
import {
  connectOfficialWalletProvider,
  getExistingExternalWallet,
  shortAddress,
  type ConnectedWallet,
} from '@/lib/walletProvider';

export function WalletConnectButton() {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    getExistingExternalWallet()
      .then(setWallet)
      .catch(() => undefined);
  }, []);

  async function connectWallet() {
    setStatus('Connecting...');

    try {
      setWallet(await connectOfficialWalletProvider());
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Wallet connection failed.');
    }
  }

  if (wallet) {
    return (
      <button type="button" className="rounded-lg border border-white/10 px-[14px] py-2 text-[13px] font-bold text-[#f1f5f9]">
        {wallet.mode === 'circle-user-controlled' ? 'Circle ' : ''}{shortAddress(wallet.address)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void connectWallet()}
      title={status || 'Connect with Circle User-Controlled Wallets'}
      className="rounded-lg bg-[#25c0f4] px-[18px] py-2 text-[13px] font-bold text-[#090e1a] transition-opacity hover:opacity-90"
    >
      {status === 'Connecting...' ? 'Connecting...' : 'Connect Circle Wallet'}
    </button>
  );
}
