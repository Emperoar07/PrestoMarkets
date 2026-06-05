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

export type NotificationItem = {
  id: number;
  type: string;
  title: string;
  body: string;
  marketId: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

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
  notifications: NotificationItem[];
  unreadCount: number;
  refreshNotifications: () => Promise<void>;
  markNotificationsRead: (ids?: number[]) => Promise<void>;
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
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

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

  const refreshNotifications = useCallback(async () => {
    if (!address) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({ notifications: [], unreadCount: 0 }));
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      /* best-effort */
    }
  }, [address]);

  const markNotificationsRead = useCallback(async (ids?: number[]) => {
    // Optimistic: clear the badge immediately.
    setNotifications((prev) => prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    setUnreadCount((prev) => (ids ? Math.max(0, prev - ids.length) : 0));
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      });
    } catch {
      /* best-effort */
    }
  }, []);

  // Poll notifications while signed in (every 45s), and refresh on sign-in changes.
  useEffect(() => {
    if (!address) {
      setNotifications([]);
      setUnreadCount(0);
      return undefined;
    }
    void refreshNotifications();
    const interval = window.setInterval(() => void refreshNotifications(), 45_000);
    return () => window.clearInterval(interval);
  }, [address, refreshNotifications]);

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
    notifications,
    unreadCount,
    refreshNotifications,
    markNotificationsRead,
  }), [address, ready, watchlist, isWatching, setWatching, refresh, signOut, requireSignIn, notifications, unreadCount, refreshNotifications, markNotificationsRead]);

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
