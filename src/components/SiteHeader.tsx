'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { WalletConnectButton } from './WalletConnectButton';
import { fetchArcStableBalances, type StableSymbol } from '@/lib/walletBalance';
import { getStoredConnectedWallet, subscribeConnectedWallet, type ConnectedWallet } from '@/lib/walletProvider';
import { primaryViewCategories, topicNavCategories } from '@/lib/categories';

const dexUrl = process.env.NEXT_PUBLIC_PRESTO_DEX_URL?.trim() || 'https://prestodex-arc.vercel.app';

function navLinkClass(isActive = false) {
  return `rounded-lg border px-2 py-1 text-[13px] font-medium transition-all ${
    isActive
      ? 'border-cyan/35 bg-cyan/10 text-cyan'
      : 'border-transparent text-[#94a3b8] hover:border-white/[0.06] hover:bg-white/[0.04] hover:text-[#f1f5f9]'
  }`;
}

function mobileNavLinkClass(isActive = false) {
  return `flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold transition-all ${
    isActive
      ? 'bg-cyan/10 text-cyan'
      : 'text-[#94a3b8] active:bg-white/[0.04]'
  }`;
}



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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    setMobileMenuOpen(false);
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

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

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
      {/* ── Mobile top bar (< md) ── */}
      <div className="flex h-14 items-center gap-2 px-3 md:hidden">
        <div className="shrink-0">
          <BrandMark />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {showWallet ? (
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-cyan/30 bg-cyan/10 px-2 py-1 text-[11px] font-bold text-cyan transition-colors hover:border-cyan/50 hover:bg-cyan/15"
            >
              Faucet
            </a>
          ) : null}
          {showWallet ? <WalletConnectButton /> : null}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[#94a3b8] transition-colors hover:border-white/15 hover:text-white"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileMenuOpen ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Mobile search bar — always visible (< md) ── */}
      {showSearchBar ? (
        <div className="px-3 pb-2 md:hidden">
          <input
            value={searchValue}
            onChange={(event) => updateExploreSearch(event.target.value)}
            placeholder="Search markets…"
            className="w-full rounded-xl border border-white/[0.06] bg-[#0d1520] px-3.5 py-2 text-[13px] font-medium text-white outline-none transition-colors placeholder:text-[#334155] focus:border-cyan/40"
          />
        </div>
      ) : null}

      {/* ── Mobile slide-down drawer (nav links only) ── */}
      <div
        className={`overflow-hidden border-t border-white/[0.04] transition-[max-height,opacity] duration-300 ease-in-out md:hidden ${
          mobileMenuOpen ? 'max-h-[80vh] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-1 bg-[#0b1322]/95 px-3 pb-4 pt-3 backdrop-blur-lg">
          {/* Nav links */}
          <Link href="/markets" className={mobileNavLinkClass(isExplorePage && !isCreatePage)} onClick={() => setMobileMenuOpen(false)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            Explore Markets
          </Link>
          {!isLandingPage ? (
            <Link href="/markets/create" className={mobileNavLinkClass(isCreatePage)} onClick={() => setMobileMenuOpen(false)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 opacity-50">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
              </svg>
              Create Market
            </Link>
          ) : null}
          <a href={dexUrl} className={mobileNavLinkClass()} onClick={() => setMobileMenuOpen(false)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
              <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            DEX
          </a>

          {/* Balance and menu for mobile */}
          {showWallet && connectedWallet ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#0d1520] px-3.5 py-2.5">
                {(['USDC', 'EURC'] as const).map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setActiveStable(sym)}
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-black transition-colors ${
                      activeStable === sym
                        ? sym === 'EURC' ? 'bg-blue-400/10 text-blue-300' : 'bg-cyan/10 text-cyan'
                        : 'text-[#4a5568]'
                    }`}
                  >
                    {sym}
                    <span className={activeStable === sym ? '' : 'text-[#94a3b8]'}>{balances[sym] ?? '--'}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <Link href="/activity" className={mobileNavLinkClass(pathname === '/activity')} onClick={() => setMobileMenuOpen(false)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  Activity
                </Link>
                <Link href="/portfolio" className={mobileNavLinkClass(pathname === '/portfolio')} onClick={() => setMobileMenuOpen(false)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                  </svg>
                  Portfolio
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>


      {/* ── Desktop top bar (>= md) ── */}
      <div className="mx-auto hidden h-[66px] max-w-[1400px] items-center gap-6 px-7 md:flex">
        <div className="shrink-0">
          <BrandMark />
        </div>
        <div className="flex flex-1">
          {showSearchBar ? (
            <input
              value={searchValue}
              onChange={(event) => updateExploreSearch(event.target.value)}
              placeholder="Search markets…"
              className="w-full max-w-[520px] rounded-lg border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-[13px] font-medium text-white outline-none transition-colors placeholder:text-[#334155] focus:border-cyan/40"
            />
          ) : null}
        </div>
        <nav className="ml-auto flex shrink-0 items-center gap-2">
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
              className="rounded-lg border border-cyan/30 bg-cyan/10 px-2 py-1 text-[13px] font-bold text-cyan transition-colors hover:border-cyan/50 hover:bg-cyan/15"
            >
              Faucet
            </a>
          ) : null}
          {showWallet && connectedWallet ? (
            <div ref={balanceMenuRef} className="relative">
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
                  <div className="border-t border-white/[0.06]" />
                  {!isLandingPage ? (
                    <Link href="/activity" className="flex w-full items-center gap-2 px-3 py-2.5 text-[12px] font-black text-[#94a3b8] transition-colors hover:bg-white/[0.04] hover:text-white">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                      Activity
                    </Link>
                  ) : null}
                  {!isLandingPage ? (
                    <Link href="/portfolio" className="flex w-full items-center gap-2 px-3 py-2.5 text-[12px] font-black text-[#94a3b8] transition-colors hover:bg-white/[0.04] hover:text-white">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                      </svg>
                      Portfolio
                    </Link>
                  ) : null}
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

