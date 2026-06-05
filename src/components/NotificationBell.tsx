'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { useSocialSession } from '@/lib/socialSessionContext';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const { isSignedIn, notifications, unreadCount, markNotificationsRead, refreshNotifications } = useSocialSession();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!isSignedIn) return null;

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
      void refreshNotifications();
    }
    setOpen((v) => !v);
  }

  function openItem(id: number, marketId: string | null, link: string | null) {
    void markNotificationsRead([id]);
    setOpen(false);
    if (link) router.push(link);
    else if (marketId) router.push(`/markets/${marketId}`);
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[#94a3b8] transition-colors hover:border-cyan/30 hover:text-white"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan px-1 text-[10px] font-black text-[#07111f]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popRef}
              style={{ position: 'fixed', top: pos.top, right: pos.right, width: '340px' }}
              className="z-[80] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/50"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                <p className="text-sm font-black text-white">Notifications</p>
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => void markNotificationsRead()}
                    className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan hover:opacity-80"
                  >
                    Mark all read
                  </button>
                ) : null}
              </div>
              <div className="max-h-[60vh] overflow-y-auto divide-y divide-white/[0.05]">
                {notifications.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted">No notifications yet.</p>
                ) : notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openItem(n.id, n.marketId, n.link)}
                    className={`block w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.03] ${n.read ? '' : 'bg-cyan/[0.04]'}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" /> : <span className="mt-1.5 h-1.5 w-1.5 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold text-[#e2e8f0] leading-snug">{n.title}</p>
                        {n.body ? <p className="mt-0.5 text-xs text-muted leading-snug line-clamp-2">{n.body}</p> : null}
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#475569]">{timeAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
