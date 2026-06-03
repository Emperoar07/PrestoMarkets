import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { WatchlistClient } from '@/components/WatchlistClient';

export default function WatchlistPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-36 md:px-7 md:pt-40">
        <h1 className="text-[clamp(44px,6vw,68px)] font-black tracking-tight text-white">Watchlist</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-muted">
          Markets you are tracking for close times, price movement, resolution, and claim events.
        </p>
        <WatchlistClient />
      </main>
      <SiteFooter />
    </>
  );
}
