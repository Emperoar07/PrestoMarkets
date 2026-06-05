'use client';

import { useEffect, useState } from 'react';

type Profile = {
  address: string;
  handle: string | null;
  bio: string;
  avatarUrl: string;
  optInLeaderboard: boolean;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function PublicProfileClient({ address }: { address: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
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
