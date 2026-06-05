'use client';

import { useState } from 'react';
import type { MouseEvent } from 'react';
import { Star } from 'lucide-react';
import { useSocialSession } from '@/lib/socialSessionContext';

export function WatchlistButton({ marketId }: { marketId: string }) {
  const { isSignedIn, isWatching, setWatching, requireSignIn } = useSocialSession();
  const [isSaving, setIsSaving] = useState(false);

  const watching = isWatching(marketId);

  async function toggle(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (isSaving) return;

    if (!isSignedIn) {
      requireSignIn();
      return;
    }

    const next = !watching;
    setIsSaving(true);
    setWatching(marketId, next); // optimistic
    try {
      const res = await fetch('/api/watchlist', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId }),
      });
      if (res.status === 401) {
        setWatching(marketId, !next); // revert
        requireSignIn();
      } else if (!res.ok) {
        setWatching(marketId, !next); // revert
      }
    } catch {
      setWatching(marketId, !next); // revert
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={watching ? 'Remove from watchlist' : 'Add to watchlist'}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border transition-colors ${
        watching
          ? 'border-cyan/30 bg-cyan/10 text-cyan'
          : 'border-white/[0.06] bg-white/[0.02] text-[#475569] hover:text-cyan'
      }`}
    >
      <Star className="h-3.5 w-3.5" fill={watching ? 'currentColor' : 'none'} />
    </button>
  );
}
