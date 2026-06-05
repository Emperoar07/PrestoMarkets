'use client';

import { useEffect, useState, useRef, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bell } from 'lucide-react';
import { useSocialSession } from '@/lib/socialSessionContext';

const labels = [
  ['closeSoon', 'Close soon'],
  ['priceMove', 'Price move'],
  ['resolved', 'Resolved'],
  ['claim', 'Claimable'],
] as const;

type AlertTypes = Record<(typeof labels)[number][0], boolean>;

const emptyPrefs: AlertTypes = {
  closeSoon: false,
  priceMove: false,
  resolved: false,
  claim: false,
};

type PopoverPos = { top?: number; bottom?: number; right: number };

export function AlertPrefsControl({ marketId }: { marketId: string }) {
  const { isSignedIn, requireSignIn } = useSocialSession();
  const [prefs, setPrefs] = useState<AlertTypes>(emptyPrefs);
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/alerts/prefs?marketId=${encodeURIComponent(marketId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (!cancelled && res.ok && data.prefs?.types) setPrefs(data.prefs.types);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [marketId]);

  async function save(next: AlertTypes) {
    if (!isSignedIn) {
      requireSignIn();
      return;
    }
    setPrefs(next);
    setIsSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/alerts/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId, types: next, channel: 'inapp' }),
      });
      if (res.status === 401) {
        requireSignIn();
        throw new Error('Sign in to set alerts.');
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Alerts could not be saved.');
      setMessage('Alerts saved.');
      window.setTimeout(() => setMessage(''), 1500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Alerts could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  function toggleOpen(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const right = Math.max(16, window.innerWidth - rect.right);
    const openUp = rect.bottom + 260 > window.innerHeight;
    setPos(openUp ? { bottom: window.innerHeight - rect.top + 8, right } : { top: rect.bottom + 8, right });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: globalThis.MouseEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const hasActiveAlerts = Object.values(prefs).some(Boolean);

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-label="Alert preferences"
        title="Alert preferences"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-cyan/30 bg-cyan/10 text-cyan transition-colors hover:bg-cyan/15"
      >
        <Bell className="h-4 w-4" />
        {hasActiveAlerts && (
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-cyan ring-1 ring-[#07111f]" />
        )}
      </button>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, right: pos.right, width: '280px' }}
              className="z-[60] rounded-[14px] border border-white/[0.08] bg-[#141e30] p-4 shadow-2xl shadow-black/40"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan">Alerts</p>
              <p className="mt-1 text-xs text-muted">Get notified on key market events.</p>
              {!isSignedIn ? (
                <button
                  type="button"
                  onClick={() => requireSignIn()}
                  className="mt-3 w-full rounded-[8px] border border-cyan/30 bg-cyan/10 px-3 py-2 text-xs font-black text-cyan transition-colors hover:bg-cyan/15"
                >
                  Sign in to set alerts
                </button>
              ) : null}
              <div className="mt-3.5 space-y-2">
                {labels.map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2.5 text-xs font-bold text-[#cbd5e1] cursor-pointer hover:border-cyan/15 transition-colors">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={prefs[key]}
                      disabled={isSaving}
                      onChange={(event) => void save({ ...prefs, [key]: event.target.checked })}
                      className="accent-cyan cursor-pointer"
                    />
                  </label>
                ))}
              </div>
              {message && (
                <p className="mt-2.5 text-[10px] text-cyan font-bold text-center">{message}</p>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
