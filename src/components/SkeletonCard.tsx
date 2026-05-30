export function SkeletonCard() {
  return (
    <div className="animate-pulse flex min-h-[116px] h-fit items-start gap-3 rounded-[12px] border border-white/[0.05] bg-[#0c121d] p-3">
      {/* Left: Icon logo placeholder */}
      <div className="h-11 w-11 shrink-0 rounded-[8px] bg-white/[0.04]" />

      {/* Right: Contents column placeholder */}
      <div className="flex-1 flex flex-col justify-between h-full space-y-2">
        {/* Title placeholder */}
        <div className="space-y-1.5">
          <div className="h-3.5 bg-white/[0.06] rounded-md w-11/12" />
          <div className="h-3.5 bg-white/[0.04] rounded-md w-2/3" />
        </div>

        {/* Outcomes placeholder */}
        <div className="flex items-center justify-between gap-4 py-1">
          <div className="h-3 bg-white/[0.04] rounded-md w-1/3" />
          <div className="h-6 bg-white/[0.04] rounded-[6px] w-16 shrink-0" />
        </div>

        {/* Metadata placeholder */}
        <div className="flex items-center justify-between border-t border-white/[0.04] pt-2">
          <div className="h-2.5 bg-white/[0.04] rounded-md w-1/4" />
          <div className="h-2.5 bg-white/[0.04] rounded-md w-1/4" />
        </div>
      </div>
    </div>
  );
}
