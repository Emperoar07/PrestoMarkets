'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type NewsItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  excerpt?: string;
  /** Number of outlets covering this story; high = trending. */
  coverageCount?: number;
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diffMs) || diffMs < 0) return '';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function NewsClient() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/news/breaking')
      .then((r) => r.json())
      .then((data: { items?: NewsItem[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setItems(data.items ?? []);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20 pt-36 md:px-6 md:pt-44">
      <Link href="/" className="inline-flex rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-4 py-2 text-[12px] font-bold text-muted transition-colors hover:border-cyan/30 hover:text-cyan">
        Back home
      </Link>
      <h1 className="mt-6 text-[clamp(28px,3.5vw,40px)] font-black tracking-tight text-white">Breaking news.</h1>

      <section className="mt-10 border-t border-white/[0.06] pt-8">
        {loading ? (
          <p className="text-center text-[14px] text-muted">Loading…</p>
        ) : error ? (
          <p className="rounded-[10px] border border-red-400/20 bg-red-400/5 px-4 py-3 text-[13px] text-red-200">{error}</p>
        ) : items.length === 0 ? (
          <p className="text-center text-[14px] text-muted">No items right now.</p>
        ) : (
          <ol className="divide-y divide-white/[0.04]">
            {items.map((item, i) => (
              <li key={item.url} className="py-5">
                <a href={item.url} target="_blank" rel="noreferrer" className="group flex items-start gap-4">
                  <span className="mt-0.5 w-6 shrink-0 text-[12px] font-black text-[#334155]">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-bold leading-snug text-white transition-colors group-hover:text-cyan">
                      {item.title}
                    </h3>
                    {item.excerpt ? (
                      <p className="mt-1.5 line-clamp-2 text-[13px] leading-6 text-muted">{item.excerpt}</p>
                    ) : null}
                    <p className="mt-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-[#4a5568]">
                      <span className="text-cyan/80">{item.source}</span>
                      <span className="opacity-50">·</span>
                      <span>{relativeTime(item.publishedAt)}</span>
                      {(item.coverageCount ?? 0) >= 3 ? (
                        <>
                          <span className="opacity-50">·</span>
                          <span className="text-amber-300">trending · {item.coverageCount} outlets</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
