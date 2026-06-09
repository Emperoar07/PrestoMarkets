'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BrandLoadingOverlay } from './BrandLoader';

// Only reveal the full-screen loader if a navigation actually takes a beat. Fast client
// transitions resolve before this fires, so they feel instant instead of flashing an overlay.
const SHOW_DELAY_MS = 350;

export function NavigationLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, setIsNavigating] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelPending() {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
  }

  function scheduleShow() {
    cancelPending();
    showTimer.current = setTimeout(() => setIsNavigating(true), SHOW_DELAY_MS);
  }

  // A completed navigation (pathname/search change) clears any pending timer + the overlay.
  useEffect(() => {
    cancelPending();
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
        if (url.origin !== window.location.origin) return;
        if (url.pathname === pathname && url.searchParams.toString() === searchParams.toString()) return;
        scheduleShow();
      } catch {
        // Invalid URL
      }
    };

    const handleCustomNavigate = () => scheduleShow();

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
