'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { WalletConnectButton } from './WalletConnectButton';
import { fetchArcUsdcBalance } from '@/lib/walletBalance';
import { getStoredConnectedWallet, subscribeConnectedWallet, type ConnectedWallet } from '@/lib/walletProvider';
import { primaryViewCategories, topicNavCategories } from '@/lib/categories';

const dexUrl = process.env.NEXT_PUBLIC_PRESTO_DEX_URL ?? 'https://prestodex-arc.vercel.app';

function navLinkClass(isActive = false) {
  return `rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all ${
    isActive
      ? 'border-cyan/35 bg-cyan/10 text-cyan'
      : 'border-transparent text-[#94a3b8] hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-[#f1f5f9]'
  }`;
}

const allNavCategories = [...primaryViewCategories, ...topicNavCategories] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const isLandingPage = pathname === '/';
  const showWallet = !isLandingPage;
  const isExplorePage = pathname === '/markets' || pathname.startsWith('/markets/');
  const showExploreSearch = pathname === '/markets';
  const isCreatePage = pathname === '/markets/create';

  const [searchValue, setSearchValue] = useState('');
  const [activeCategory, setActiveCategory] = useState('Trending');
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const categoryScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showExploreSearch || typeof window === 'undefined') {
      setSearchValue('');
      return;
    }
    setSearchValue(new URLSearchParams(window.location.search).get('q') ?? '');
  }, [showExploreSearch]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const cat = new URLSearchParams(window.location.search).get('cat') ?? 'Trending';
    setActiveCategory(cat);
  }, [pathname]);

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
      .then((balance) => { if (!cancelled) setUsdcBalance(balance); })
      .catch(() => { if (!cancelled) setUsdcBalance(null); });
    return () => { cancelled = true; };
  }, [connectedWallet?.address]);

  function updateExploreSearch(value: string) {
    setSearchValue(value);
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    if (value) { params.set('q', value); } else { params.delete('q'); }
    router.replace(`/markets${params.toString() ? `?${params.toString()}` : ''}`, { scroll: false });
    window.dispatchEvent(new CustomEvent('presto:market-search', { detail: value }));
  }

  function selectCategory(cat: string) {
    setActiveCategory(cat);
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    params.set('cat', cat);
    params.delete('q');
    const target = `/markets?${params.toString()}`;
    if (pathname === '/markets') {
      router.replace(target, { scroll: false });
    } else {
      router.push(target);
    }
    window.dispatchEvent(new CustomEvent('presto:category-change', { detail: cat }));
  }

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.06] bg-[#090e1a]/90 backdrop-blur-xl">
      {/* Row 1: logo + search + nav */}
      <div className="mx-auto flex h-[66px] max-w-[1400px] items-center gap-3 px-4 md:px-7">
        <BrandMark />
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

      {/* Row 2: category nav — shown on all non-landing pages */}
      {!isLandingPage ? (
        <div className="border-t border-white/[0.04]">
          <div className="mx-auto max-w-[1400px] px-4 md:px-7">
            <div ref={categoryScrollRef} className="scrollbar-hide overflow-x-auto">
              <div className="flex items-center">
                {primaryViewCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => selectCategory(cat)}
                    className={`flex min-w-fit items-center gap-1.5 px-4 py-3 text-[13px] font-bold transition-colors ${
                      activeCategory === cat
                        ? 'border-b-2 border-cyan text-white'
                        : 'text-[#4a5568] hover:text-[#94a3b8]'
                    }`}
                  >
                    {cat === 'Trending' ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                        <polyline points="17 6 23 6 23 12" />
                      </svg>
                    ) : cat === 'Breaking' ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    ) : null}
                    {cat}
                  </button>
                ))}

                <div className="mx-1 h-4 w-px shrink-0 bg-white/[0.1]" />

                {topicNavCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => selectCategory(cat)}
                    className={`min-w-fit px-4 py-3 text-[13px] font-bold transition-colors ${
                      activeCategory === cat
                        ? 'border-b-2 border-cyan text-white'
                        : 'text-[#4a5568] hover:text-[#94a3b8]'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
