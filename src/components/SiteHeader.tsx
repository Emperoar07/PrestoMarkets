'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { WalletConnectButton } from './WalletConnectButton';

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
  const isLandingPage = pathname === '/';
  const showWallet = !isLandingPage;
  const isExplorePage = pathname === '/markets' || pathname.startsWith('/markets/');
  const isCreatePage = pathname === '/markets/create';

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.06] bg-[#090e1a]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[66px] max-w-[1140px] items-center px-4 md:px-7">
        <BrandMark />
        <nav className="ml-auto flex items-center gap-3">
          <Link href="/markets" className={navLinkClass(isExplorePage && !isCreatePage)}>
            Explore Markets
          </Link>
          <a href={dexUrl} className={navLinkClass()}>
            DEX
          </a>
          {!isLandingPage ? (
            <Link href="/markets/create" className={navLinkClass(isCreatePage)}>
              Create Market
            </Link>
          ) : null}
          {showWallet ? <WalletConnectButton /> : null}
        </nav>
      </div>
    </header>
  );
}
