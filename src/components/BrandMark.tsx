import Link from 'next/link';

export function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-2xl border border-cyan/40 bg-cyan/10">
        <span className="h-4 w-4 rounded-full border-[5px] border-cyan" />
      </span>
      <span className="text-xl font-black tracking-tight text-white">Presto Markets</span>
    </Link>
  );
}
