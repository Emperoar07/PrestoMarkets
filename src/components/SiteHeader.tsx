'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { WalletConnectButton } from './WalletConnectButton';
import { AddUsdcDrawer } from './AddUsdcDrawer';
import { fetchArcStableBalances, readCachedUsdcBalance, type StableSymbol } from '@/lib/walletBalance';
import { isWorldCupActive } from '@/lib/worldCup';
import { fetchAvailableUsdc, formatAvailableUsdc, readCachedAvailableUsdc } from '@/lib/unifiedBalance';
import { getStoredConnectedWallet, subscribeConnectedWallet, disconnectExternalWallet, type ConnectedWallet } from '@/lib/walletProvider';
import { extractMarketCategories, mergeTopicNavCategories, primaryViewCategories } from '@/lib/categories';
import { useAppState } from '@/lib/appState';
import { useDisconnect } from 'wagmi';
import { useSocialSession } from '@/lib/socialSessionContext';

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
  // World Cup hub auto-retires when the tournament window ends (see lib/worldCup). Once inactive
  // the pill and its category-nav treatment disappear so the app sheds that surface on its own.
  const worldCupActive = isWorldCupActive();
  const showCategoryNav = pathname === '/markets' || (pathname === '/world-cup' && worldCupActive);
  const isCreatePage = pathname === '/markets/create';

  const [searchValue, setSearchValue] = useState('');
  const [activeCategory, setActiveCategory] = useState('Trending');
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [balances, setBalances] = useState<Record<StableSymbol, string | null>>({ USDC: null });
  // Unified Available USDC (Arc + Gateway-supported testnets) — stale-while-revalidate.
  const [availableUsdc, setAvailableUsdc] = useState<string | null>(null);

  useEffect(() => {
    const address = connectedWallet?.address;
    if (!address) {
      setAvailableUsdc(null);
      return undefined;
    }
    let cancelled = false;
    const cached = readCachedAvailableUsdc(address);
    if (cached) setAvailableUsdc(cached);
    const load = () => {
      void fetchAvailableUsdc(address).then((result) => {
        if (!cancelled && result) setAvailableUsdc(formatAvailableUsdc(result.total));
      });
    };
    load();
    window.addEventListener('presto:balances-refresh', load);
    return () => {
      cancelled = true;
      window.removeEventListener('presto:balances-refresh', load);
    };
  }, [connectedWallet?.address]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false); // mobile bottom-sheet
  const [fundingDropdownOpen, setFundingDropdownOpen] = useState(false); // desktop anchored dropdown
  const [showNotifications, setShowNotifications] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { unreadCount, notifications, markNotificationsRead } = useSocialSession();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      setShowNotifications(false);
    }
  }, [menuOpen]);
  const [copied, setCopied] = useState(false);
  const { disconnect } = useDisconnect();
  const { markets } = useAppState();
  // Nav chips are dynamic: curated base categories first, then any categories the live
  // markets actually use (e.g. agent-coined ones like Space or Gaming) appended.
  const navCategories = useMemo(() => mergeTopicNavCategories(extractMarketCategories(markets)), [markets]);
  const searchText = searchValue.trim().toLowerCase();
  const marketSuggestions = useMemo(() => {
    if (!searchText) return [];
    return markets
      .filter((market) => {
        if (market.status === 'Canceled') return false;
        const blob = [
          market.title,
          market.description,
          market.category,
          ...(market.categories ?? []),
          ...market.outcomes.map((outcome) => outcome.label),
        ].join(' ').toLowerCase();
        return blob.includes(searchText);
      })
      .slice(0, 6);
  }, [markets, searchText]);
  const keywordSuggestions = useMemo(() => {
    if (!searchText) return [];
    const keywords = new Set<string>();
    for (const market of markets) {
      for (const label of [market.category, ...(market.categories ?? [])]) {
        if (label && label.toLowerCase().includes(searchText)) keywords.add(label);
      }
      for (const outcome of market.outcomes) {
        if (outcome.label.toLowerCase().includes(searchText)) keywords.add(outcome.label);
      }
    }
    return Array.from(keywords).slice(0, 5);
  }, [markets, searchText]);
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

  useEffect(() => {
    function handleSearchClickOutside(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-presto-search]')) return;
      setSearchOpen(false);
    }
    document.addEventListener('mousedown', handleSearchClickOutside);
    return () => document.removeEventListener('mousedown', handleSearchClickOutside);
  }, []);

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
    setSearchOpen(value.trim().length > 0);
    // Keep search in memory only so refresh returns to a clean explorer.
    window.dispatchEvent(new CustomEvent('presto:market-search', { detail: value }));
  }

  function selectSearchKeyword(keyword: string) {
    setSearchValue(keyword);
    setSearchOpen(true);
    window.dispatchEvent(new CustomEvent('presto:market-search', { detail: keyword }));
  }

  function goToSearchMarket(marketId: string) {
    setSearchOpen(false);
    setSearchValue('');
    router.push(`/markets/${marketId}`);
  }

  function renderSearchSuggestions() {
    if (!searchOpen || !searchText) return null;
    const hasResults = marketSuggestions.length > 0 || keywordSuggestions.length > 0;
    return (
      <div className="absolute left-0 right-0 top-full z-[70] mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/40">
        {hasResults ? (
          <div className="max-h-[360px] overflow-y-auto p-2">
            {marketSuggestions.length > 0 ? (
              <div className="space-y-1">
                {marketSuggestions.map((market) => (
                  <button
                    key={market.id}
                    type="button"
                    onClick={() => goToSearchMarket(market.id)}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.06] bg-[#07111c] text-[10px] font-black text-cyan">
                      {market.imageURI ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={market.imageURI} alt="" className="h-full w-full object-cover" />
                      ) : (
                        market.category.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[13px] font-black leading-snug text-white">{market.title}</span>
                      <span className="mt-1 block truncate text-[11px] font-bold text-[#64748b]">
                        {market.category} · {market.status} · {market.volume} Vol.
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {keywordSuggestions.length > 0 ? (
              <div className={marketSuggestions.length > 0 ? 'mt-2 border-t border-white/[0.06] pt-2' : ''}>
                <p className="px-2 pb-1 text-[9px] font-black uppercase tracking-widest text-[#64748b]">Related keywords</p>
                <div className="flex flex-wrap gap-1.5 px-2 pb-1">
                  {keywordSuggestions.map((keyword) => (
                    <button
                      key={keyword}
                      type="button"
                      onClick={() => selectSearchKeyword(keyword)}
                      className="rounded-full border border-cyan/20 bg-cyan/10 px-2.5 py-1 text-[11px] font-black text-cyan transition-colors hover:border-cyan/35 hover:bg-cyan/15"
                    >
                      {keyword}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="px-3 py-3 text-[12px] font-semibold text-[#64748b]">
            No live market suggestions for &quot;{searchValue.trim()}&quot;.
          </div>
        )}
      </div>
    );
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
          {showWallet && connectedWallet ? (
            <button
              type="button"
              onClick={() => setFundingOpen(true)}
              className="flex items-center gap-1 rounded-lg bg-[#25c0f4]/10 border border-[#25c0f4]/15 px-2 py-1 text-[11px] font-black text-cyan"
              aria-label="Open Add USDC drawer"
            >
              USDC <span>{balances.USDC ?? '--'}</span>
            </button>
          ) : null}
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
          <div className="relative" data-presto-search>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#475569]">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={searchValue}
              onChange={(event) => updateExploreSearch(event.target.value)}
              onFocus={() => setSearchOpen(searchValue.trim().length > 0)}
              placeholder="Search markets…"
              className="w-full rounded-xl border border-white/[0.06] bg-[#0d1520] py-2 pl-9 pr-3.5 text-[13px] font-medium text-white outline-none transition-colors placeholder:text-[#334155] focus:border-cyan/40"
            />
            {renderSearchSuggestions()}
          </div>
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
        </div>
      </div>


      {/* ── Desktop top bar (>= md) ── */}
      <div className="mx-auto hidden h-[66px] max-w-[1400px] items-center gap-6 px-7 md:flex">
        <div className="shrink-0">
          <BrandMark />
        </div>
        <div className="flex flex-1">
          {showSearchBar ? (
            <div className="relative w-full max-w-[520px]" data-presto-search>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#475569]">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={searchValue}
                onChange={(event) => updateExploreSearch(event.target.value)}
                onFocus={() => setSearchOpen(searchValue.trim().length > 0)}
                placeholder="Search markets…"
                className="w-full rounded-lg border border-white/[0.06] bg-[#0d1520] py-2 pl-9 pr-3 text-[13px] font-medium text-white outline-none transition-colors placeholder:text-[#334155] focus:border-cyan/40"
              />
              {renderSearchSuggestions()}
            </div>
          ) : null}
        </div>
        <nav className="ml-auto flex shrink-0 items-center gap-2">
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
          {!isLandingPage ? (
            <Link href="/markets/create" className={`${navLinkClass(isCreatePage)} inline-flex items-center gap-1.5`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
              </svg>
              Create Market
            </Link>
          ) : null}
          {showWallet && connectedWallet ? (
            <div ref={menuRef} className="relative flex items-center gap-2">
              {/* Balance pill (standalone, sized to match the header actions) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setFundingDropdownOpen((open) => !open);
                    setMenuOpen(false);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#0b1322]/80 px-3 py-1 text-[12px] font-black text-[#dbeafe] transition-colors hover:border-cyan/25 hover:text-white"
                  aria-label="Open Add USDC dropdown"
                >
                  <span className="text-[#4a5568]">USDC</span>
                  <span className="text-cyan font-black">{availableUsdc ?? balances.USDC ?? '--'}</span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`opacity-60 ml-0.5 shrink-0 transition-transform duration-200 ${fundingDropdownOpen ? 'rotate-180' : ''}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <AddUsdcDrawer
                  variant="dropdown"
                  open={fundingDropdownOpen}
                  onClose={() => setFundingDropdownOpen(false)}
                  wallet={connectedWallet}
                />
              </div>

              {/* Wallet pill */}
              <WalletConnectButton
                showAvatar={true}
                hideDropdown={true}
                onClick={() => {
                  setMenuOpen((open) => !open);
                  setFundingDropdownOpen(false);
                }}
                forceArrowState={menuOpen}
              />

              {/* Merged Single Dropdown Box */}
              {menuOpen ? (
                <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[350px] overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/55 backdrop-blur-md">
                  {showNotifications ? (
                    <>
                      {/* Notifications Sub-view Header */}
                      <div className="px-4 pb-3.5 pt-4 bg-[#0d1627]/30 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setShowNotifications(false)}
                          className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-[#94a3b8] hover:text-white transition-colors"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                          </svg>
                          Back
                        </button>
                        <p className="text-xs font-black text-white">Notifications</p>
                        {unreadCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => void markNotificationsRead()}
                            className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan hover:opacity-85"
                          >
                            Mark all read
                          </button>
                        ) : null}
                      </div>

                      <div className="h-px bg-white/[0.06]" />

                      {/* Notifications Scrollable Feed */}
                      <div className="max-h-[300px] overflow-y-auto divide-y divide-white/[0.05] bg-[#090e1a] custom-scroll font-sans">
                        {notifications.length === 0 ? (
                          <p className="px-4 py-10 text-center text-xs text-[#64748b]">No notifications yet.</p>
                        ) : (
                          notifications.map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => {
                                void markNotificationsRead([n.id]);
                                setMenuOpen(false);
                                setShowNotifications(false);
                                if (n.link) router.push(n.link);
                                else if (n.marketId) router.push(`/markets/${n.marketId}`);
                              }}
                              className={`block w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.02] ${n.read ? '' : 'bg-cyan/[0.03]'}`}
                            >
                              <div className="flex items-start gap-2">
                                {!n.read ? (
                                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
                                ) : (
                                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="text-[12px] font-bold text-[#e2e8f0] leading-snug">{n.title}</p>
                                  {n.body ? (
                                    <p className="mt-0.5 text-[11px] text-[#64748b] leading-snug line-clamp-2">{n.body}</p>
                                  ) : null}
                                  <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#475569]">
                                    {timeAgo(n.createdAt)}
                                  </p>
                                </div>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Identity Header */}
                      <div className="px-4 pb-3.5 pt-4 bg-[#0d1627]/30">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan/70">
                            {connectedWallet.mode === 'circle-user-controlled' ? 'App Wallet' : connectedWallet.mode === 'circle-passkey' ? 'Passkey Wallet' : 'External Wallet'}
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

                        <button
                          type="button"
                          onClick={() => setShowNotifications(true)}
                          className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-bold text-[#94a3b8] transition-colors hover:text-white hover:bg-white/[0.04] rounded-lg text-left"
                        >
                          <div className="flex items-center gap-2.5">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-75">
                              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                            Notifications
                          </div>
                          {unreadCount > 0 ? (
                            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan px-1 text-[9px] font-black text-[#07111f]">
                              {unreadCount}
                            </span>
                          ) : null}
                        </button>

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
                    </>
                  )}
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
                {/* Pinned World Cup hub — gold accent, Polymarket-style. Hidden once the
                    tournament window ends so the nav sheds it automatically. */}
                {worldCupActive ? (
                  <Link
                    href="/world-cup"
                    className={`flex min-w-fit items-center gap-1.5 px-4 py-3 text-[13px] font-bold transition-colors ${
                      pathname === '/world-cup'
                        ? 'border-b-2 border-amber-300 text-amber-200'
                        : 'text-amber-200/85 hover:text-amber-100'
                    }`}
                  >
                    <span aria-hidden>⚽</span> World Cup
                  </Link>
                ) : null}
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
      <AddUsdcDrawer open={fundingOpen} onClose={() => setFundingOpen(false)} wallet={connectedWallet} />
    </header>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

