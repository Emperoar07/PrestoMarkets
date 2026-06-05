'use client';

/**
 * Editorial close-date picker for market creation.
 *
 * Replaces the native <input type="datetime-local"> which renders as a generic browser widget
 * with no design control. Editorial-minimal direction matching the rest of the app:
 *  - Hairline trigger button that becomes the existing form-field underline pattern
 *  - Popover with month-grid day pills, hour/minute steppers
 *  - One-tap presets ("In 7 days", "Tonight midnight UTC", "Next Friday 5pm UTC") — the
 *    differentiator. Prediction markets reach for these stock close times constantly.
 *  - All custom CSS / Tailwind; no third-party calendar dep
 *  - Keyboard: Esc closes, arrow keys step the highlighted day, Enter picks
 */

import { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  /** ISO local datetime string, e.g. "2026-05-30T18:00" — same shape as datetime-local. */
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  errored?: boolean;
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function parseLocalDatetime(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toLocalDatetimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDisplay(d: Date | null): string {
  if (!d) return '';
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1, 0, 0, 0);
}

function isSameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isBeforeDay(a: Date, b: Date): boolean {
  if (a.getFullYear() !== b.getFullYear()) return a.getFullYear() < b.getFullYear();
  if (a.getMonth() !== b.getMonth()) return a.getMonth() < b.getMonth();
  return a.getDate() < b.getDate();
}

function buildMonthGrid(monthStart: Date): Array<Date | null> {
  const grid: Array<Date | null> = [];
  const offset = (monthStart.getDay() + 6) % 7; // Monday-start: Mon=0 .. Sun=6
  for (let i = 0; i < offset; i++) grid.push(null);
  const last = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= last; day++) {
    grid.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), day));
  }
  while (grid.length % 7 !== 0) grid.push(null);
  return grid;
}

function nextWeekdayAt(from: Date, weekday: number, hour: number, minute = 0): Date {
  // weekday: 0=Sun..6=Sat. Returns next strict-future occurrence.
  const out = new Date(from);
  const diff = (weekday - out.getDay() + 7) % 7;
  out.setDate(out.getDate() + (diff === 0 ? 7 : diff));
  out.setHours(hour, minute, 0, 0);
  return out;
}

function endOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d;
}

export function CloseDatePicker({ value, onChange, onBlur, placeholder, className, errored }: Props) {
  const parsed = parseLocalDatetime(value);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(parsed ?? addMonths(new Date(), 0)));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const presets = useMemo(() => {
    const now = new Date();
    return [
      { label: 'In 1 day', value: new Date(now.getTime() + 86_400_000) },
      { label: 'In 7 days', value: new Date(now.getTime() + 7 * 86_400_000) },
      { label: 'In 30 days', value: new Date(now.getTime() + 30 * 86_400_000) },
      { label: 'Tonight midnight', value: endOfTodayLocal() },
      { label: 'Next Friday 5pm', value: nextWeekdayAt(now, 5, 17) },
      { label: 'In 90 days', value: new Date(now.getTime() + 90 * 86_400_000) },
    ];
  }, []);

  function commitDate(next: Date) {
    onChange(toLocalDatetimeString(next));
  }

  function pickDay(day: Date) {
    const base = parsed ?? new Date();
    const next = new Date(day);
    next.setHours(base.getHours(), base.getMinutes(), 0, 0);
    commitDate(next);
  }

  function bumpHour(delta: number) {
    const base = parsed ?? new Date();
    const next = new Date(base);
    next.setHours(((next.getHours() + delta) + 24) % 24);
    commitDate(next);
  }

  function bumpMinute(delta: number) {
    const base = parsed ?? new Date();
    const next = new Date(base);
    next.setMinutes(((next.getMinutes() + delta) + 60) % 60);
    commitDate(next);
  }

  function applyPreset(preset: Date) {
    const cleaned = new Date(preset);
    // Snap to top-of-minute so the UI doesn't show stray seconds.
    cleaned.setSeconds(0, 0);
    commitDate(cleaned);
    setViewMonth(startOfMonth(cleaned));
  }

  function clear() {
    onChange('');
  }

  const grid = buildMonthGrid(viewMonth);
  const display = formatDisplay(parsed);

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => { if (!open) onBlur?.(); }}
        className={`flex w-full items-center justify-between rounded-xl border bg-[#0d1626]/20 px-4 py-3 text-[14.5px] outline-none transition-all ${
          errored 
            ? 'border-red-400/35 bg-red-400/[0.02] text-red-200 focus:border-red-400/50 focus:ring-1 focus:ring-red-400/50' 
            : 'border-white/[0.06] hover:border-white/[0.1] hover:bg-white/[0.01] text-white focus:border-cyan/40 focus:bg-[#0d1626]/35 focus:ring-1 focus:ring-cyan/40'
        }`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className={display ? 'font-bold' : 'text-[#475569]'}>{display || placeholder || 'Pick a date and time'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-[#64748b]">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose close date and time"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0b1322] shadow-2xl shadow-black/50 sm:max-w-[420px]"
        >
          {/* Presets */}
          <div className="border-b border-white/[0.06] p-3">
            <p className="px-1 pb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan/70">Quick</p>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.value)}
                  className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] font-bold text-muted transition-colors hover:border-cyan/40 hover:text-cyan"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Month nav */}
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
              className="rounded-full p-1.5 text-muted transition-colors hover:bg-white/[0.06] hover:text-white"
              aria-label="Previous month"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <p className="text-[13px] font-black tracking-tight text-white">
              {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </p>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="rounded-full p-1.5 text-muted transition-colors hover:bg-white/[0.06] hover:text-white"
              aria-label="Next month"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Day grid */}
          <div className="px-3 pt-3">
            <div className="grid grid-cols-7 gap-1 px-1 pb-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-muted/60">
              {DAY_HEADERS.map((d) => <span key={d}>{d}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1 pb-3">
              {grid.map((d, i) => {
                if (!d) return <span key={`gap-${i}`} />;
                const isPast = isBeforeDay(d, today);
                const isSelected = isSameDay(d, parsed);
                const isToday = isSameDay(d, today);
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => !isPast && pickDay(d)}
                    disabled={isPast}
                    className={`h-9 rounded-[8px] text-[12.5px] font-bold transition-colors ${
                      isSelected
                        ? 'bg-cyan text-ink'
                        : isPast
                          ? 'cursor-not-allowed text-[#26303f]'
                          : isToday
                            ? 'text-cyan hover:bg-cyan/10'
                            : 'text-white hover:bg-white/[0.05]'
                    }`}
                    aria-label={d.toDateString()}
                    aria-pressed={isSelected}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time + actions */}
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan/70">Time</p>
              <TimeStepper
                label="hr"
                value={parsed ? String(parsed.getHours()).padStart(2, '0') : '--'}
                onUp={() => bumpHour(1)}
                onDown={() => bumpHour(-1)}
              />
              <span className="text-muted/40">:</span>
              <TimeStepper
                label="min"
                value={parsed ? String(parsed.getMinutes()).padStart(2, '0') : '--'}
                onUp={() => bumpMinute(5)}
                onDown={() => bumpMinute(-5)}
              />
            </div>
            <div className="flex items-center gap-2">
              {parsed ? (
                <button
                  type="button"
                  onClick={clear}
                  className="text-[11px] font-bold text-muted transition-colors hover:text-red-300"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full bg-cyan px-3 py-1.5 text-[11.5px] font-black text-ink transition-opacity hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimeStepper({ value, label, onUp, onDown }: { value: string; label: string; onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="rounded-md border border-white/[0.08] bg-[#0f172a] px-2 py-1 text-center font-mono text-[13px] font-black text-white" aria-label={`${label} value`}>
        {value}
      </span>
      <div className="flex flex-col">
        <button type="button" onClick={onUp} className="leading-none text-muted transition-colors hover:text-cyan" aria-label={`Increase ${label}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <button type="button" onClick={onDown} className="leading-none text-muted transition-colors hover:text-cyan" aria-label={`Decrease ${label}`}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
