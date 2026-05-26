import { BreakingNewsPage } from '@/components/BreakingNewsPage';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata = {
  title: 'Breaking News Markets | Presto',
  description: 'Prediction markets on trending topics.',
};

export default function Page() {
  return (
    <>
      <SiteHeader />
      <BreakingNewsPage />
      <SiteFooter />
    </>
  );
}
