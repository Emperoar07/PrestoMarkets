import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { MarketsExplorer } from '@/components/MarketsExplorer';

export default function MarketsPage() {
  return (
    <>
      <SiteHeader />
      <MarketsExplorer />
      <SiteFooter />
    </>
  );
}
