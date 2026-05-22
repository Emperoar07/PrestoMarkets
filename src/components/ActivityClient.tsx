'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppState } from '@/lib/appState';
import type { PortfolioActivity } from '@/lib/portfolio';

type Filter = 'all' | 'create' | 'out' | 'win' | 'refund' | 'in';

const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'create', label: 'Created' },
  { id: 'out', label: 'Bought' },
  { id: 'win', label: 'Won' },
  { id: 'refund', label: 'Refunded' },
  { id: 'in', label: 'In' },
];

const ARC_EXPLORER_BASE = 'https://testnet.arcscan.app/tx/';
const PAGE_SIZE = 10;

type ActivityResponse = {
  ok: boolean;
  items?: PortfolioActivity[];
  nextCursor?: string | null;
  error?: string;
};

function iconFor(kind: PortfolioActivity['kind']) {
  if (kind === 'create') return { glyph: '+', tone: 'text-cyan', bg: 'bg-cyan/10' };
  if (kind === 'win') return { glyph: '^', tone: 'text-mint', bg: 'bg-mint/10' };
  if (kind === 'refund') return { glyph: '~', tone: 'text-cyan', bg: 'bg-cyan/10' };
  if (kind === 'in') return { glyph: 'v', tone: 'text-cyan', bg: 'bg-cyan/10' };
  return { glyph: '^', tone: 'text-red-300', bg: 'bg-red-400/10' };
}

function headlineFor(item: PortfolioActivity): string {
  if (item.kind === 'create') return 'Created market';
  if (item.kind === 'win') return `Won ${item.detail}`;
  if (item.kind === 'refund') return `Refunded ${item.detail}`;
  if (item.kind === 'in') return `Received ${item.detail}`;
  return `${item.label} - ${item.detail}`;
}

export function ActivityClient() {
  const { connectedWallet } = useAppState();
  const [activity, setActivity] = useState<PortfolioActivity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadActivity = useCallback(async (nextCursor?: string | null) => {
    if (!connectedWallet?.address) return;

    if (nextCursor) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setActivity([]);
      setCursor(null);
    }
    setError(null);

    try {
      const params = new URLSearchParams({
        account: connectedWallet.address,
        limit: PAGE_SIZE.toString(),
      });
      if (nextCursor) params.set('cursor', nextCursor);

      const response = await fetch(`/api/activity?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json() as ActivityResponse;

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Unable to load activity.');
      }

      setActivity((current) => nextCursor ? [...current, ...(data.items ?? [])] : data.items ?? []);
      setCursor(data.nextCursor ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load activity.');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [connectedWallet?.address]);

  useEffect(() => {
    if (!connectedWallet?.address) {
      setActivity([]);
      setCursor(null);
      setError(null);
      return;
    }

    void loadActivity(null);
  }, [connectedWallet?.address, loadActivity]);

  const visible = useMemo(() => {
    if (filter === 'all') return activity;
    return activity.filter((item) => item.kind === filter);
  }, [activity, filter]);

  const counts = useMemo(() => {
    const out = { all: activity.length, create: 0, out: 0, win: 0, refund: 0, in: 0 } as Record<Filter, number>;
    for (const item of activity) out[item.kind] += 1;
    return out;
  }, [activity]);

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20 pt-36 md:px-6 md:pt-44">
      <h1 className="text-[clamp(28px,3.5vw,40px)] font-black tracking-tight text-white">Activity.</h1>
      <p className="mt-3 text-[15px] leading-7 text-muted">
        Every trade, win, and refund tied to this wallet. Pulled live from Arc Testnet logs.
      </p>

      {!connectedWallet ? (
        <p className="mt-16 rounded-[10px] border border-white/[0.06] bg-[#0b1322] px-5 py-8 text-center text-[14px] text-muted">
          Connect a wallet to see your activity.
        </p>
      ) : (
        <>
          <div className="mt-10 flex flex-wrap gap-2 border-b border-white/[0.06] pb-4">
            {filters.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`flex items-baseline gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-black transition-colors ${
                  filter === id
                    ? 'border-cyan/50 bg-cyan/10 text-cyan'
                    : 'border-white/[0.08] text-muted hover:border-white/20 hover:text-white/80'
                }`}
              >
                <span>{label}</span>
                <span className="text-[10px] opacity-60">{counts[id]}</span>
              </button>
            ))}
          </div>

          {isLoading && activity.length === 0 ? (
            <p className="mt-12 text-center text-[14px] text-muted">Loading latest activity...</p>
          ) : error ? (
            <p className="mt-12 rounded-[10px] border border-red-400/20 bg-red-500/10 px-5 py-6 text-center text-[14px] text-red-100">
              {error}
            </p>
          ) : visible.length === 0 ? (
            <p className="mt-12 text-center text-[14px] text-muted">
              {filter === 'all'
                ? 'No trades yet. Your buys, wins, and refunds will appear here as they confirm onchain.'
                : `No ${filters.find((f) => f.id === filter)?.label.toLowerCase()} activity yet.`}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-white/[0.04]">
              {visible.map((item, idx) => {
                const icon = iconFor(item.kind);
                const headline = headlineFor(item);
                return (
                  <li key={`${item.txHash ?? idx}-${idx}`} className="py-4">
                    <div className="flex items-start gap-4">
                      <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-black ${icon.tone} ${icon.bg}`}>
                        {icon.glyph}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-black text-white">{headline}</p>
                        <p className="mt-1 truncate text-[13px] text-muted">{item.market}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                        <span className="text-[11px] uppercase tracking-widest text-muted/70">{item.status}</span>
                        <span className="text-[11px] text-muted/60">{item.time}</span>
                        {item.txHash ? (
                          <a
                            href={`${ARC_EXPLORER_BASE}${item.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] font-bold text-cyan/80 transition-colors hover:text-cyan"
                          >
                            explorer
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {activity.length > 0 ? (
            <div className="mt-10 flex flex-col items-center gap-3 text-center">
              {cursor ? (
                <button
                  type="button"
                  onClick={() => void loadActivity(cursor)}
                  disabled={isLoadingMore}
                  className="rounded-full border border-cyan/40 bg-cyan/10 px-5 py-2 text-[12px] font-black text-cyan transition hover:bg-cyan/15 disabled:cursor-wait disabled:opacity-60"
                >
                  {isLoadingMore ? 'Loading...' : 'See more'}
                </button>
              ) : null}
              <p className="text-[12px] text-muted/70">
                Showing {activity.length} row{activity.length === 1 ? '' : 's'} from Arc logs. Position values live on{' '}
                <Link href="/portfolio" className="font-bold text-cyan/80 hover:text-cyan">
                  portfolio
                </Link>
                .
              </p>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
