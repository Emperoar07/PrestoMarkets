'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAccount } from 'wagmi';

// Fired by SocialSignInButton after a successful sign-in so any mounted session
// consumer re-reads the cookie-backed session.
export const SOCIAL_CHANGED_EVENT = 'presto:social-changed';
// Fired by widgets (watchlist star, alerts) when an action needs a signed-in
// session; the global SignInModal listens and opens.
export const REQUIRE_SIGNIN_EVENT = 'presto:require-signin';

type SocialSessionValue = {
  address: string | null;
  isSignedIn: boolean;
  ready: boolean;
  watchlist: Set<string>;
  isWatching: (marketId: string) => boolean;
  setWatching: (marketId: string, watching: boolean) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  requireSignIn: () => void;
};

const socialSessionContext = createContext<SocialSessionValue | null>(null);

function norm(id: string) {
  return id.toLowerCase();
}

export function SocialSessionProvider({ children }: { children: ReactNode }) {
  const { address: walletAddress } = useAccount();
  const [address, setAddress] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      const data = await res.json().catch(() => ({ address: null }));
      const next: string | null = data?.address ?? null;
      setAddress(next);

      if (next) {
        try {
          const wlRes = await fetch('/api/watchlist', { cache: 'no-store' });
          if (wlRes.ok) {
            const wlData = await wlRes.json().catch(() => ({ items: [] }));
            const ids: string[] = (wlData.items ?? [])
              .map((item: { marketId?: string }) => item.marketId)
              .filter(Boolean)
              .map(norm);
            setWatchlist(new Set(ids));
          }
        } catch {
          /* watchlist is best-effort */
        }
      } else {
        setWatchlist(new Set());
      }
    } catch {
      setAddress(null);
      setWatchlist(new Set());
    } finally {
      setReady(true);
    }
  }, []);

  // Initial load + re-check whenever the connected wallet changes.
  useEffect(() => {
    void refresh();
  }, [refresh, walletAddress]);

  // Re-check after a sign-in elsewhere in the app.
  useEffect(() => {
    function onChanged() {
      void refresh();
    }
    window.addEventListener(SOCIAL_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SOCIAL_CHANGED_EVENT, onChanged);
  }, [refresh]);

  const setWatching = useCallback((marketId: string, watching: boolean) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (watching) next.add(norm(marketId));
      else next.delete(norm(marketId));
      return next;
    });
  }, []);

  const isWatching = useCallback((marketId: string) => watchlist.has(norm(marketId)), [watchlist]);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/session', { method: 'DELETE' });
    } catch {
      /* clear local state regardless */
    }
    setAddress(null);
    setWatchlist(new Set());
  }, []);

  const requireSignIn = useCallback(() => {
    window.dispatchEvent(new CustomEvent(REQUIRE_SIGNIN_EVENT));
  }, []);

  const value = useMemo<SocialSessionValue>(() => ({
    address,
    isSignedIn: Boolean(address),
    ready,
    watchlist,
    isWatching,
    setWatching,
    refresh,
    signOut,
    requireSignIn,
  }), [address, ready, watchlist, isWatching, setWatching, refresh, signOut, requireSignIn]);

  return (
    <socialSessionContext.Provider value={value}>
      {children}
    </socialSessionContext.Provider>
  );
}

export function useSocialSession() {
  const value = useContext(socialSessionContext);
  if (!value) {
    throw new Error('useSocialSession must be used within SocialSessionProvider');
  }
  return value;
}
