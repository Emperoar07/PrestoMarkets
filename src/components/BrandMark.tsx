import Link from 'next/link';

function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="15" stroke="#25c0f4" strokeWidth="1.5" strokeOpacity="0.5" fill="#25c0f4" fillOpacity="0.08" />
      <circle cx="16" cy="16" r="10" stroke="#f1f5f9" strokeWidth="1.5" strokeOpacity="0.9" fill="none" />
      <circle cx="16" cy="16" r="4.5" fill="#25c0f4" />
    </svg>
  );
}

export function BrandMark() {
  return (
    <Link href="/" className="mr-auto flex select-none items-center gap-2.5">
      <LogoMark size={34} />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-extrabold tracking-tight text-[#f1f5f9]">
          Presto <span className="text-[#25c0f4]">Markets</span>
        </span>
        <span className="mt-1 w-fit rounded-[4px] border border-[#25c0f4]/30 bg-[#25c0f4]/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] text-[#67e8f9]">
          Testnet
        </span>
      </span>
    </Link>
  );
}
