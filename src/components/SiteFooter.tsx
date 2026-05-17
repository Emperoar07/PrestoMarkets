import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-white/[0.06] py-9">
      <div className="mx-auto flex max-w-[1140px] flex-wrap items-center justify-between gap-4 px-4 md:px-7">
        <p className="text-[11.5px] text-[#4b6280]">&copy; 2026 Presto Markets. Built on Arc testnet.</p>
        <div className="flex flex-wrap gap-5">
          <Link href="/build-rails" className="text-[12px] font-semibold text-[#94a3b8] transition-colors hover:text-[#25c0f4]">
            Build Rails
          </Link>
          <Link href="/roadmap" className="text-[12px] font-semibold text-[#94a3b8] transition-colors hover:text-[#25c0f4]">
            Roadmap
          </Link>
        </div>
      </div>
    </footer>
  );
}
