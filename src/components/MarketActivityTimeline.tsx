'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';

type TimelineEventType = 'created' | 'trade' | 'trade_summary' | 'proposed' | 'disputed' | 'settled' | 'canceled';

type TimelineEvent = {
  type: TimelineEventType;
  t: number;
  label: string;
  txHash?: string;
};

const eventTone: Record<TimelineEventType, { dot: string; label: string }> = {
  created: { dot: 'bg-cyan shadow-[0_0_14px_rgba(37,192,244,0.35)]', label: 'Created' },
  trade: { dot: 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.2)]', label: 'Trade' },
  trade_summary: { dot: 'bg-white/45', label: 'Trades' },
  proposed: { dot: 'bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.25)]', label: 'Proposed' },
  disputed: { dot: 'bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.28)]', label: 'Disputed' },
  settled: { dot: 'bg-mint shadow-[0_0_12px_rgba(52,211,153,0.25)]', label: 'Settled' },
  canceled: { dot: 'bg-red-300 shadow-[0_0_12px_rgba(252,165,165,0.24)]', label: 'Canceled' },
};

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
}

export function MarketActivityTimeline({ marketId }: { marketId: string }) {
  const rootRef = useRef<HTMLElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;
    if (!('IntersectionObserver' in window)) {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad || !marketId) return undefined;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/markets/${marketId}/timeline`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Timeline unavailable.'))))
      .then((data) => {
        if (cancelled) return;
        setEvents(Array.isArray(data?.events) ? data.events : []);
        setError('');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Timeline unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, shouldLoad]);

  const visibleEvents = useMemo(() => events.filter((event) => Number.isFinite(event.t)), [events]);
  const hasEvents = visibleEvents.length > 0;

  return (
    <section ref={rootRef} className="mt-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan">Activity timeline</p>
          <h2 className="mt-1 text-base font-black text-white">Market events</h2>
        </div>
        {loading ? <span className="text-[11px] font-black uppercase tracking-[0.14em] text-muted">Loading</span> : null}
      </div>

      <div className="mt-5">
        {!shouldLoad || loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
                <span className="h-4 w-2/3 rounded bg-white/[0.04]" />
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="text-sm font-bold text-muted">{error}</p>
        ) : !hasEvents ? (
          <p className="text-sm font-bold text-muted">No on-chain activity yet.</p>
        ) : (
          <ol className="relative space-y-4 before:absolute before:left-[5px] before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-white/[0.08]">
            {visibleEvents.map((event, index) => {
              const tone = eventTone[event.type] ?? eventTone.trade;
              return (
                <li key={`${event.type}-${event.t}-${index}`} className="relative flex gap-3 pl-0">
                  <span className={`relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[10px] font-black uppercase tracking-[0.14em] text-[#7f92ad]">{tone.label}</span>
                      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-[#475569]">{timeAgo(event.t)}</span>
                      {event.txHash ? (
                        <a
                          href={`https://testnet.arcscan.app/tx/${event.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.12em] text-cyan hover:opacity-80"
                        >
                          {shortHash(event.txHash)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm font-bold leading-5 text-[#d6e2f2]">{event.label}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
