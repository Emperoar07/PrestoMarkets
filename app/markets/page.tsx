import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { MarketsExplorer } from '@/components/MarketsExplorer';

export default function MarketsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="flex-1">
        <MarketsExplorer />
      </div>
      <SiteFooter />
    </div>
  );
}
