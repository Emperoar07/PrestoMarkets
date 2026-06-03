'use client';

import { useEffect, useState } from 'react';

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

export function AlertPrefsControl({ marketId }: { marketId: string }) {
  const [prefs, setPrefs] = useState<AlertTypes>(emptyPrefs);
  const [message, setMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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
    setPrefs(next);
    setIsSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/alerts/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId, types: next, channel: 'inapp' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Alerts could not be saved.');
      setMessage('Alerts saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Alerts could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="mt-8 rounded-[14px] border border-white/[0.06] bg-[#111b2b] p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan">Alerts</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {labels.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-3 rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-sm font-bold text-[#cbd5e1]">
            <span>{label}</span>
            <input
              type="checkbox"
              checked={prefs[key]}
              disabled={isSaving}
              onChange={(event) => void save({ ...prefs, [key]: event.target.checked })}
              className="accent-cyan"
            />
          </label>
        ))}
      </div>
      {message ? <p className="mt-3 text-xs text-muted">{message}</p> : null}
    </section>
  );
}
