'use client';

import { useMemo, useState } from 'react';
import { Code, Copy } from 'lucide-react';

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
    <div className="mt-4 rounded-[14px] border border-white/[0.06] bg-[#141e30] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan">Share</p>
          <p className="mt-1 text-sm text-muted">Embed this market on another site.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-cyan/30 bg-cyan/10 px-3 text-sm font-black text-cyan transition-colors hover:bg-cyan/15"
        >
          <Code className="h-4 w-4" />
          Embed
        </button>
      </div>
      {open ? (
        <div className="mt-3">
          <textarea
            readOnly
            value={snippet}
            rows={3}
            className="w-full resize-none rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-xs leading-5 text-[#cbd5e1] outline-none"
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
