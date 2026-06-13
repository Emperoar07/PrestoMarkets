'use client';

import { useEffect, useState } from 'react';

type Profile = {
  address: string;
  handle: string | null;
  bio: string;
  avatarUrl: string;
  optInLeaderboard: boolean;
};

type Reputation = {
  created: number;
  open: number;
  resolved: number;
  canceled: number;
  resolvedRate: number | null;
  volumeUsd: number;
  tier: 'Newcomer' | 'Bronze' | 'Silver' | 'Gold';
  topCategories: string[];
};

const TIER_STYLE: Record<Reputation['tier'], string> = {
  Gold: 'border-amber-300/30 bg-amber-300/10 text-amber-200',
  Silver: 'border-slate-300/30 bg-slate-300/10 text-slate-200',
  Bronze: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  Newcomer: 'border-white/[0.06] bg-white/[0.03] text-muted',
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatVolume(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function PublicProfileClient({ address }: { address: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/profiles/${address}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? 'Profile unavailable.');
        setProfile(data.profile);
        setMessage('');
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Profile unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Creator reputation is best-effort and never blocks the profile render.
    fetch(`/api/profiles/${address}/reputation`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled && data?.reputation) setReputation(data.reputation); })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (loading) return <p className="mt-10 text-sm text-muted">Loading profile...</p>;
  if (message) return <p className="mt-10 text-sm text-muted">{message}</p>;
  if (!profile) return null;

  return (
    <section className="mt-10">
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[14px] border border-white/[0.06] bg-[#0d1520]">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt={profile.handle ?? profile.address} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xl font-black text-cyan">{profile.address.slice(2, 4).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0">
          <h2 className="break-words text-2xl font-black text-white">{profile.handle || shortAddress(profile.address)}</h2>
          <p className="mt-1 break-all text-sm text-muted">{profile.address}</p>
          {profile.bio ? <p className="mt-4 max-w-3xl text-sm leading-6 text-[#cbd5e1]">{profile.bio}</p> : null}
        </div>
      </div>

      {reputation && reputation.created > 0 ? (
        <div className="mt-6 rounded-[16px] border border-white/[0.06] bg-[#0d1520] p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-wider text-muted">Creator reputation</h3>
            <span className={`rounded-full border px-3 py-1 text-[11px] font-black ${TIER_STYLE[reputation.tier]}`}>{reputation.tier} creator</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <div>
              <p className="text-2xl font-black text-white">{reputation.created}</p>
              <p className="text-xs font-bold text-muted">Markets created</p>
            </div>
            <div>
              <p className="text-2xl font-black text-white">{reputation.resolvedRate === null ? '—' : `${Math.round(reputation.resolvedRate * 100)}%`}</p>
              <p className="text-xs font-bold text-muted">Resolved cleanly</p>
            </div>
            <div>
              <p className="text-2xl font-black text-white">{reputation.open}</p>
              <p className="text-xs font-bold text-muted">Currently open</p>
            </div>
            <div>
              <p className="text-2xl font-black text-white">{formatVolume(reputation.volumeUsd)}</p>
              <p className="text-xs font-bold text-muted">Volume driven</p>
            </div>
          </div>
          {reputation.topCategories.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
              {reputation.topCategories.map((category) => (
                <span key={category} className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-0.5 text-[11px] font-bold text-[#9fb0c8]">{category}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <span className={`rounded-full border px-3 py-1 text-xs font-black ${
          profile.optInLeaderboard ? 'border-cyan/25 bg-cyan/10 text-cyan' : 'border-white/[0.06] bg-white/[0.03] text-muted'
        }`}>
          {profile.optInLeaderboard ? 'Leaderboard opt-in' : 'Leaderboard private'}
        </span>
        <a
          href={`/activity?account=${profile.address}`}
          className="rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-xs font-black text-muted transition-colors hover:text-white"
        >
          View activity
        </a>
      </div>
    </section>
  );
}
