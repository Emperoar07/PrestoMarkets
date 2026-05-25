'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { WalletConnectButton } from './WalletConnectButton';
import { fetchArcStableBalances, type StableSymbol } from '@/lib/walletBalance';
import { getStoredConnectedWallet, subscribeConnectedWallet, type ConnectedWallet } from '@/lib/walletProvider';
import { primaryViewCategories, topicNavCategories } from '@/lib/categories';

const dexUrl = process.env.NEXT_PUBLIC_PRESTO_DEX_URL ?? 'https://prestodex-arc.vercel.app';

function navLinkClass(isActive = false) {
  return `rounded-lg border px-2 py-1 text-[13px] font-medium transition-all ${
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
  const isDocsPage = pathname === '/docs' || pathname === '/build-rails';
  const showSearchBar = !isLandingPage && !isDocsPage;
  // Category tab row only on the markets explorer itself — not market detail pages, not
  // portfolio/activity/create. Keeps secondary pages uncluttered.
  const showCategoryNav = pathname === '/markets';
  const isCreatePage = pathname === '/markets/create';

  const [searchValue, setSearchValue] = useState('');
  const [activeCategory, setActiveCategory] = useState('Trending');
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [balances, setBalances] = useState<Record<StableSymbol, string | null>>({ USDC: null, EURC: null });
  const [activeStable, setActiveStable] = useState<StableSymbol>('USDC');
  const [balanceMenuOpen, setBalanceMenuOpen] = useState(false);
  const balanceMenuRef = useRef<HTMLDivElement>(null);
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const loadBalances = useCallback(async () => {
    if (!connectedWallet?.address) {
      setBalances({ USDC: null, EURC: null });
      return;
    }

    try {
      setBalances(await fetchArcStableBalances(connectedWallet.address));
    } catch {
      setBalances({ USDC: null, EURC: null });
    }
  }, [connectedWallet?.address]);

  useEffect(() => {
    setSearchValue('');
  }, [pathname]);

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
    async function run() {
      if (!connectedWallet?.address) {
        setBalances({ USDC: null, EURC: null });
        return;
      }

      try {
        const nextBalances = await fetchArcStableBalances(connectedWallet.address);
        if (!cancelled) setBalances(nextBalances);
      } catch {
        if (!cancelled) setBalances({ USDC: null, EURC: null });
      }
    }

    void run();
    return () => { cancelled = true; };
  }, [connectedWallet?.address]);

  useEffect(() => {
    function handleBalanceRefresh() {
      void loadBalances();
    }
    window.addEventListener('presto:balances-refresh', handleBalanceRefresh);
    return () => window.removeEventListener('presto:balances-refresh', handleBalanceRefresh);
  }, [loadBalances]);

  useEffect(() => {
    if (!balanceMenuOpen) return undefined;
    function handleClickOutside(event: MouseEvent) {
      if (balanceMenuRef.current && !balanceMenuRef.current.contains(event.target as Node)) {
        setBalanceMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [balanceMenuOpen]);

  function updateExploreSearch(value: string) {
    setSearchValue(value);
    // Keep search in memory only so refresh returns to a clean explorer.
    if (pathname !== '/markets') {
      window.dispatchEvent(new Event('presto:navigate-start'));
      router.push('/markets');
    }
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
      window.dispatchEvent(new Event('presto:navigate-start'));
      router.push(target);
    }
    setSearchValue('');
    window.dispatchEvent(new CustomEvent('presto:market-search', { detail: '' }));
    window.dispatchEvent(new CustomEvent('presto:category-change', { detail: cat }));
  }

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.06] bg-[#090e1a]/90 backdrop-blur-xl">
      {/* Row 1: brand (left) · search (middle, fills gap) · nav (right) */}
      <div className="mx-auto flex min-h-[66px] max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 md:h-[66px] md:flex-nowrap md:gap-6 md:px-7 md:py-0">
        <div className="order-1 shrink-0">
          <BrandMark />
        </div>
        <div className="order-3 w-full justify-start md:order-2 md:flex md:flex-1">
          {showSearchBar ? (
            <input
              value={searchValue}
              onChange={(event) => updateExploreSearch(event.target.value)}
              placeholder="Search markets…"
              className="w-full rounded-lg border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-[13px] font-medium text-white outline-none transition-colors placeholder:text-[#334155] focus:border-cyan/40 md:max-w-[520px]"
            />
          ) : null}
        </div>
        <nav className="scrollbar-hide order-2 -mx-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 md:order-3 md:ml-auto md:flex-none md:shrink-0 md:gap-2 md:overflow-visible md:px-0">
          <Link href="/markets" className={navLinkClass(isExplorePage && !isCreatePage)}>
            Explore Markets
          </Link>
          {!isLandingPage ? (
            <Link href="/markets/create" className={navLinkClass(isCreatePage)}>
              Create Market
            </Link>
          ) : null}
          {!isLandingPage ? (
            <Link href="/activity" className={navLinkClass(pathname === '/activity')}>
              Activity
            </Link>
          ) : null}
          {!isLandingPage ? (
            <Link href="/portfolio" className={navLinkClass(pathname === '/portfolio')}>
              Portfolio
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
              className="rounded-lg border border-cyan/30 bg-cyan/10 px-2 py-1 text-[13px] font-bold text-cyan transition-colors hover:border-cyan/50 hover:bg-cyan/15"
            >
              Faucet
            </a>
          ) : null}
          {showWallet && connectedWallet ? (
            <div ref={balanceMenuRef} className="relative hidden md:block">
              <button
                type="button"
                onClick={() => setBalanceMenuOpen((open) => !open)}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-[#0d1520] px-2 py-1.5 text-[12px] font-black text-[#dbeafe] transition-colors hover:border-cyan/30"
              >
                <span className="text-[#4a5568]">{activeStable}</span>
                <span className={activeStable === 'EURC' ? 'text-blue-300' : 'text-cyan'}>{balances[activeStable] ?? '--'}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`text-[#4a5568] transition-transform ${balanceMenuOpen ? 'rotate-180' : ''}`}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {balanceMenuOpen ? (
                <div className="absolute right-0 top-[calc(100%+6px)] z-10 w-44 overflow-hidden rounded-lg border border-white/[0.06] bg-[#0d1520] shadow-xl shadow-black/40">
                  {(['USDC', 'EURC'] as const).map((sym) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => { setActiveStable(sym); setBalanceMenuOpen(false); }}
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-[12px] font-black transition-colors hover:bg-white/[0.04] ${activeStable === sym ? 'bg-white/[0.03]' : ''}`}
                    >
                      <span className="text-[#94a3b8]">{sym}</span>
                      <span className={sym === 'EURC' ? 'text-blue-300' : 'text-cyan'}>{balances[sym] ?? '--'}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {showWallet ? <WalletConnectButton /> : null}
        </nav>
      </div>

      {/* Row 2: category nav — only on the markets explorer */}
      {showCategoryNav ? (
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
