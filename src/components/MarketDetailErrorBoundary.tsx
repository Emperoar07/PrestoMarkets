'use client';

import { Component, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * MarketDetailClient is loaded with `ssr: false`, so it renders only in the browser. Without a
 * boundary, ANY throw during its client render (a malformed field on one market's snapshot — a
 * NaN date, an unexpected shape from a degraded on-chain read, etc.) unwinds all the way to
 * Next's global-error.js and the user sees the bare "This page couldn't load. Reload to try
 * again." with no header, no way back, and no signal to us about which market/field broke.
 *
 * This boundary scopes that blast radius to the market panel: it shows a branded, retryable card
 * (matching the in-component "Market not found" state) and logs the real error + component stack
 * so the offending field is visible in the browser console / error reporting instead of being
 * swallowed by the framework boundary.
 */
export class MarketDetailErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Keep this — it's the only place the crashing field surfaces for an ssr:false page.
    console.error('[market-detail] render crashed:', error, info?.componentStack);
  }

  private handleReload = () => {
    this.setState({ error: null });
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col items-center justify-center px-4 pb-16 pt-28 md:px-7 md:pt-28">
          <div className="flex w-full max-w-[380px] flex-col items-center justify-center rounded-[16px] border border-white/[0.08] bg-[#0c121d]/90 p-8 text-center shadow-2xl shadow-black/80 backdrop-blur-md">
            <div className="relative mb-5 flex h-16 w-16 items-center justify-center">
              <div className="absolute inset-0 animate-pulse rounded-full bg-amber-500/10 blur-2xl" />
              <AlertCircle className="relative z-10 h-9 w-9 text-amber-400" />
            </div>
            <h1 className="text-xl font-black tracking-tight text-white">This market couldn&apos;t load</h1>
            <p className="mt-2 text-sm text-[#8fa0b4]">
              Something went wrong rendering this market. Reload to try again, or head back to the explorer.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center justify-center rounded-lg bg-cyan px-4 py-2 text-xs font-black uppercase tracking-wider text-[#07111f] shadow-md shadow-cyan/5 transition-all duration-150 hover:bg-cyan-300 active:scale-95"
              >
                Reload
              </button>
              <Link
                href="/markets"
                className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] px-4 py-2 text-xs font-black uppercase tracking-wider text-[#8fa0b4] transition-all duration-150 hover:border-white/20 hover:text-white active:scale-95"
              >
                Back to Explorer
              </Link>
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }
}
