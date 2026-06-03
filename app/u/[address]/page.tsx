import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { PublicProfileClient } from '@/components/PublicProfileClient';

export default async function PublicProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-36 md:px-7 md:pt-40">
        <h1 className="text-[clamp(44px,6vw,68px)] font-black tracking-tight text-white">Profile</h1>
        <PublicProfileClient address={address} />
      </main>
      <SiteFooter />
    </>
  );
}
