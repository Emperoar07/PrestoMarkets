'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppState } from '@/lib/appState';
import type { PortfolioActivity } from '@/lib/portfolio';
import { readCompletedMoves, GATEWAY_SOURCES } from '@/lib/gatewayActions';
import { ArrowDownLeft, ArrowUpDown, Award, Coins, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { FilterDropdown } from './FilterDropdown';

type Filter = 'all' | 'create' | 'out' | 'win' | 'refund' | 'in';
type ActivitySort = 'newest' | 'oldest' | 'amount';

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
  if (kind === 'create') return { icon: Plus, tone: 'text-cyan bg-cyan/10' };
  if (kind === 'win') return { icon: Award, tone: 'text-emerald-400 bg-emerald-500/10' };
  if (kind === 'refund') return { icon: RefreshCw, tone: 'text-amber-400 bg-amber-500/10' };
  if (kind === 'in') return { icon: ArrowDownLeft, tone: 'text-cyan bg-cyan/10' };
  return { icon: Coins, tone: 'text-rose-400 bg-rose-500/10' };
}

function headlineFor(item: PortfolioActivity): string {
  if (item.kind === 'create') return 'Created market';
  if (item.kind === 'win') return `Won ${item.detail}`;
  if (item.kind === 'refund') return `Refunded ${item.detail}`;
  if (item.kind === 'in') return `Received ${item.detail}`;
  return `${item.label} - ${item.detail}`;
}

// Recency key for mixed time formats: on-chain rows carry "Block N" (higher = newer), Gateway
// moves carry ISO timestamps. Timestamps (~1.7e12) always exceed block numbers (~5e7), so credits
// float above chain rows at the same "newest" end — matching how the feed prepended them before.
function recencyOf(item: PortfolioActivity): number {
  const blockMatch = /^Block (\d+)/.exec(item.time ?? '');
  if (blockMatch) return Number(blockMatch[1]);
  const parsed = Date.parse(item.time ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function amountOf(item: PortfolioActivity): number {
  const match = /(\d+(?:\.\d+)?)/.exec(item.detail ?? '');
  return match ? parseFloat(match[1]) : 0;
}

// ISO timestamps render as a compact local date; "Block N" stays as-is (linked to the explorer).
function displayTime(time: string): string {
  if (/^Block /.test(time)) return time;
  const parsed = Date.parse(time);
  if (!Number.isFinite(parsed)) return time;
  return new Date(parsed).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function statusBadgeFor(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes('confirm') || normalized.includes('success')) {
    return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  }
  if (normalized.includes('pend')) {
    return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  }
  return 'text-muted/80 bg-white/[0.04] border-white/[0.06]';
}

export function ActivityClient() {
  const { connectedWallet } = useAppState();
  const [activity, setActivity] = useState<PortfolioActivity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<ActivitySort>('newest');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadActivity = useCallback(async (nextCursor?: string | null, hop = 0) => {
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

      const onchain = data.items ?? [];
      if (nextCursor) {
        setActivity((current) => [...current, ...onchain]);
      } else {
        // Prepend client-recorded Move-to-Arc credits (Gateway mints aren't Presto market events,
        // so the on-chain feed never sees them). Newest first.
        const moves: PortfolioActivity[] = readCompletedMoves(connectedWallet.address)
          .map((m) => ({
            label: 'Move to Arc',
            market: `${GATEWAY_SOURCES[m.source]?.label ?? m.source} → Arc`,
            detail: `$${m.amountUsdc.toFixed(2)}`,
            status: 'Confirmed' as const,
            time: new Date(m.at).toISOString(),
            kind: 'in' as const,
            txHash: m.txHash || undefined,
          }));
        setActivity([...moves, ...onchain]);
      }
      setCursor(data.nextCursor ?? null);
      // The API scans a bounded block window per request; an account whose history sits deeper
      // returns an EMPTY page with a continue-cursor. Auto-follow a few of those so the user isn't
      // clicking "See more" through blank windows before their first real row appears.
      if ((onchain.length === 0) && data.nextCursor && hop < 3) {
        await loadActivity(data.nextCursor, hop + 1);
        return;
      }
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
    const filtered = filter === 'all' ? [...activity] : activity.filter((item) => item.kind === filter);
    if (sort === 'amount') return filtered.sort((a, b) => amountOf(b) - amountOf(a));
    if (sort === 'oldest') return filtered.sort((a, b) => recencyOf(a) - recencyOf(b));
    return filtered.sort((a, b) => recencyOf(b) - recencyOf(a));
  }, [activity, filter, sort]);

  const counts = useMemo(() => {
    const out = { all: activity.length, create: 0, out: 0, win: 0, refund: 0, in: 0 } as Record<Filter, number>;
    for (const item of activity) out[item.kind] += 1;
    return out;
  }, [activity]);

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20 pt-36 md:px-6 md:pt-44">
      <h1 className="text-[clamp(28px,3.5vw,40px)] font-black tracking-tight text-white">Activity</h1>
      <p className="mt-3 text-[15px] leading-7 text-muted">
        Every trade, win, and refund tied to this wallet. Pulled live from Arc Testnet logs.
      </p>

      {!connectedWallet ? (
        <div className="mt-12 flex flex-col items-center justify-center rounded-xl border border-white/[0.06] bg-[#0b1322]/80 px-6 py-12 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan/10 text-cyan mb-4">
            <Coins className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-white">Connect wallet</h3>
          <p className="mt-2 text-sm text-[#94a3b8] max-w-sm leading-relaxed">
            Connect a wallet to view your portfolio transaction, trade, and reward logs.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-5">
            <div className="flex flex-wrap gap-2">
            {filters.map(({ id, label }) => {
              const isActive = filter === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[12.5px] font-bold transition-all duration-200 ${
                    isActive
                      ? 'bg-cyan text-[#07111f] shadow-lg shadow-cyan/10'
                      : 'text-[#94a3b8] hover:bg-white/[0.04] hover:text-[#f1f5f9]'
                  }`}
                >
                  <span>{label}</span>
                  <span className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-extrabold ${
                    isActive ? 'bg-[#07111f]/20 text-[#07111f]' : 'bg-white/[0.06] text-[#64748b]'
                  }`}>
                    {counts[id]}
                  </span>
                </button>
              );
            })}
            </div>
            <FilterDropdown
              icon={ArrowUpDown}
              heading="Sort by"
              align="right"
              value={sort}
              onChange={setSort}
              options={[
                { key: 'newest', label: 'Newest first', hint: 'Latest transactions on top' },
                { key: 'oldest', label: 'Oldest first', hint: 'Earliest transactions on top' },
                { key: 'amount', label: 'Amount', hint: 'Largest value first' },
              ]}
            />
          </div>

          {isLoading && activity.length === 0 ? (
            <p className="mt-12 text-center text-[14px] text-muted">Loading latest activity...</p>
          ) : error ? (
            <p className="mt-12 rounded-[10px] border border-red-400/20 bg-red-500/10 px-5 py-6 text-center text-[14px] text-red-100">
              {error}
            </p>
          ) : visible.length === 0 ? (
            <p className="mt-12 text-center text-[14px] text-muted">
              {filter !== 'all'
                ? `No ${filters.find((f) => f.id === filter)?.label.toLowerCase()} activity yet.`
                : cursor
                  ? 'Nothing in the recent block window — use "See more" below to scan older history.'
                  : 'No trades yet. Your buys, wins, and refunds will appear here as they confirm onchain.'}
            </p>
          ) : (
            <div className="mt-6 flex flex-col gap-3">
              {visible.map((item, idx) => {
                const { icon: Icon, tone } = iconFor(item.kind);
                const headline = headlineFor(item);
                return (
                  <div
                    key={`${item.txHash ?? idx}-${idx}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-4 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${tone}`}>
                        <Icon className="h-4.5 w-4.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-bold text-white leading-normal break-words">{headline}</p>
                        <p className="mt-1 truncate text-[12.5px] text-[#94a3b8]">{item.market}</p>
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2.5 pt-3 sm:pt-0 border-t border-white/[0.04] sm:border-none">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-extrabold tracking-wide uppercase ${statusBadgeFor(item.status)}`}>
                          {item.status}
                        </span>
                        <span className="text-[11px] text-[#64748b]">{displayTime(item.time)}</span>
                      </div>

                      {item.txHash ? (
                        <a
                          href={`${ARC_EXPLORER_BASE}${item.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          title="View transaction on Arc explorer"
                          className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-cyan transition-colors hover:opacity-80"
                        >
                          <span>{shortHash(item.txHash)}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activity.length > 0 || cursor ? (
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
