'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Share2 } from 'lucide-react';

type ShareMarketButtonProps = {
  marketId: string;
  title?: string;
  compact?: boolean;
};

type PopoverPos = { top?: number; bottom?: number; right: number };

export function ShareMarketButton({ marketId, title = 'Presto market', compact = false }: ShareMarketButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const shareUrl = useMemo(() => {
    const origin = typeof window === 'undefined' ? 'https://presto-markets.vercel.app' : window.location.origin;
    return `${origin}/markets/${marketId}`;
  }, [marketId]);
  const shareText = `${title} | Presto Markets`;
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedText = encodeURIComponent(shareText);
  const socialLinks = [
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`, Icon: XIcon },
    { label: 'WhatsApp', href: `https://wa.me/?text=${encodedText}%20${encodedUrl}`, Icon: WhatsAppIcon },
    { label: 'Telegram', href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`, Icon: TelegramIcon },
  ];

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  // Toggle the popover. Position it (fixed) from the trigger rect so it escapes the card's
  // overflow-hidden, and render it in a portal so clicks never bubble to the card's link.
  function toggleOpen(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const popoverWidth = Math.min(320, window.innerWidth - 32);
    const computedRight = window.innerWidth - rect.right;
    const maxRight = Math.max(16, window.innerWidth - popoverWidth - 16);
    const right = Math.min(Math.max(16, computedRight), maxRight);
    const openUp = rect.bottom + 240 > window.innerHeight;
    setPos(openUp ? { bottom: window.innerHeight - rect.top + 8, right } : { top: rect.bottom + 8, right });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: globalThis.MouseEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const triggerClass = compact
    ? 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-white/[0.06] bg-white/[0.02] text-[#475569] transition-colors hover:text-cyan'
    : 'inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-cyan/30 bg-cyan/10 text-cyan transition-colors hover:bg-cyan/15';

  return (
    <div className={`shrink-0 ${compact ? '' : 'ml-auto'}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-label="Share market"
        title="Share market"
        className={triggerClass}
      >
        <Share2 className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </button>
      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, right: pos.right, width: 'min(320px, calc(100vw - 32px))' }}
              className="z-[60] rounded-[14px] border border-white/[0.08] bg-[#141e30] p-4 shadow-2xl shadow-black/40"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan">Share</p>
              <p className="mt-1 text-sm text-muted">Share this market with your network.</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {socialLinks.map(({ label, href, Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpen(false)}
                    className="flex flex-col items-center gap-1.5 rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-2.5 text-center text-[11px] font-black text-[#cbd5e1] transition-colors hover:border-cyan/25 hover:text-cyan"
                  >
                    <Icon className="h-5 w-5" />
                    {label}
                  </a>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void copyLink()}
                className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-cyan px-3 text-sm font-black text-[#07111f] transition-opacity hover:opacity-90"
              >
                <Copy className="h-4 w-4" />
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#25D366" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#229ED9" className={className} aria-hidden="true">
      <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.061 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

export const EmbedSnippetButton = ShareMarketButton;
