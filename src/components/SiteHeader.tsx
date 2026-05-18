'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { WalletConnectButton } from './WalletConnectButton';
import { fetchArcUsdcBalance } from '@/lib/walletBalance';
import { getStoredConnectedWallet, subscribeConnectedWallet, type ConnectedWallet } from '@/lib/walletProvider';

const dexUrl = process.env.NEXT_PUBLIC_PRESTO_DEX_URL ?? 'https://prestodex-arc.vercel.app';

function navLinkClass(isActive = false) {
  return `rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all ${
    isActive
      ? 'border-cyan/35 bg-cyan/10 text-cyan'
      : 'border-transparent text-[#94a3b8] hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-[#f1f5f9]'
  }`;
}

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const isLandingPage = pathname === '/';
  const showWallet = !isLandingPage;
  const isExplorePage = pathname === '/markets' || pathname.startsWith('/markets/');
  const showExploreSearch = pathname === '/markets';
  const isCreatePage = pathname === '/markets/create';
  const [searchValue, setSearchValue] = useState('');
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!showExploreSearch || typeof window === 'undefined') {
      setSearchValue('');
      return;
    }

    setSearchValue(new URLSearchParams(window.location.search).get('q') ?? '');
  }, [showExploreSearch]);

  useEffect(() => {
    setConnectedWallet(getStoredConnectedWallet());
    return subscribeConnectedWallet(setConnectedWallet);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!connectedWallet?.address) {
      setUsdcBalance(null);
      return undefined;
    }

    fetchArcUsdcBalance(connectedWallet.address)
      .then((balance) => {
        if (!cancelled) setUsdcBalance(balance);
      })
      .catch(() => {
        if (!cancelled) setUsdcBalance(null);
      });

    return () => {
      cancelled = true;
    };
  }, [connectedWallet?.address]);

  function updateExploreSearch(value: string) {
    setSearchValue(value);

    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');

    if (value) {
      params.set('q', value);
    } else {
      params.delete('q');
    }

    router.replace(`/markets${params.toString() ? `?${params.toString()}` : ''}`, { scroll: false });
    window.dispatchEvent(new CustomEvent('presto:market-search', { detail: value }));
  }

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.06] bg-[#090e1a]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[66px] max-w-[1400px] items-center gap-3 px-4 md:px-7">
        <BrandMark />
        {/* Search — sits right next to the logo, grows to fill available space */}
        {showExploreSearch ? (
          <input
            value={searchValue}
            onChange={(event) => updateExploreSearch(event.target.value)}
            placeholder="Search markets…"
            className="hidden max-w-[340px] flex-1 rounded-lg border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-[13px] font-medium text-white outline-none transition-colors placeholder:text-[#334155] focus:border-cyan/40 md:block"
          />
        ) : null}
        {showWallet && connectedWallet ? (
          <div className="hidden rounded-lg border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-[12px] font-black text-[#dbeafe] md:block">
            <span className="text-[#4a5568]">Arc USDC</span>{' '}
            <span className="text-cyan">{usdcBalance ?? '--'}</span>
          </div>
        ) : null}
        <nav className="ml-auto flex items-center gap-3">
          <Link href="/markets" className={navLinkClass(isExplorePage && !isCreatePage)}>
            Explore Markets
          </Link>
          {!isLandingPage ? (
            <Link href="/markets/create" className={navLinkClass(isCreatePage)}>
              Create Market
            </Link>
          ) : null}
          <a href={dexUrl} className={navLinkClass()}>
            DEX
          </a>
          {showWallet ? (
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-cyan/30 bg-cyan/10 px-3 py-1.5 text-[13px] font-bold text-cyan transition-colors hover:border-cyan/50 hover:bg-cyan/15"
            >
              Faucet
            </a>
          ) : null}
          {showWallet ? <WalletConnectButton /> : null}
        </nav>
      </div>
    </header>
  );
}
