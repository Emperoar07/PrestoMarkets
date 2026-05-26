'use client';

import { memo, useEffect, useState } from 'react';

type Props = {
  closeDate?: string;
  className?: string;
  prefix?: string;
};

function formatRemaining(diffMs: number): string {
  if (diffMs <= 0) return 'Closed';

  const seconds = Math.floor(diffMs / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 1) return `${minutes}m`;
  return `${seconds}s`;
}

function CountdownComponent({ closeDate, className, prefix }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!closeDate) return undefined;
    // Tick every second when close is near (<1h), otherwise every 30s. Cheap either way.
    const intervalMs = Number(new Date(closeDate)) - Date.now() < 3_600_000 ? 1_000 : 30_000;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [closeDate]);

  if (!closeDate) return null;
  const closeMs = Number(new Date(closeDate));
  if (!Number.isFinite(closeMs)) return null;

  return <span className={className}>{prefix ?? ''}{formatRemaining(closeMs - now)}</span>;
}

export const Countdown = memo(CountdownComponent, (prev, next) => {
  // Only re-render if closeDate or className/prefix changed (not on parent re-render)
  return prev.closeDate === next.closeDate && prev.className === next.className && prev.prefix === next.prefix;
});
