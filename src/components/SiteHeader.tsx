import Link from 'next/link';
import { BrandMark } from './BrandMark';

const dexUrl = process.env.NEXT_PUBLIC_PRESTO_DEX_URL ?? 'https://prestodex-arc.vercel.app';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink/95">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
        <BrandMark />
        <nav className="hidden items-center gap-7 text-sm font-semibold text-muted md:flex">
          <Link href="/markets" className="transition-colors hover:text-cyan">Markets</Link>
          <Link href="/markets/create" className="transition-colors hover:text-cyan">Create</Link>
          <Link href="/portfolio" className="transition-colors hover:text-cyan">Portfolio</Link>
          <Link href="/roadmap" className="transition-colors hover:text-cyan">Roadmap</Link>
          <a href={dexUrl} className="rounded-2xl bg-cyan px-5 py-3 font-black text-ink transition-opacity hover:opacity-90">
            Launch DEX
          </a>
        </nav>
      </div>
    </header>
  );
}
