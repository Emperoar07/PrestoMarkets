'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandLoadingOverlay } from './BrandLoader';

export function NavigationLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, setIsNavigating] = useState(true);

  // Clear the initial document load and each completed client navigation.
  useEffect(() => {
    setIsNavigating(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    const handleAnchorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('[data-no-loader]')) return;
      const anchor = target.closest('a');
      
      if (!anchor) return;
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (anchor.hasAttribute('download')) return;
      if (anchor.getAttribute('target') === '_blank') return;
      
      const href = anchor.getAttribute('href');
      if (!href) return;
      
      try {
        const url = new URL(href, window.location.origin);
        // Only trigger for same-origin local routes
        if (url.origin !== window.location.origin) return;
        
        // If it's the exact same page, don't show loader
        if (url.pathname === pathname && url.searchParams.toString() === searchParams.toString()) return;

        setIsNavigating(true);
      } catch {
        // Invalid URL
      }
    };

    const handleCustomNavigate = () => setIsNavigating(true);

    document.addEventListener('click', handleAnchorClick, { capture: true });
    window.addEventListener('presto:navigate-start', handleCustomNavigate);
    
    return () => {
      document.removeEventListener('click', handleAnchorClick, { capture: true });
      window.removeEventListener('presto:navigate-start', handleCustomNavigate);
    };
  }, [pathname, searchParams]);

  if (!isNavigating) return null;

  return <BrandLoadingOverlay />;
}
