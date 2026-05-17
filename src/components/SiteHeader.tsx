'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from './BrandMark';
import { WalletConnectButton } from './WalletConnectButton';

const dexUrl = process.env.NEXT_PUBLIC_PRESTO_DEX_URL ?? 'https://prestodex-arc.vercel.app';

export function SiteHeader() {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.06] bg-[#090e1a]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[66px] max-w-[1140px] items-center px-4 md:px-7">
        <BrandMark />
        <nav className="mr-5 hidden gap-0.5 md:flex">
          <a href={dexUrl} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[#94a3b8] transition-all hover:bg-white/[0.04] hover:text-[#f1f5f9]">
            DEX
          </a>
          {isLandingPage ? (
            <Link href="/markets" className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[#94a3b8] transition-all hover:bg-white/[0.04] hover:text-[#f1f5f9]">
              Markets
            </Link>
          ) : (
            <Link href="/markets/create" className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[#94a3b8] transition-all hover:bg-white/[0.04] hover:text-[#f1f5f9]">
              Create Market
            </Link>
          )}
        </nav>
        {isLandingPage ? (
          <Link href="/markets" className="rounded-lg bg-[#25c0f4] px-[18px] py-2 text-[13px] font-bold text-[#090e1a] transition-opacity hover:opacity-90">
            Explore Markets
          </Link>
        ) : (
          <div className="flex items-center gap-3">
            <Link href="/markets" className="rounded-lg bg-[#25c0f4] px-[18px] py-2 text-[13px] font-bold text-[#090e1a] transition-opacity hover:opacity-90">
              Explore Markets
            </Link>
            <WalletConnectButton />
          </div>
        )}
      </div>
    </header>
  );
}
