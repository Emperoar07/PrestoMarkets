import { ActivityClient } from '@/components/ActivityClient';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export default function ActivityPage() {
  return (
    <>
      <SiteHeader />
      <ActivityClient />
      <SiteFooter />
    </>
  );
}
