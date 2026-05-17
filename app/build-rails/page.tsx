import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { currentRails, plannedRails } from '@/lib/productRails';

const progressItems = [
  'Live Arc factory reads and market creation are wired.',
  'Live buy, resolve, claim, refund, and USDC approval flows are wired.',
  'Circle email OTP, Google, and PIN wallet onboarding are in the sign-in modal.',
  'Production Google Web Client ID is configured locally and in Vercel environments.',
  'RainbowKit external EVM wallets render inline in the same modal.',
  'Production hardening gate is documented before real-value markets.',
];

const remainingItems = [
  'Verify Circle Email OTP settings in Circle Console.',
  'Add persistent indexed account history beyond recent log-window reads.',
  'Improve realized and unrealized portfolio accounting.',
  'Turn hardening notes into reviewed audit findings and dispute or bond design.',
  'Redeploy production after env and UI changes.',
];

export default function BuildRailsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1140px] px-4 pb-16 pt-28 md:px-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-cyan">Build rails</p>
        <h1 className="mt-3 text-[clamp(34px,5vw,54px)] font-black tracking-tight text-white">USDC markets first, richer rails when ready</h1>
        <p className="mt-3 max-w-3xl text-[14px] leading-[1.7] text-muted">
          Presto Markets reads from the deployed Arc factory, submits live market transactions, and now supports Circle app-native onboarding plus inline RainbowKit external wallets.
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

        <section className="mt-8 grid gap-5 lg:grid-cols-2">
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-cyan">Done</p>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-muted">
              {progressItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-[16px] border border-white/[0.06] bg-[#141e30] p-6">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[#94a3b8]">Left</p>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-muted">
              {remainingItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
