'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';

type AgentProfile = {
  ok: boolean;
  error?: string;
  agent?: {
    name: string;
    address: string;
    registered: boolean;
    agentId: string | null;
    explorerUrl: string;
    contracts: Record<string, string>;
  };
  treasury?: {
    usdcBalance: string | null;
    eurcBalance: string | null;
    resolveFee: string;
  };
  limits?: Record<string, number>;
  activity?: Record<string, number>;
  policy?: Array<{ title: string; summary: string }>;
  demoStory?: string[];
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function titleCase(key: string) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase());
}

export function AgentProfileClient() {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch('/api/agents/profile', { cache: 'no-store' });
        const data = await response.json() as AgentProfile;
        if (!cancelled) setProfile(data);
      } catch {
        if (!cancelled) setProfile({ ok: false, error: 'Agent profile could not be loaded.' });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  const agent = profile?.agent;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-36 md:px-7 md:pt-40">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-cyan">Agent profile</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-[clamp(34px,5vw,58px)] font-black tracking-tight text-white">Presto Market Agent</h1>
            <p className="mt-3 max-w-3xl text-[14px] leading-[1.8] text-muted">
              The co-admin agent watches public signals, drafts market rules, creates high-confidence markets, and keeps every action readable through receipts on Arc.
            </p>
          </div>
          {agent?.explorerUrl ? (
            <a href={agent.explorerUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-cyan/30 bg-cyan/10 px-4 py-2 text-sm font-black text-cyan transition-colors hover:bg-cyan/15">
              View on Arc
            </a>
          ) : null}
        </div>

        <section className="mt-9">
          <div className="rounded-[18px] border border-white/[0.06] bg-[#141e30] p-6">
            <h2 className="text-xl font-black text-white">Identity receipt</h2>
            {isLoading ? (
              <p className="mt-4 text-sm text-muted">Loading agent identity...</p>
            ) : agent ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted">Wallet</p>
                  <p className="mt-1 break-all text-sm font-black text-white">{agent.address}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted">ERC-8004 identity</p>
                  <p className="mt-1 text-sm font-black text-cyan">{agent.registered ? `Agent #${agent.agentId}` : 'Address visible, identity pending'}</p>
                </div>
                {Object.entries(agent.contracts).map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted">{titleCase(label)}</p>
                    <p className="mt-1 break-all text-sm font-black text-white">{shortAddress(value)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted">{profile?.error ?? 'Agent wallet is not configured.'}</p>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
