import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { LeaderboardClient } from '@/components/LeaderboardClient';

export default function LeaderboardPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-36 md:px-7 md:pt-40">
        <h1 className="text-[clamp(44px,6vw,68px)] font-black tracking-tight text-white">Leaderboard</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
          Opt-in rankings for realized performance, forecasting accuracy, and market creation.
        </p>
        <LeaderboardClient />
      </main>
      <SiteFooter />
    </>
  );
}
