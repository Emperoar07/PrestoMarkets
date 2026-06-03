'use client';

import { useEffect, useState } from 'react';

type LeaderboardRow = {
  address: string;
  rank: number;
  realizedPnl: string;
  accuracy: string;
  brier: string;
  marketsTraded: number;
  resolvedCorrect: number;
  createdCount: number;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function LeaderboardClient() {
  const [metric, setMetric] = useState<'pnl' | 'accuracy' | 'created'>('pnl');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/leaderboard?metric=${metric}&period=all`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? 'Leaderboard unavailable.');
        setRows(data.rows ?? []);
        setMessage('');
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Leaderboard unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metric]);

  return (
    <section className="mt-10 rounded-[16px] border border-white/[0.06] bg-[#141e30]">
      <div className="flex flex-col gap-4 border-b border-line p-5 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-black text-white">Top forecasters</h2>
        <div className="flex gap-2">
          {(['pnl', 'accuracy', 'created'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMetric(item)}
              className={`rounded-[8px] px-3 py-2 text-xs font-black uppercase tracking-[0.12em] ${
                metric === item ? 'bg-cyan/10 text-cyan ring-1 ring-cyan/30' : 'text-muted hover:text-white'
              }`}
            >
              {item === 'pnl' ? 'P&L' : item}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-line">
        {loading ? (
          <p className="p-6 text-sm text-muted">Loading leaderboard...</p>
        ) : message ? (
          <p className="p-6 text-sm text-muted">{message}</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted">No ranked accounts yet.</p>
        ) : rows.map((row) => (
          <a
            key={row.address}
            href={`/u/${row.address}`}
            className="grid gap-3 p-5 transition-colors hover:bg-white/[0.025] md:grid-cols-[80px_1fr_repeat(4,120px)] md:items-center"
          >
            <span className="text-2xl font-black text-cyan">#{row.rank}</span>
            <span className="font-black text-white">{shortAddress(row.address)}</span>
            <span className="text-sm font-bold text-muted">P&L <b className="text-white">${Number(row.realizedPnl).toFixed(2)}</b></span>
            <span className="text-sm font-bold text-muted">Accuracy <b className="text-white">{Math.round(Number(row.accuracy) * 100)}%</b></span>
            <span className="text-sm font-bold text-muted">Traded <b className="text-white">{row.marketsTraded}</b></span>
            <span className="text-sm font-bold text-muted">Created <b className="text-white">{row.createdCount}</b></span>
          </a>
        ))}
      </div>
    </section>
  );
}
