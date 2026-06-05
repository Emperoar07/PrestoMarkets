'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { WalletConnectButton } from './WalletConnectButton';
import { fetchArcStableBalances, readCachedUsdcBalance, type StableSymbol } from '@/lib/walletBalance';
import { getStoredConnectedWallet, subscribeConnectedWallet, disconnectExternalWallet, type ConnectedWallet } from '@/lib/walletProvider';
import { extractMarketCategories, mergeTopicNavCategories, primaryViewCategories } from '@/lib/categories';
import { useAppState } from '@/lib/appState';
import { useDisconnect } from 'wagmi';

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
  const isDocsPage = pathname === '/docs' || pathname === '/build-rails';
  const showSearchBar = !isLandingPage && !isDocsPage;
  // Category tab row only on the markets explorer itself — not market detail pages, not
  // portfolio/activity/create. Keeps secondary pages uncluttered.
  const showCategoryNav = pathname === '/markets';
  const isCreatePage = pathname === '/markets/create';

  const [searchValue, setSearchValue] = useState('');
  const [activeCategory, setActiveCategory] = useState('Trending');
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [balances, setBalances] = useState<Record<StableSymbol, string | null>>({ USDC: null });
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const { disconnect } = useDisconnect();
  const { markets } = useAppState();
  // Nav chips are dynamic: curated base categories first, then any categories the live
  // markets actually use (e.g. agent-coined ones like Space or Gaming) appended.
  const navCategories = useMemo(() => mergeTopicNavCategories(extractMarketCategories(markets)), [markets]);
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const loadBalances = useCallback(async () => {
    if (!connectedWallet?.address) {
      setBalances({ USDC: null });
      return;
    }

    try {
      setBalances(await fetchArcStableBalances(connectedWallet.address));
    } catch {
      setBalances({ USDC: null });
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
        setBalances({ USDC: null });
        return;
      }

      // Show the last known balance immediately, then revalidate from chain.
      const cached = readCachedUsdcBalance(connectedWallet.address);
      if (cached) setBalances({ USDC: cached });

      try {
        const nextBalances = await fetchArcStableBalances(connectedWallet.address);
        if (!cancelled) setBalances(nextBalances);
      } catch {
        if (!cancelled && !cached) setBalances({ USDC: null });
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
    if (!menuOpen) return undefined;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

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
                <div className="flex items-center gap-1.5 rounded-lg bg-cyan/10 px-2 py-1 text-[12px] font-black text-cyan">
                  USDC <span>{balances.USDC ?? '--'}</span>
                </div>
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
                <Link href="/profile" className={mobileNavLinkClass(pathname === '/profile')} onClick={() => setMobileMenuOpen(false)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-50">
                    <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
                  </svg>
                  Profile
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
          {!isLandingPage ? (
            <Link href="/markets/create" className={`${navLinkClass(isCreatePage)} inline-flex items-center gap-1.5`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
              </svg>
              Create Market
            </Link>
          ) : null}
          <a href={dexUrl} className={`${navLinkClass()} inline-flex items-center gap-1.5`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
              <path d="m17 2 4 4-4 4" /><path d="M3 6h18" /><path d="m7 22-4-4 4-4" /><path d="M21 18H3" />
            </svg>
            DEX
          </a>
          {showWallet ? (
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan/10 px-2 py-1 text-[13px] font-bold text-cyan transition-colors hover:border-cyan/50 hover:bg-cyan/15"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M12 2.5s6 6.3 6 10.5a6 6 0 0 1-12 0c0-4.2 6-10.5 6-10.5Z" />
              </svg>
              Faucet
            </a>
          ) : null}
          {showWallet && connectedWallet ? (
            <div ref={menuRef} className="relative flex items-center gap-2">
              {/* Balance pill (standalone, sized to match the header actions) */}
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#0b1322]/80 px-3 py-1 text-[12px] font-black text-[#dbeafe] transition-colors hover:border-cyan/35"
              >
                <span className="text-[#4a5568]">USDC</span>
                <span className="text-cyan font-black">{balances.USDC ?? '--'}</span>
              </button>

              {/* Wallet pill */}
              <WalletConnectButton
                showAvatar={true}
                hideDropdown={true}
                onClick={() => setMenuOpen((open) => !open)}
                forceArrowState={menuOpen}
              />

              {/* Merged Single Dropdown Box */}
              {menuOpen ? (
                <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[350px] overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/55 backdrop-blur-md">
                  {/* Identity Header */}
                  <div className="px-4 pb-3.5 pt-4 bg-[#0d1627]/30">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan/70">
                        {connectedWallet.mode === 'circle-user-controlled' ? 'App Wallet' : 'External Wallet'}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(connectedWallet.address);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1400);
                        }}
                        className="text-[10px] font-black uppercase tracking-[0.18em] text-[#94a3b8] transition-colors hover:text-cyan"
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="mt-2 text-[12px] font-mono leading-relaxed text-[#cbd5e1] break-all">
                      {connectedWallet.address}
                    </p>
                  </div>

                  <div className="h-px bg-white/[0.06]" />

                  {/* Actions & Navigation Footer */}
                  <div className="flex flex-col gap-1 p-2 bg-[#090e1a]">
                    <Link
                      href="/profile"
                      onClick={() => setMenuOpen(false)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-bold text-[#94a3b8] transition-colors hover:text-white hover:bg-white/[0.04] rounded-lg"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-75">
                        <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
                      </svg>
                      Profile
                    </Link>

                    <Link
                      href="/portfolio"
                      onClick={() => setMenuOpen(false)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-bold text-[#94a3b8] transition-colors hover:text-white hover:bg-white/[0.04] rounded-lg"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-75">
                        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                      </svg>
                      Portfolio
                    </Link>

                    <Link
                      href="/activity"
                      onClick={() => setMenuOpen(false)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-bold text-[#94a3b8] transition-colors hover:text-white hover:bg-white/[0.04] rounded-lg"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-75">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                      Activity
                    </Link>

                    <a
                      href={`https://testnet.arcscan.app/address/${connectedWallet.address}`}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-bold text-[#94a3b8] transition-colors hover:text-white hover:bg-white/[0.04] rounded-lg"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-75">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      Explorer
                    </a>

                    <button
                      type="button"
                      onClick={async () => {
                        disconnect();
                        await disconnectExternalWallet();
                        setConnectedWallet(null);
                        setMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-bold text-[#f87171] transition-colors hover:text-red-300 hover:bg-red-500/[0.06] rounded-lg"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-75">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            showWallet ? <WalletConnectButton /> : null
          )}
        </nav>
      </div>

      {/* Row 2: category nav — only on the markets explorer */}
      {showCategoryNav ? (
        <div className="border-t border-white/[0.04]">
          <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 md:px-7">
            <div ref={categoryScrollRef} className="scrollbar-hide min-w-0 flex-1 overflow-x-auto">
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
                    ) : null}
                    {cat}
                  </button>
                ))}

                <div className="mx-1 h-4 w-px shrink-0 bg-white/[0.1]" />

                {navCategories.map((cat) => (
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
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('presto:toggle-filters'))}
              className="flex shrink-0 items-center justify-center rounded-[8px] bg-white/[0.04] px-3 py-2 text-[#cbd5e1] transition-colors hover:bg-white/[0.08] hover:text-white"
              title="Sort & filter"
              aria-label="Sort and filter"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}

