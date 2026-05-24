export function BrandLoader() {
  return (
    <div className="flex flex-col items-center justify-center">
      <svg className="presto-kinetic-loader h-20 w-20 drop-shadow-[0_0_12px_rgba(37,192,244,0.2)]" viewBox="0 0 64 64">
        <circle className="presto-ring-outer stroke-cyan stroke-[4] fill-transparent" cx="32" cy="32" r="28" />
        <circle className="presto-ring-inner stroke-white stroke-[4] fill-transparent" cx="32" cy="32" r="18" />
        <circle className="fill-cyan" cx="32" cy="32" r="8" />
      </svg>
    </div>
  );
}
