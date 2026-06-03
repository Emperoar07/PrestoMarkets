'use client';

import { useState } from 'react';
import type { MouseEvent } from 'react';
import { Star } from 'lucide-react';

export function WatchlistButton({ marketId }: { marketId: string }) {
  const [isWatching, setIsWatching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function toggle(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (isSaving) return;
    const next = !isWatching;
    setIsSaving(true);
    setIsWatching(next);
    try {
      const res = await fetch('/api/watchlist', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId }),
      });
      if (!res.ok) setIsWatching(!next);
    } catch {
      setIsWatching(!next);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={isWatching ? 'Remove from watchlist' : 'Add to watchlist'}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border transition-colors ${
        isWatching
          ? 'border-cyan/30 bg-cyan/10 text-cyan'
          : 'border-white/[0.06] bg-white/[0.02] text-[#475569] hover:text-cyan'
      }`}
    >
      <Star className="h-3.5 w-3.5" fill={isWatching ? 'currentColor' : 'none'} />
    </button>
  );
}
