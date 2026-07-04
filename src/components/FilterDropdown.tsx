'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';

/**
 * Shared dropdown for sort/filter toolbars (markets explorer, activity feed). One consistent
 * design: pill trigger with optional leading icon + rotating chevron, blurred elevated menu with
 * a micro heading, check-marked active row, click-outside and Escape to close.
 */
export function FilterDropdown<K extends string>({
  icon: Icon,
  heading,
  options,
  value,
  onChange,
  align = 'left',
}: {
  icon?: LucideIcon;
  heading?: string;
  options: Array<{ key: K; label: string; hint?: string }>;
  value: K;
  onChange: (key: K) => void;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const active = options.find((option) => option.key === value);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12.5px] font-bold transition-all duration-150 ${
          open
            ? 'border-cyan/30 bg-cyan/10 text-cyan'
            : 'border-white/[0.06] bg-white/[0.04] text-[#cbd5e1] hover:border-white/[0.12] hover:bg-white/[0.07] hover:text-white'
        }`}
      >
        {Icon ? <Icon className="h-3.5 w-3.5 opacity-80" /> : null}
        <span>{active?.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          role="listbox"
          className={`absolute top-full z-50 mt-1.5 min-w-[200px] overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0c1420]/95 shadow-2xl shadow-black/50 backdrop-blur-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {heading ? (
            <p className="px-3.5 pb-1 pt-2.5 text-[9.5px] font-black uppercase tracking-[0.14em] text-[#475569]">{heading}</p>
          ) : null}
          <div className="pb-1.5 pt-0.5">
            {options.map((option) => {
              const isActive = option.key === value;
              return (
                <button
                  key={option.key}
                  role="option"
                  aria-selected={isActive}
                  type="button"
                  onClick={() => {
                    onChange(option.key);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] transition-colors ${
                    isActive ? 'bg-cyan/[0.08] font-bold text-cyan' : 'text-[#cbd5e1] hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.hint ? <span className="block text-[10.5px] font-medium text-[#64748b]">{option.hint}</span> : null}
                  </span>
                  {isActive ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
