'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { useSocialSession } from '@/lib/socialSessionContext';
import { isAdminAddress } from '@/lib/adminAuth';
import { getStoredConnectedWallet, subscribeConnectedWallet, type ConnectedWallet } from '@/lib/walletProvider';

type AgentMarket = {
  id: string;
  title: string;
  status: string;
  amm: boolean;
  volume: string;
  closeDate: string;
  outcomes: string[];
  paused: boolean;
  proposal: { outcomeLabel: string; disputed: boolean } | null;
  createdAt?: string;
};

type AdminData = {
  agentAddress: string | null;
  guardianAddress: string | null;
  agentBalance: string;
  ticks: string[];
  counts: Record<string, number>;
  markets: AgentMarket[];
  ledgerOnly: AgentMarket[];
};

const TICK_LABELS: Record<string, string> = {
  'create-market': 'Run agent create tick',
  'auto-resolve': 'Run auto-resolve',
  'backfill-images': 'Backfill images',
  'ingest-markets': 'Ingest new markets',
  'seed-open': 'Seed open markets',
  'pause-decided': 'Pause decided',
  'dedupe': 'Dedupe markets',
  'withdraw-fees': 'Withdraw fees',
  'market-snapshots': 'Snapshot odds',
  'agent-fund': 'Fund agent',
  'leaderboard': 'Rebuild leaderboard',
};

// Turn a cron's JSON result into a one-line human summary for the tick button.
function summarizeTick(result: unknown, ok: boolean): string {
  if (!result || typeof result !== 'object') return ok ? 'done' : 'failed';
  const r = result as Record<string, unknown>;
  if (r.skipped) return `skipped (${String(r.skipped)})`;
  if (r.error) return String(r.error).slice(0, 60);
  const parts: string[] = [];
  const add = (label: string, key: string) => { const v = r[key]; if (typeof v === 'number' && v > 0) parts.push(`${v} ${label}`); };
  add('created', 'created'); add('resolved', 'resolved'); add('proposed', 'proposed'); add('canceled', 'canceled');
  add('ingested', 'ingested'); add('hydrated', 'hydrated'); add('processed', 'processedCount');
  add('seeded', 'marketsSeeded'); add('swept', 'sweptCount'); add('paused', 'pausedCount'); add('snapshotted', 'marketsSnapshotted');
  // Result arrays (e.g. auto-resolve results, dedupe plan) — report how many the run touched.
  if (parts.length === 0) {
    if (typeof r.expired === 'number') parts.push(`${r.expired} expired scanned`);
    if (Array.isArray(r.plan)) parts.push(`${r.plan.length} dup(s) found`);
    if (typeof r.dripped === 'boolean') parts.push(r.dripped ? 'funded' : 'no drip needed');
  }
  return parts.length ? parts.join(', ') : (ok ? 'done, nothing to do' : 'failed');
}

const badgeClass = (status: string) =>
  status === 'Resolved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
  : status === 'Canceled' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
  : status === 'Closed' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  : 'bg-cyan/10 text-cyan border-cyan/20';

export function AdminConsole() {
  const { address: sessionAddress, isSignedIn, requireSignIn } = useSocialSession();
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<Array<{ t: number; msg: string; ok: boolean }>>([]);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'volume' | 'title' | 'status' | 'closing'>('newest');
  const [filterStatus, setFilterStatus] = useState<'all' | 'Open' | 'Closed' | 'Resolved' | 'Canceled'>('all');
  const [search, setSearch] = useState('');
  // Multiple ticks can run at once — each keyed by its own start time.
  const [running, setRunning] = useState<Record<string, number>>({});
  const [nowMs, setNowMs] = useState(0);
  const [tickResults, setTickResults] = useState<Record<string, { ok: boolean; summary: string; detail: unknown; at: number }>>({});
  const [expandedTick, setExpandedTick] = useState<string | null>(null);
  const anyRunning = Object.keys(running).length > 0;

  // Elapsed-time ticker while any cron tick runs, so buttons show live progress (they take 60-250s).
  useEffect(() => {
    if (!anyRunning) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [anyRunning]);

  useEffect(() => {
    setWallet(getStoredConnectedWallet());
    return subscribeConnectedWallet(setWallet);
  }, []);

  const connectedIsAdmin = isAdminAddress(wallet?.address);
  const sessionIsAdmin = isAdminAddress(sessionAddress) && isSignedIn;

  const pushLog = useCallback((msg: string, ok: boolean) => {
    setLog((prev) => [{ t: Date.now(), msg, ok }, ...prev].slice(0, 40));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/agent', { cache: 'no-store' });
      if (res.status === 403) { setData(null); return; }
      const json = await res.json();
      if (json.ok) setData(json);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (sessionIsAdmin) void refresh(); }, [sessionIsAdmin, refresh]);

  const call = useCallback(async (label: string, body: Record<string, unknown>) => {
    setBusy(label);
    try {
      const res = await fetch('/api/admin/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      const ok = res.ok && json.ok !== false;
      const detail = json.txHash ? `tx ${String(json.txHash).slice(0, 12)}…`
        : json.result ? JSON.stringify(json.result).slice(0, 160)
        : json.error ?? (ok ? 'done' : `HTTP ${res.status}`);
      pushLog(`${label}: ${ok ? '✓' : '✗'} ${detail}`, ok);
      void refresh();
      return { ok, json };
    } catch (err) {
      pushLog(`${label}: ✗ ${err instanceof Error ? err.message : 'failed'}`, false);
      return { ok: false, json: {} };
    } finally { setBusy(null); }
  }, [pushLog, refresh]);

  // Run a cron tick. Concurrent-safe: only blocks re-running the SAME tick; different ticks run in
  // parallel. Records the full result so the card can show the per-action outcome detail. Does NOT
  // go through the shared `busy` gate (which is for one-at-a-time per-market actions).
  const runTick = useCallback(async (tick: string) => {
    if (running[tick]) return;
    setRunning((p) => ({ ...p, [tick]: Date.now() }));
    try {
      const res = await fetch('/api/admin/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'tick', tick }),
      });
      const json = await res.json().catch(() => ({}));
      const ok = res.ok && json.ok !== false;
      const detail = (json as { result?: unknown }).result ?? json;
      const summary = summarizeTick(detail, ok);
      setTickResults((prev) => ({ ...prev, [tick]: { ok, summary, detail, at: Date.now() } }));
      pushLog(`${TICK_LABELS[tick] ?? tick}: ${ok ? '✓' : '✗'} ${summary}`, ok);
      void refresh();
    } catch (err) {
      const summary = err instanceof Error ? err.message : 'failed';
      setTickResults((prev) => ({ ...prev, [tick]: { ok: false, summary, detail: null, at: Date.now() } }));
      pushLog(`${TICK_LABELS[tick] ?? tick}: ✗ ${summary}`, false);
    } finally {
      setRunning((prev) => { const next = { ...prev }; delete next[tick]; return next; });
    }
  }, [running, pushLog, refresh]);

  // Combined, filtered, searched, sorted creations list. Must run before the early returns below
  // to satisfy the rules of hooks.
  const visibleMarkets = useMemo(() => {
    const all: AgentMarket[] = [...(data?.markets ?? []), ...(data?.ledgerOnly ?? [])];
    const parseVol = (v?: string) => {
      if (!v) return 0;
      const n = parseFloat(v.replace(/[^0-9.]/g, ''));
      const mult = /k/i.test(v) ? 1e3 : /m/i.test(v) ? 1e6 : 1;
      return (Number.isFinite(n) ? n : 0) * mult;
    };
    // Actionable-first for status sort: Closed (awaiting resolve) → live → resolved → canceled.
    const rank = (s: string) => (s === 'Closed' ? 0 : s === 'Open' || s === 'Closing soon' ? 1 : s === 'Resolved' ? 2 : s === 'Canceled' ? 3 : 4);
    const time = (m: AgentMarket) => new Date(m.createdAt || m.closeDate || 0).getTime() || 0;
    const q = search.trim().toLowerCase();
    const filtered = all.filter((m) => {
      if (q && !m.title.toLowerCase().includes(q)) return false;
      if (filterStatus === 'all') return true;
      if (filterStatus === 'Open') return m.status === 'Open' || m.status === 'Closing soon';
      return m.status === filterStatus;
    });
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'newest': return time(b) - time(a);
        case 'oldest': return time(a) - time(b);
        case 'volume': return parseVol(b.volume) - parseVol(a.volume);
        case 'title': return a.title.localeCompare(b.title);
        case 'status': return rank(a.status) - rank(b.status);
        case 'closing': return new Date(a.closeDate || 0).getTime() - new Date(b.closeDate || 0).getTime();
        default: return 0;
      }
    });
  }, [data, search, filterStatus, sortBy]);

  // ── Access gates ──
  if (!connectedIsAdmin) {
    return (
      <Shell>
        <div className="rounded-xl border border-white/[0.06] bg-[#0d1626]/40 p-8 text-center">
          <h1 className="text-xl font-black text-white">Admin only</h1>
          <p className="mt-2 text-sm text-[#94a3b8]">
            {wallet ? 'This wallet is not an admin.' : 'Connect the admin wallet to continue.'}
          </p>
        </div>
      </Shell>
    );
  }
  if (!sessionIsAdmin) {
    return (
      <Shell>
        <div className="rounded-xl border border-white/[0.06] bg-[#0d1626]/40 p-8 text-center">
          <h1 className="text-xl font-black text-white">Verify ownership</h1>
          <p className="mt-2 text-sm text-[#94a3b8]">Sign a message to prove you control the admin wallet.</p>
          <button onClick={() => requireSignIn()} className="mt-4 rounded-lg bg-cyan px-5 py-2.5 text-sm font-bold text-black hover:bg-cyan/90">
            Sign in as admin
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-[clamp(24px,3vw,34px)] font-black tracking-tight text-white">Agent Control</h1>
          <p className="text-sm text-[#94a3b8]">Trigger the agent, resolve markets, and manage every agent creation.</p>
        </header>

        {/* Status */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Agent balance" value={data ? `$${data.agentBalance}` : '—'} />
          <Stat label="Agent markets" value={String(data?.counts.agentMarkets ?? '—')} />
          <Stat label="Awaiting resolve" value={String(data?.counts.closed ?? '—')} />
          <Stat label="Resolved" value={String(data?.counts.resolved ?? '—')} />
        </section>
        {data?.agentAddress ? (
          <p className="-mt-2 break-all font-mono text-[11px] text-[#64748b]">agent {data.agentAddress}{data.guardianAddress ? ` · guardian ${data.guardianAddress}` : ''}</p>
        ) : null}

        {/* Ticks — each runs the same /api/cron/* job the matching GitHub workflow runs, now. Multiple
            can run at once; each shows live progress and a clickable outcome detail. */}
        <section className="rounded-xl border border-white/[0.06] bg-[#0d1626]/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[#64748b]">Agent &amp; cron ticks</h2>
            {anyRunning ? <span className="text-[11px] font-bold text-cyan">{Object.keys(running).length} running</span> : null}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {(data?.ticks ?? Object.keys(TICK_LABELS)).map((tick) => {
              const startedAt = running[tick];
              const isRunning = !!startedAt;
              const res = tickResults[tick];
              const elapsed = isRunning ? Math.max(0, Math.floor((nowMs - startedAt) / 1000)) : 0;
              const isOpen = expandedTick === tick;
              return (
                <div key={tick} className={`flex flex-col gap-1 rounded-lg border p-2.5 transition-colors ${isRunning ? 'border-cyan/40 bg-cyan/5' : isOpen ? 'border-cyan/30 bg-white/[0.03]' : 'border-white/[0.08] bg-white/[0.02] hover:border-cyan/40 hover:bg-cyan/[0.06]'}`}>
                  <button
                    onClick={() => void runTick(tick)}
                    className="flex items-center justify-between gap-2 text-left text-xs font-bold text-[#e5edf8]"
                  >
                    <span className="truncate">{TICK_LABELS[tick] ?? tick}</span>
                    {isRunning ? <span className="shrink-0 text-[11px] font-black text-cyan">{elapsed}s</span> : <span className="shrink-0 text-[10px] text-cyan/70">run ▸</span>}
                  </button>
                  {isRunning ? (
                    <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full w-1/3 animate-[admin-progress_1.2s_ease-in-out_infinite] rounded-full bg-cyan" />
                    </div>
                  ) : res ? (
                    <button onClick={() => setExpandedTick(isOpen ? null : tick)} className={`flex items-center justify-between gap-1 text-left text-[10px] font-bold ${res.ok ? 'text-emerald-400/90' : 'text-rose-400/90'}`} title="Show outcome detail">
                      <span className="truncate">{res.ok ? '✓' : '✗'} {res.summary}</span>
                      <span className="shrink-0 text-[#475569]">{isOpen ? '▾' : '▸'}</span>
                    </button>
                  ) : (
                    <span className="text-[10px] text-[#475569]">idle</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Outcome detail for the expanded tick */}
          {expandedTick && tickResults[expandedTick] ? (
            <div className="mt-3 rounded-lg border border-white/[0.08] bg-[#0b1220] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-[#64748b]">{TICK_LABELS[expandedTick] ?? expandedTick} — outcome</span>
                <button onClick={() => setExpandedTick(null)} className="text-[11px] font-bold text-cyan hover:underline">close</button>
              </div>
              <TickDetail detail={tickResults[expandedTick].detail} />
            </div>
          ) : null}
          <style>{`@keyframes admin-progress { 0% { transform: translateX(-120%); } 100% { transform: translateX(400%); } }`}</style>
        </section>

        {/* Create market — human form */}
        <CreateMarketForm onCreate={(draft) => call('Create market', { op: 'create', draft })} busy={!!busy} />

        {/* Markets + per-market actions */}
        <section className="rounded-xl border border-white/[0.06] bg-[#0d1626]/30 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[#64748b]">
              Agent creations · {visibleMarkets.length}{' '}
              <span className="text-[#475569]">of {(data?.markets.length ?? 0) + (data?.ledgerOnly.length ?? 0)}</span>
            </h2>
            <button onClick={() => void refresh()} disabled={loading} className="text-xs font-bold text-cyan hover:underline disabled:opacity-40">{loading ? 'Loading…' : 'Refresh'}</button>
          </div>

          {/* Sort / filter / search controls */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title…"
              className="min-w-[160px] flex-1 rounded border border-white/[0.1] bg-[#0b1220] px-3 py-1.5 text-xs text-white placeholder:text-[#475569] focus:border-cyan/50 focus:outline-none"
            />
            <div className="flex items-center gap-1">
              {(['all', 'Open', 'Closed', 'Resolved', 'Canceled'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`rounded px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                    filterStatus === s ? 'bg-cyan/15 text-cyan border border-cyan/30' : 'border border-white/[0.08] bg-white/[0.03] text-[#94a3b8] hover:text-white'
                  }`}
                >{s === 'all' ? 'All' : s === 'Closed' ? 'Awaiting' : s}</button>
              ))}
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded border border-white/[0.1] bg-[#0b1220] px-2 py-1.5 text-xs font-bold text-white focus:border-cyan/50 focus:outline-none"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="closing">Closing soonest</option>
              <option value="volume">Highest volume</option>
              <option value="status">Status (actionable first)</option>
              <option value="title">Title A–Z</option>
            </select>
          </div>

          <div className="admin-no-scrollbar flex max-h-[560px] flex-col gap-2 overflow-y-auto">
            {visibleMarkets.map((m) => (
              <MarketRow key={m.id} m={m} busy={!!busy} onAction={(action, outcomeIndex, evidenceURI) =>
                call(`${action} ${m.title.slice(0, 24)}`, { op: 'market', action, marketId: m.id, outcomeIndex, evidenceURI })} />
            ))}
            {data && visibleMarkets.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#64748b]">
                {(data.markets.length + data.ledgerOnly.length) === 0 ? 'No agent creations yet.' : 'No markets match the current filter.'}
              </p>
            ) : null}
          </div>
          {/* Scrollable panel with the scrollbar visually hidden (still scrolls via wheel/touch/keys). */}
          <style>{`.admin-no-scrollbar{scrollbar-width:none;-ms-overflow-style:none}.admin-no-scrollbar::-webkit-scrollbar{display:none}`}</style>
        </section>

        {/* Action log */}
        {log.length > 0 ? (
          <section className="rounded-xl border border-white/[0.06] bg-[#0d1626]/30 p-4">
            <h2 className="mb-2 text-[11px] font-extrabold uppercase tracking-wider text-[#64748b]">Recent actions</h2>
            <div className="flex flex-col gap-1 font-mono text-[11px]">
              {log.map((l) => (
                <div key={l.t} className={l.ok ? 'text-emerald-400/90' : 'text-rose-400/90'}>{new Date(l.t).toLocaleTimeString()} — {l.msg}</div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 pb-16 pt-24 md:px-7">{children}</main>
      <SiteFooter />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.05] bg-[#0d1626]/20 p-4">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#64748b]">{label}</p>
      <p className="mt-2 text-xl font-black text-white">{value}</p>
    </div>
  );
}

// Renders a cron tick's full outcome: the top-level counts line, then a per-item list of what the
// run actually did (each market resolved/created/canceled/skipped with its reason), falling back to
// a note/error or raw JSON.
function TickDetail({ detail }: { detail: unknown }) {
  if (!detail || typeof detail !== 'object') return <p className="text-[11px] text-[#94a3b8]">No detail returned.</p>;
  const r = detail as Record<string, unknown>;
  const rawList = Array.isArray(r.results) ? r.results : Array.isArray(r.plan) ? r.plan : Array.isArray(r.updates) ? r.updates : null;
  const counts = Object.entries(r).filter(([k, v]) =>
    (typeof v === 'number' || typeof v === 'boolean') && !['ran', 'ranAt'].includes(k));
  return (
    <div className="flex flex-col gap-2">
      {counts.length > 0 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {counts.slice(0, 10).map(([k, v]) => (
            <span key={k}><span className="text-[#64748b]">{k}:</span> <span className="font-bold text-white">{String(v)}</span></span>
          ))}
        </div>
      ) : null}
      {rawList && rawList.length > 0 ? (
        <div className="admin-no-scrollbar flex max-h-[240px] flex-col gap-1 overflow-y-auto">
          {rawList.map((item, i) => {
            const it = (item ?? {}) as Record<string, unknown>;
            const action = String(it.action ?? '');
            const ok = it.ok !== false && action !== 'skipped' && action !== 'failed';
            const label = String(it.action ?? it.title ?? it.marketId ?? it.cancel ?? `item ${i + 1}`);
            const reason = String(it.reason ?? it.outcome ?? it.error ?? it.txHash ?? it.title ?? '');
            return (
              <div key={i} className="flex items-start gap-2 rounded border border-white/[0.05] bg-white/[0.02] px-2 py-1 text-[10.5px]">
                <span className={ok ? 'text-emerald-400' : 'text-amber-400/80'}>{ok ? '✓' : '•'}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-bold text-[#e5edf8]">{label}</span>
                  {reason && reason !== label ? <span className="text-[#94a3b8]"> — {reason.slice(0, 140)}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : r.note ? (
        <p className="text-[11px] text-amber-300/90">{String(r.note)}</p>
      ) : r.error ? (
        <p className="text-[11px] text-rose-400">{String(r.error)}</p>
      ) : counts.length === 0 ? (
        <pre className="admin-no-scrollbar max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-[10px] text-[#94a3b8]">{JSON.stringify(detail, null, 1).slice(0, 2000)}</pre>
      ) : (
        <p className="text-[11px] text-[#64748b]">Nothing to act on this run.</p>
      )}
    </div>
  );
}

function MarketRow({ m, busy, onAction }: {
  m: AgentMarket;
  busy: boolean;
  onAction: (action: string, outcomeIndex?: number, evidenceURI?: string) => void;
}) {
  const [outcome, setOutcome] = useState(0);
  const [uri, setUri] = useState('');
  const [open, setOpen] = useState(false);
  const isFinal = m.status === 'Resolved' || m.status === 'Canceled';
  const settleable = m.status === 'Open' || m.status === 'Closing soon' || m.status === 'Closed';
  const outcomeLabel = (m.outcomes[outcome] ?? `Outcome ${outcome}`);

  // Irreversible on-chain actions — confirm before firing so a misclick can't settle/refund a market.
  const confirmResolve = () => {
    if (window.confirm(`Resolve "${m.title}"\n\nWinning outcome → ${outcome}: ${outcomeLabel}\n\n${m.amm ? 'This PROPOSES the outcome (settles after the dispute window).' : 'This resolves the market now.'}`)) {
      onAction(m.amm ? 'propose' : 'resolve', outcome, uri);
    }
  };
  const confirmCancel = () => {
    if (window.confirm(`Cancel "${m.title}"?\n\nThis voids the market and refunds all holders. Irreversible.`)) onAction('cancel');
  };
  const confirmClose = () => {
    if (window.confirm(`Close trading on "${m.title}"?\n\nThis pauses the market so no new trades land until it resolves.`)) onAction('pause');
  };

  return (
    <div className="rounded-lg border border-white/[0.06] bg-[#0b1220]/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-extrabold uppercase ${badgeClass(m.status)}`}>{m.status}</span>
          {m.amm ? <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold text-[#94a3b8]">V3</span> : null}
          {m.paused ? <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">PAUSED</span> : null}
          <span className="truncate text-[13px] font-bold text-[#e5edf8]">{m.title}</span>
        </button>

        {/* Always-visible lifecycle actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {!isFinal ? (
            <>
              <select value={outcome} onChange={(e) => setOutcome(Number(e.target.value))} title="Winning outcome for Resolve" className="rounded border border-white/[0.1] bg-[#0b1220] px-1.5 py-1 text-[11px] text-white">
                {(m.outcomes.length ? m.outcomes : ['Outcome 0', 'Outcome 1']).map((o, i) => <option key={i} value={i}>{i}: {o}</option>)}
              </select>
              <Action label={m.amm ? 'Resolve▸' : 'Resolve'} disabled={busy} onClick={confirmResolve} accent />
              {m.amm && !m.paused ? <Action label="Close" disabled={busy} onClick={confirmClose} /> : null}
              <Action label="Cancel" danger disabled={busy} onClick={confirmCancel} />
            </>
          ) : null}
          <button onClick={() => setOpen((v) => !v)} className="rounded px-2 py-1.5 text-[11px] font-bold text-[#94a3b8] hover:text-white" title="More actions">⋯</button>
          <a href={`/markets/${m.id}`} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-cyan hover:underline">view</a>
        </div>
      </div>

      {open ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.06] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold text-[#64748b]">outcome {outcome}: {outcomeLabel}</span>
            <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="evidence URL (optional, used by Resolve/Propose/Settle)" className="flex-1 min-w-[180px] rounded border border-white/[0.1] bg-[#0b1220] px-2 py-1.5 text-xs text-white placeholder:text-[#475569]" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {settleable && m.amm && <Action label="Propose" disabled={busy} onClick={() => onAction('propose', outcome, uri)} />}
            <Action label="Settle" disabled={busy} onClick={() => onAction('settle', outcome, uri)} />
            {m.amm && m.proposal?.disputed && <Action label="Resolve disputed" disabled={busy} onClick={() => onAction('resolveDisputed', outcome, uri)} />}
            {m.amm && <Action label="Seed" disabled={busy} onClick={() => onAction('seed')} />}
            {m.amm && m.paused && <Action label="Unpause" disabled={busy} onClick={() => onAction('unpause')} />}
            {m.amm && <Action label="Withdraw fees" disabled={busy} onClick={() => onAction('withdrawFees')} />}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Action({ label, onClick, disabled, danger, accent }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-40 ${
        accent ? 'border border-cyan/40 bg-cyan/15 text-cyan hover:bg-cyan/25'
        : danger ? 'border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
        : 'border border-white/[0.1] bg-white/[0.04] text-[#e5edf8] hover:border-cyan/40 hover:bg-cyan/10'
      }`}
    >{label}</button>
  );
}

function CreateMarketForm({ onCreate, busy }: { onCreate: (draft: Record<string, unknown>) => void; busy: boolean }) {
  const [type, setType] = useState<'Prediction' | 'Opinion'>('Prediction');
  const [style, setStyle] = useState<'binary' | 'poll'>('binary');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [rules, setRules] = useState('');
  const [source, setSource] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [collateral, setCollateral] = useState<'USDC' | 'EURC'>('USDC');
  const [outcomes, setOutcomes] = useState<string[]>(['', '', '']);
  const [imageURI, setImageURI] = useState('');

  const cleanOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);
  const outcomesValid = style === 'binary' || cleanOutcomes.length >= 3;
  const valid = title.trim() && rules.trim() && source.trim() && closeDate && outcomesValid;

  const submit = () => {
    if (!valid) return;
    onCreate({
      type,
      title: title.trim(),
      description: description.trim() || title.trim(),
      category: category.trim() || 'Prediction',
      closeDate: new Date(closeDate).toISOString(),
      rules: rules.trim(),
      sourceOfTruth: source.trim(),
      resolver: 'Presto Agent',
      resolutionMode: 'Agent assisted',
      imageURI: imageURI.trim() || undefined,
      // Binary deploys YES/NO; Multi-Outcome deploys the custom option set (3+).
      outcomeOptions: style === 'binary' ? ['YES', 'NO'] : cleanOutcomes,
      collateral,
    });
  };

  return (
    <section className="rounded-xl border border-white/[0.06] bg-[#0d1626]/30 p-4">
      <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-[#64748b]">Create a market</h2>

      {/* Market shape — binary vs multi-outcome poll (matches the main create page) */}
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        {([
          ['binary', 'Binary market', 'Tradable YES / NO outcomes.'],
          ['poll', 'Multi-outcome poll', 'Custom options (3+), e.g. teams or candidates.'],
        ] as const).map(([value, label, hint]) => (
          <button
            key={value}
            onClick={() => setStyle(value)}
            className={`rounded-lg border p-3 text-left transition-colors ${style === value ? 'border-cyan/50 bg-cyan/10' : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'}`}
          >
            <p className={`text-sm font-black ${style === value ? 'text-cyan' : 'text-[#e5edf8]'}`}>{label}</p>
            <p className="mt-0.5 text-[11px] text-[#94a3b8]">{hint}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Question / title" full><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={style === 'poll' ? 'Who will win the tournament?' : 'Will X happen by <date>?'} className={inputCls} /></Field>
        <Field label="Description" full><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What traders are forecasting" className={inputCls} /></Field>
        <Field label="Resolution rules" full><textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={2} placeholder="Exactly when each outcome wins, and when it cancels" className={inputCls} /></Field>
        <Field label="Source of truth"><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://official-source…" className={inputCls} /></Field>
        <Field label="Category"><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Football, Crypto, Politics…" className={inputCls} /></Field>
        <Field label="Closes at"><input type="datetime-local" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as 'Prediction' | 'Opinion')} className={inputCls}>
            <option value="Prediction">Prediction</option><option value="Opinion">Opinion</option>
          </select>
        </Field>
        <Field label="Collateral">
          <select value={collateral} onChange={(e) => setCollateral(e.target.value as 'USDC' | 'EURC')} className={inputCls}>
            <option value="USDC">USDC</option><option value="EURC">EURC</option>
          </select>
        </Field>
        <Field label="Image URL (optional)"><input value={imageURI} onChange={(e) => setImageURI(e.target.value)} placeholder="leave blank to auto-resolve" className={inputCls} /></Field>
        {style === 'poll' ? (
          <Field label={`Outcomes (${cleanOutcomes.length}/3+ required)`} full>
            <div className="flex flex-col gap-1.5">
              {outcomes.map((o, i) => (
                <div key={i} className="flex gap-2">
                  <input value={o} onChange={(e) => setOutcomes((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))} placeholder={`Outcome ${i + 1}`} className={inputCls} />
                  {outcomes.length > 2 ? <button onClick={() => setOutcomes((prev) => prev.filter((_, j) => j !== i))} className="rounded border border-rose-500/30 px-2 text-xs text-rose-300">✕</button> : null}
                </div>
              ))}
              <button onClick={() => setOutcomes((prev) => [...prev, ''])} className="self-start text-[11px] font-bold text-cyan hover:underline">+ add outcome</button>
            </div>
          </Field>
        ) : (
          <Field label="Outcomes" full>
            <div className="flex gap-2">
              <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-bold text-emerald-400">YES</span>
              <span className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-400">NO</span>
            </div>
          </Field>
        )}
      </div>
      <button onClick={submit} disabled={!valid || busy} className="mt-4 rounded-lg bg-cyan px-5 py-2.5 text-sm font-black text-black transition-opacity hover:bg-cyan/90 disabled:opacity-40">
        {busy ? 'Working…' : `Create ${style === 'poll' ? 'multi-outcome' : 'binary'} market`}
      </button>
      {!outcomesValid ? <p className="mt-2 text-[11px] font-bold text-amber-400">A multi-outcome poll needs at least 3 filled options.</p> : null}
    </section>
  );
}

const inputCls = 'w-full rounded border border-white/[0.1] bg-[#0b1220] px-3 py-2 text-sm text-white placeholder:text-[#475569] focus:border-cyan/50 focus:outline-none';

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${full ? 'sm:col-span-2' : ''}`}>
      <span className="text-[11px] font-bold uppercase tracking-wide text-[#64748b]">{label}</span>
      {children}
    </label>
  );
}
