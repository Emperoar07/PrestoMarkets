'use client';

import { createPortal } from 'react-dom';
import { X, Mail, ShieldAlert, WifiOff, FileCode } from 'lucide-react';
import { useEffect } from 'react';

interface RecoveryHelpModalProps {
  onClose: () => void;
}

export function RecoveryHelpModal({ onClose }: RecoveryHelpModalProps) {
  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const modalContent = (
    <div
      className="fixed inset-0 z-[10000] grid place-items-center overflow-y-auto bg-[#050b14]/85 px-4 py-8 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Account Recovery & Help Guide"
    >
      {/* Background click to close */}
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative my-auto w-full max-w-[560px] rounded-2xl border border-white/[0.08] bg-[#0b1322] p-6 md:p-8 shadow-2xl shadow-black/80 z-10">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.02] text-[#94a3b8] transition hover:bg-white/[0.06] hover:text-white"
          aria-label="Close recovery modal"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2.5 mb-6">
          <ShieldAlert className="h-6 w-6 text-cyan" />
          <h2 className="text-xl font-black text-white leading-none">
            Trouble Signing In & Recovery
          </h2>
        </div>

        {/* Content Sections */}
        <div className="space-y-6 text-[#94a3b8] text-xs leading-relaxed">
          {/* Section 1: Circle PIN / Email Wallet */}
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                <Mail className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-[13px] font-black text-white mb-1">
                  Circle Smart Accounts (Email / PIN)
                </h3>
                <p className="mb-2">
                  Presto use Circle's non-custodial user-controlled wallets:
                </p>
                <ul className="list-disc pl-4 space-y-1.5">
                  <li>
                    <strong>Forgot PIN:</strong> During the next sign-in, when prompted for your PIN, click the <em>"Forgot PIN"</em> link to initiate a secure recovery via your registered email address.
                  </li>
                  <li>
                    <strong>Lost Device / Passkey:</strong> If you lost your authenticator device or your email verification access, contact support for account review and manual recovery options.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Section 2: External Web3 Network Settings */}
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-500">
                <WifiOff className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-[13px] font-black text-white mb-1">
                  External Web3 Wallets (MetaMask, Base, Safe)
                </h3>
                <p className="mb-2">
                  If your browser wallet is failing to connect or display correctly:
                </p>
                <ul className="list-disc pl-4 space-y-1.5">
                  <li>
                    Verify that your wallet's network is switched to <strong>Arc Testnet</strong> or <strong>Base Sepolia</strong>.
                  </li>
                  <li>
                    Check your RPC settings and ensure you have correct network configurations set up.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Section 3: Testnet Limitations */}
          <div className="rounded-xl border border-cyan/10 bg-cyan/[0.02] p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan/15 text-cyan">
                <FileCode className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-[13px] font-black text-white mb-1">
                  Testnet Limitations & Value Warning
                </h3>
                <p>
                  Presto Markets currently operates entirely on the **Arc Testnet**. Testnet USDC is a mock test token and has **no real-world monetary value**. Testnet funds are not insured, cannot be redeemed for fiat or mainnet cryptocurrencies, and are purely for sandbox validation.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-white/[0.06] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white px-4 py-2 text-xs font-bold transition-all"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
