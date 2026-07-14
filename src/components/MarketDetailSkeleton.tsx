// Layout-mirroring loading state for the market page: instead of generic grey cards, it shadows
// the real structure (title block + chart + outcomes on the left, the 380px trade panel on the
// right) so the page doesn't jump when content arrives.
function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-[6px] bg-white/[0.05] ${className}`} />;
}

export function MarketDetailSkeleton() {
  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-16 pt-28 md:px-7 md:pt-28">
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[1fr_380px]">
        {/* Left: title, meta, chart, outcomes, description */}
        <section className="min-w-0">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 shrink-0 animate-pulse rounded-[12px] border border-white/[0.05] bg-white/[0.04]" />
            <div className="min-w-0 flex-1 space-y-2.5">
              <Bar className="h-6 w-3/4" />
              <Bar className="h-4 w-1/2" />
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <Bar className="h-6 w-20 rounded-full" />
            <Bar className="h-6 w-24 rounded-full" />
            <Bar className="h-6 w-16 rounded-full" />
          </div>

          {/* Chart panel */}
          <div className="mt-6 rounded-[16px] border border-white/[0.05] bg-[#0c121d] p-5">
            <div className="flex items-center justify-between">
              <Bar className="h-4 w-28" />
              <Bar className="h-7 w-40 rounded-[8px]" />
            </div>
            <Bar className="mt-4 h-[220px] w-full rounded-[10px]" />
          </div>

          {/* Outcome rows */}
          <div className="mt-6 space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between rounded-[12px] border border-white/[0.05] bg-[#0c121d] px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 animate-pulse rounded-[7px] bg-white/[0.05]" />
                  <Bar className="h-4 w-32" />
                </div>
                <Bar className="h-5 w-12" />
              </div>
            ))}
          </div>

          {/* Description lines */}
          <div className="mt-7 space-y-2.5">
            <Bar className="h-4 w-full max-w-[860px]" />
            <Bar className="h-4 w-full max-w-[780px]" />
            <Bar className="h-4 w-2/3 max-w-[620px]" />
          </div>
        </section>

        {/* Right: trade panel */}
        <aside className="lg:col-start-2">
          <div className="rounded-[16px] border border-white/[0.05] bg-[#0c121d] p-5">
            {/* Buy / Sell / Limit tabs */}
            <div className="grid grid-cols-3 gap-2">
              <Bar className="h-9 rounded-[10px]" />
              <Bar className="h-9 rounded-[10px]" />
              <Bar className="h-9 rounded-[10px]" />
            </div>
            {/* Outcome buttons */}
            <div className="mt-4 space-y-2.5">
              <Bar className="h-14 rounded-[12px]" />
              <Bar className="h-14 rounded-[12px]" />
            </div>
            {/* Amount input + quick chips */}
            <Bar className="mt-4 h-12 rounded-[12px]" />
            <div className="mt-2.5 grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((i) => <Bar key={i} className="h-8 rounded-[8px]" />)}
            </div>
            {/* Cost breakdown lines */}
            <div className="mt-5 space-y-2.5 border-t border-white/[0.05] pt-4">
              <div className="flex justify-between"><Bar className="h-3.5 w-24" /><Bar className="h-3.5 w-14" /></div>
              <div className="flex justify-between"><Bar className="h-3.5 w-28" /><Bar className="h-3.5 w-12" /></div>
              <div className="flex justify-between"><Bar className="h-3.5 w-32" /><Bar className="h-3.5 w-16" /></div>
            </div>
            {/* CTA */}
            <Bar className="mt-5 h-12 rounded-[12px]" />
          </div>
        </aside>
      </div>
    </main>
  );
}
