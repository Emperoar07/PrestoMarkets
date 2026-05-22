import { NewsClient } from '@/components/NewsClient';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

export default function NewsPage() {
  return (
    <>
      <SiteHeader />
      <NewsClient />
      <SiteFooter />
    </>
  );
}
