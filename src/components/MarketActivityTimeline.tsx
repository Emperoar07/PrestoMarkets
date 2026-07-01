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

const eventTone: Record<TimelineEventType, { dotColor: string; label: string }> = {
  created: { dotColor: 'border-cyan bg-cyan/20 text-cyan', label: 'Created' },
  trade: { dotColor: 'border-slate-400 bg-slate-400/20 text-slate-400', label: 'Trade' },
  trade_summary: { dotColor: 'border-slate-500 bg-slate-500/10 text-slate-500', label: 'Trades' },
  proposed: { dotColor: 'border-amber-400 bg-amber-400/20 text-amber-400', label: 'Proposed' },
  disputed: { dotColor: 'border-red-400 bg-red-400/20 text-red-400', label: 'Disputed' },
  settled: { dotColor: 'border-mint bg-mint/20 text-mint', label: 'Settled' },
  canceled: { dotColor: 'border-rose-400 bg-rose-400/20 text-rose-400', label: 'Canceled' },
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
      {/* Header Container with clean, premium typography */}
      <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan animate-pulse shrink-0" />
            Market Activity
          </h2>
          <p className="mt-0.5 text-[11px] font-medium text-slate-400">On-chain transaction logs and events</p>
        </div>
        {loading ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 animate-pulse">
            Syncing...
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        {!shouldLoad || loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-start gap-3.5 animate-pulse">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-white/[0.08] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 rounded bg-white/[0.04]" />
                  <div className="h-3 w-1/4 rounded bg-white/[0.02]" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="text-xs font-semibold text-slate-500">{error}</p>
        ) : !hasEvents ? (
          <p className="text-xs font-semibold text-slate-500">No on-chain activity yet.</p>
        ) : (
          <ol className="relative space-y-4 before:absolute before:left-[3.5px] before:top-2.5 before:h-[calc(100%-14px)] before:w-px before:bg-gradient-to-b before:from-white/[0.08] before:to-transparent">
            {visibleEvents.map((event, index) => {
              const tone = eventTone[event.type] ?? eventTone.trade;
              return (
                <li key={`${event.type}-${event.t}-${index}`} className="relative flex gap-3.5 pl-0">
                  {/* Subtle selection/status indicator ring */}
                  <span className={`relative z-10 mt-1.5 h-2 w-2 shrink-0 rounded-full border border-current ${tone.dotColor}`} />
                  
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-medium leading-5 text-slate-200">
                        {event.label}
                      </p>
                      <span className="shrink-0 text-[11px] font-medium text-slate-500 mt-0.5">
                        {timeAgo(event.t)}
                      </span>
                    </div>
                    
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                      <span>{tone.label}</span>
                      {event.txHash && (
                        <>
                          <span className="text-slate-700">•</span>
                          <a
                            href={`https://testnet.arcscan.app/tx/${event.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-cyan hover:text-cyan/80 normal-case font-medium tracking-normal transition-colors"
                          >
                            <span>{shortHash(event.txHash)}</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </>
                      )}
                    </div>
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
