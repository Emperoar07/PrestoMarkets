'use client';

import { useEffect, useState } from 'react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { 
  Coins, 
  Clock, 
  MessageSquare, 
  Trophy, 
  ShieldCheck, 
  Wallet, 
  FileCode, 
  BrainCircuit, 
  Sliders,
  ExternalLink 
} from 'lucide-react';

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
    resolveFee: string;
  };
  limits?: Record<string, number>;
  activity?: Record<string, number>;
  skills?: Array<{ name: string; summary: string }>;
  policy?: Array<{ title: string; summary: string }>;
  demoStory?: string[];
};

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
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-36 md:px-6 md:pt-44">
        {/* Title Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-cyan">Co-Admin Agent</p>
            <h1 className="mt-2 text-[clamp(28px,3.5vw,40px)] font-black tracking-tight text-white leading-tight">Presto Market Agent</h1>
            <p className="mt-3 text-[14.5px] leading-relaxed text-[#94a3b8]">
              The co-admin agent monitors public trends, drafts objective rules, deploys verified prediction pools, and settles outcomes using transparent evidence receipts on Arc.
            </p>
          </div>
          {agent?.explorerUrl ? (
            <a 
              href={agent.explorerUrl} 
              target="_blank" 
              rel="noreferrer" 
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan/10 px-3.5 py-2 text-xs font-black text-cyan transition-colors hover:border-cyan/50 hover:bg-cyan/15"
            >
              <span>Explorer</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>

        {/* Stats Cockpit */}
        {profile && profile.ok && !isLoading && (
          <section className="mt-8 grid gap-4 grid-cols-2 sm:grid-cols-4">
            {/* Treasury Balance */}
            <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-extrabold text-[#64748b] uppercase tracking-wider">Treasury Balance</span>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                  <Coins className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-4 text-2xl font-black text-white">{profile.treasury?.usdcBalance ?? '$0.00'}</p>
              <p className="mt-1.5 text-[11px] font-bold text-[#64748b] tracking-wide">
                Agent-managed USDC
              </p>
            </div>

            {/* Active Markets */}
            <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-extrabold text-[#64748b] uppercase tracking-wider">Active Pools</span>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                  <Clock className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-4 text-2xl font-black text-white">{profile.activity?.activeAgentMarkets ?? 0}</p>
              <p className="mt-1.5 text-[11px] font-bold text-[#64748b] tracking-wide">Currently monitoring</p>
            </div>

            {/* Total Deployed */}
            <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-extrabold text-[#64748b] uppercase tracking-wider">Total Created</span>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                  <MessageSquare className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-4 text-2xl font-black text-white">{profile.activity?.totalAgentMarkets ?? 0}</p>
              <p className="mt-1.5 text-[11px] font-bold text-[#64748b] tracking-wide">Onchain markets</p>
            </div>

            {/* Resolved Markets */}
            <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-extrabold text-[#64748b] uppercase tracking-wider">Settled</span>
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                  <Trophy className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-4 text-2xl font-black text-white">
                {profile.activity?.resolvedAgentMarkets ?? 0}
              </p>
              <p className="mt-1.5 text-[11px] font-bold text-[#64748b] tracking-wide">
                Resolved on-chain
              </p>
            </div>
          </section>
        )}

        {/* Section: Identity */}
        <section className="border-t border-white/[0.06] pt-8 mt-10">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
              <ShieldCheck className="h-4.5 w-4.5" />
            </span>
            <h2 className="text-sm font-black text-white uppercase tracking-wider">Identity Registry</h2>
          </div>
          
          {isLoading ? (
            <p className="mt-5 text-sm text-[#94a3b8]">Loading agent identity metadata...</p>
          ) : agent ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#64748b]">Wallet Address</p>
                <p className="mt-2.5 break-all font-mono text-[12.5px] font-bold text-white select-all">{agent.address}</p>
              </div>
              
              <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#64748b]">ERC-8004 identity status</p>
                <p className="mt-2.5 text-[13.5px] font-black text-cyan">
                  {agent.registered ? `Agent #${agent.agentId}` : 'Address visible, identity pending'}
                </p>
              </div>

              {Object.entries(agent.contracts)
                .filter(([label]) => !label.toLowerCase().includes('resolver'))
                .map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-white/[0.08] hover:bg-white/[0.02]">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#64748b]">{titleCase(label)}</p>
                    <p className="mt-2.5 font-mono text-[12.5px] font-bold text-white select-all">{value}</p>
                  </div>
                ))}
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-red-500/10 bg-red-500/[0.02] p-5 text-sm text-red-400">
              {profile?.error ?? 'Agent wallet is not configured.'}
            </div>
          )}
        </section>

        {/* Section: Reasoning Skills */}
        {profile?.skills?.length ? (
          <section className="border-t border-white/[0.06] pt-8 mt-10">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                <BrainCircuit className="h-4.5 w-4.5" />
              </span>
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Reasoning Skills</h2>
            </div>
            
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {profile.skills.map((skill) => (
                <div key={skill.name} className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-5 transition-all duration-200 hover:border-cyan/20 hover:bg-white/[0.02]">
                  <p className="text-xs font-black uppercase tracking-wider text-cyan">{skill.name}</p>
                  <p className="mt-2 text-sm leading-relaxed text-[#cbd5e1]">{skill.summary}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Section: Rules of Engagement */}
        {profile && profile.ok && profile.limits && (
          <section className="border-t border-white/[0.06] pt-8 mt-10">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                <Sliders className="h-4.5 w-4.5" />
              </span>
              <h2 className="text-sm font-black text-white uppercase tracking-wider">Rules of Engagement</h2>
            </div>
            
            <div className="mt-5 grid gap-4 grid-cols-1 sm:grid-cols-3">
              <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-4 transition-all hover:border-white/[0.08] hover:bg-white/[0.02]">
                <p className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Min Safety</p>
                <p className="mt-2 text-base font-black text-cyan">{profile.limits.minSafetyScore}%</p>
              </div>
              <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-4 transition-all hover:border-white/[0.08] hover:bg-white/[0.02]">
                <p className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Min Momentum</p>
                <p className="mt-2 text-base font-black text-cyan">{profile.limits.minMomentumScore}%</p>
              </div>
              <div className="rounded-xl border border-white/[0.04] bg-[#0d1626]/20 p-4 transition-all hover:border-white/[0.08] hover:bg-white/[0.02]">
                <p className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">Signal Gate</p>
                <p className="mt-2 text-base font-black text-cyan">{profile.limits.compositeSignalGate}</p>
              </div>
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
