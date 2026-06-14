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
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border transition-colors ${
        watching
          ? 'border-cyan/30 bg-cyan/10 text-cyan hover:bg-cyan/15'
          : 'border-white/[0.08] bg-white/[0.02] text-[#8fa0b4] hover:border-cyan/30 hover:bg-cyan/5 hover:text-cyan'
      }`}
    >
      <Star className="h-4 w-4" fill={watching ? 'currentColor' : 'none'} />
    </button>
  );
}
