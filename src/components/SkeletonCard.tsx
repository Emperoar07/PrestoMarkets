export function SkeletonCard() {
  return (
    <div className="animate-pulse flex flex-col rounded-[16px] border border-white/[0.06] bg-[#131a27] p-5 sm:p-6">
      {/* Header: icon + title */}
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-[10px] bg-white/[0.06]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-4 bg-white/[0.06] rounded-md w-3/4" />
          <div className="h-3 bg-white/[0.04] rounded-md w-1/2" />
        </div>
      </div>

      {/* Content space */}
      <div className="mt-6 space-y-3">
        <div className="h-8 bg-white/[0.06] rounded-md w-1/3" />
        <div className="h-4 bg-white/[0.04] rounded-md w-1/2" />
      </div>

      {/* Footer */}
      <div className="mt-5 border-t border-white/[0.04] pt-5 flex items-center justify-between">
        <div className="h-3 bg-white/[0.04] rounded-md w-1/4" />
        <div className="h-3 bg-white/[0.04] rounded-md w-1/4" />
      </div>
    </div>
  );
}
