'use client';

import { useMemo, useState, type MouseEvent } from 'react';
import { Copy, Share2 } from 'lucide-react';

type ShareMarketButtonProps = {
  marketId: string;
  title?: string;
  compact?: boolean;
};

export function ShareMarketButton({ marketId, title = 'Presto market', compact = false }: ShareMarketButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const shareUrl = useMemo(() => {
    const origin = typeof window === 'undefined' ? 'https://presto-markets.vercel.app' : window.location.origin;
    return `${origin}/markets/${marketId}`;
  }, [marketId]);
  const shareText = `${title} | Presto Markets`;
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent(shareText);
  const socialLinks = [
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${encodedText}%20${encodedUrl}` },
    { label: 'Telegram', href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}` },
  ];

  async function copyLink() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function shareDirect(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (navigator.share) {
      try {
        await navigator.share({ title, text: shareText, url: shareUrl });
        return;
      } catch {
        // Fall through to copy when native share is cancelled or unavailable.
      }
    }
    await copyLink();
  }

  function toggleOpen(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    setOpen((value) => !value);
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={(event) => void shareDirect(event)}
        aria-label="Share market"
        title={copied ? 'Link copied' : 'Share market'}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-white/[0.06] bg-white/[0.02] text-[#475569] transition-colors hover:text-cyan"
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="relative ml-auto shrink-0">
      <button
        type="button"
        onClick={toggleOpen}
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
          <p className="mt-1 text-sm text-muted">Share this market with your network.</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2 text-center text-xs font-black text-[#cbd5e1] transition-colors hover:border-cyan/25 hover:text-cyan"
              >
                {link.label}
              </a>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-cyan px-3 text-sm font-black text-[#07111f] transition-opacity hover:opacity-90"
          >
            <Copy className="h-4 w-4" />
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const EmbedSnippetButton = ShareMarketButton;
