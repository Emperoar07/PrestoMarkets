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

        {/* Ticks */}
        <section className="rounded-xl border border-white/[0.06] bg-[#0d1626]/30 p-4">
          <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-[#64748b]">Agent & cron ticks</h2>
          <div className="flex flex-wrap gap-2">
            {(data?.ticks ?? Object.keys(TICK_LABELS)).map((tick) => (
              <button
                key={tick}
                disabled={!!busy}
                onClick={() => void call(TICK_LABELS[tick] ?? tick, { op: 'tick', tick })}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-bold text-[#e5edf8] transition-colors hover:border-cyan/40 hover:bg-cyan/10 disabled:opacity-40"
              >
                {busy === (TICK_LABELS[tick] ?? tick) ? 'Running…' : (TICK_LABELS[tick] ?? tick)}
              </button>
            ))}
          </div>
        </section>

        {/* Create market — human form */}
        <CreateMarketForm onCreate={(draft) => call('Create market', { op: 'create', draft })} busy={!!busy} />

        {/* Markets + per-market actions */}
        <section className="rounded-xl border border-white/[0.06] bg-[#0d1626]/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[11px] font-extrabold uppercase tracking-wider text-[#64748b]">Agent creations ({(data?.markets.length ?? 0) + (data?.ledgerOnly.length ?? 0)})</h2>
            <button onClick={() => void refresh()} disabled={loading} className="text-xs font-bold text-cyan hover:underline disabled:opacity-40">{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
          <div className="flex flex-col gap-2">
            {[...(data?.markets ?? []), ...(data?.ledgerOnly ?? [])].map((m) => (
              <MarketRow key={m.id} m={m} busy={!!busy} onAction={(action, outcomeIndex, evidenceURI) =>
                call(`${action} ${m.title.slice(0, 24)}`, { op: 'market', action, marketId: m.id, outcomeIndex, evidenceURI })} />
            ))}
            {data && data.markets.length === 0 && data.ledgerOnly.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#64748b]">No agent creations yet.</p>
            ) : null}
          </div>
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

function MarketRow({ m, busy, onAction }: {
  m: AgentMarket;
  busy: boolean;
  onAction: (action: string, outcomeIndex?: number, evidenceURI?: string) => void;
}) {
  const [outcome, setOutcome] = useState(0);
  const [uri, setUri] = useState('');
  const [open, setOpen] = useState(false);
  const settleable = m.status === 'Open' || m.status === 'Closing soon' || m.status === 'Closed';

  return (
    <div className="rounded-lg border border-white/[0.06] bg-[#0b1220]/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-extrabold uppercase ${badgeClass(m.status)}`}>{m.status}</span>
          {m.amm ? <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-bold text-[#94a3b8]">V3</span> : null}
          {m.paused ? <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-400">PAUSED</span> : null}
          <span className="truncate text-[13px] font-bold text-[#e5edf8]">{m.title}</span>
        </button>
        <a href={`/markets/${m.id}`} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-bold text-cyan hover:underline">view</a>
      </div>

      {open ? (
        <div className="mt-3 flex flex-col gap-2 border-t border-white/[0.06] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={outcome} onChange={(e) => setOutcome(Number(e.target.value))} className="rounded border border-white/[0.1] bg-[#0b1220] px-2 py-1.5 text-xs text-white">
              {(m.outcomes.length ? m.outcomes : ['Outcome 0', 'Outcome 1']).map((o, i) => <option key={i} value={i}>{i}: {o}</option>)}
            </select>
            <input value={uri} onChange={(e) => setUri(e.target.value)} placeholder="evidence URL (optional)" className="flex-1 min-w-[160px] rounded border border-white/[0.1] bg-[#0b1220] px-2 py-1.5 text-xs text-white placeholder:text-[#475569]" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {settleable && <Action label="Propose" disabled={busy} onClick={() => onAction('propose', outcome, uri)} />}
            <Action label="Settle" disabled={busy} onClick={() => onAction('settle', outcome, uri)} />
            {!m.amm && settleable && <Action label="Resolve" disabled={busy} onClick={() => onAction('resolve', outcome, uri)} />}
            {m.amm && m.proposal?.disputed && <Action label="Resolve disputed" disabled={busy} onClick={() => onAction('resolveDisputed', outcome, uri)} />}
            {m.amm && <Action label="Seed" disabled={busy} onClick={() => onAction('seed')} />}
            {m.amm && (m.paused ? <Action label="Unpause" disabled={busy} onClick={() => onAction('unpause')} /> : <Action label="Pause" disabled={busy} onClick={() => onAction('pause')} />)}
            {m.amm && <Action label="Withdraw fees" disabled={busy} onClick={() => onAction('withdrawFees')} />}
            <Action label="Cancel" danger disabled={busy} onClick={() => onAction('cancel')} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Action({ label, onClick, disabled, danger }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-40 ${
        danger ? 'border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
        : 'border border-white/[0.1] bg-white/[0.04] text-[#e5edf8] hover:border-cyan/40 hover:bg-cyan/10'
      }`}
    >{label}</button>
  );
}

function CreateMarketForm({ onCreate, busy }: { onCreate: (draft: Record<string, unknown>) => void; busy: boolean }) {
  const [type, setType] = useState<'Prediction' | 'Opinion'>('Prediction');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [rules, setRules] = useState('');
  const [source, setSource] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [collateral, setCollateral] = useState<'USDC' | 'EURC'>('USDC');
  const [outcomes, setOutcomes] = useState<string[]>(['YES', 'NO']);
  const [imageURI, setImageURI] = useState('');

  const valid = title.trim() && rules.trim() && source.trim() && closeDate && outcomes.filter((o) => o.trim()).length >= 2;

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
      outcomeOptions: outcomes.map((o) => o.trim()).filter(Boolean),
      collateral,
    });
  };

  return (
    <section className="rounded-xl border border-white/[0.06] bg-[#0d1626]/30 p-4">
      <h2 className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-[#64748b]">Create a market</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Question / title" full><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Who will win X vs Y?" className={inputCls} /></Field>
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
        <Field label="Outcomes" full>
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
      </div>
      <button onClick={submit} disabled={!valid || busy} className="mt-4 rounded-lg bg-cyan px-5 py-2.5 text-sm font-black text-black transition-opacity hover:bg-cyan/90 disabled:opacity-40">
        {busy ? 'Working…' : 'Create market'}
      </button>
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
