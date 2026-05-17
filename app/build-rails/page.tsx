import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { currentRails, plannedRails } from '@/lib/productRails';

export default function BuildRailsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1140px] px-4 pb-16 pt-28 md:px-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Build rails</p>
        <h1 className="mt-3 text-[clamp(34px,5vw,54px)] font-black tracking-tight text-white">USDC markets first, richer rails when ready</h1>
        <p className="mt-3 max-w-3xl text-[14px] leading-[1.7] text-muted">
          Presto Markets reads from the deployed Arc factory and submits live transactions for creation, trading, resolution, claims, and refunds.
        </p>

        <section className="mt-9 rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Current</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {currentRails.map((rail) => (
                  <span key={rail.name} className="rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-black text-mint">
                    {rail.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-[14px] border border-white/[0.06] bg-[#0f172a] p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-muted">Planned</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {plannedRails.map((rail) => (
                  <span key={rail.name} className="rounded-full border border-line bg-panel2 px-3 py-1 text-xs font-black text-muted">
                    {rail.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
