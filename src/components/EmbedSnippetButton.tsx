'use client';

import { useMemo, useState } from 'react';
import { Copy, Share2 } from 'lucide-react';

export function EmbedSnippetButton({ marketId }: { marketId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const snippet = useMemo(() => {
    const origin = typeof window === 'undefined' ? 'https://presto-markets.vercel.app' : window.location.origin;
    const src = `${origin}/embed/markets/${marketId}`;
    return `<iframe src="${src}" width="420" height="360" style="border:0;border-radius:14px;max-width:100%;" loading="lazy"></iframe>`;
  }, [marketId]);

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="relative ml-auto shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Share market"
        title="Share market"
        className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-cyan/30 bg-cyan/10 text-cyan transition-colors hover:bg-cyan/15"
      >
        <Share2 className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-20 w-[min(360px,calc(100vw-32px))] rounded-[14px] border border-white/[0.08] bg-[#141e30] p-4 shadow-2xl shadow-black/40">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan">Share</p>
          <p className="mt-1 text-sm text-muted">Embed this market on another site.</p>
          <textarea
            readOnly
            value={snippet}
            rows={3}
            className="mt-3 w-full resize-none rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-xs leading-5 text-[#cbd5e1] outline-none"
          />
          <button
            type="button"
            onClick={() => void copySnippet()}
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-cyan px-3 text-sm font-black text-[#07111f] transition-opacity hover:opacity-90"
          >
            <Copy className="h-4 w-4" />
            {copied ? 'Copied' : 'Copy iframe'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
