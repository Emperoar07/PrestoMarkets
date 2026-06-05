'use client';

import { useEffect, useState } from 'react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { useSocialSession } from '@/lib/socialSessionContext';

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const HANDLE_MAX = 32;
const BIO_MAX = 280;

export function ProfileClient() {
  const { address, isSignedIn, ready, requireSignIn, refresh } = useSocialSession();

  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [optInLeaderboard, setOptInLeaderboard] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Load the current profile once signed in.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/profiles/${address}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled || !data.profile) return;
        setHandle(data.profile.handle ?? '');
        setBio(data.profile.bio ?? '');
        setAvatarUrl(data.profile.avatarUrl ?? '');
        setOptInLeaderboard(Boolean(data.profile.optInLeaderboard));
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/profiles/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, bio, avatarUrl, optInLeaderboard }),
      });
      if (res.status === 401) {
        requireSignIn();
        throw new Error('Sign in to save your profile.');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Profile could not be saved.');
      if (data.profile) {
        setHandle(data.profile.handle ?? '');
        setBio(data.profile.bio ?? '');
        setAvatarUrl(data.profile.avatarUrl ?? '');
        setOptInLeaderboard(Boolean(data.profile.optInLeaderboard));
      }
      setMessage('Profile saved.');
      void refresh();
      window.setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Profile could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[640px] px-4 pb-16 pt-36 md:px-7 md:pt-40">
        <h1 className="text-[clamp(40px,6vw,60px)] font-black tracking-tight text-white">Profile</h1>
        <p className="mt-2 text-sm text-muted">
          Set a username and avatar so your comments and leaderboard entry show your identity instead of your address.
        </p>

        {!ready ? (
          <p className="mt-10 text-sm text-muted">Loading…</p>
        ) : !isSignedIn ? (
          <div className="mt-8 rounded-[14px] border border-white/[0.06] bg-[#111b2b] p-6">
            <p className="text-sm text-[#e2e8f0]">Sign in with your wallet to edit your profile.</p>
            <button
              type="button"
              onClick={() => requireSignIn()}
              className="mt-4 rounded-[8px] bg-cyan px-4 py-2 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90"
            >
              Sign in
            </button>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-6 rounded-[14px] border border-white/[0.06] bg-[#111b2b] p-6">
            {/* Avatar preview + URL */}
            <div className="flex items-center gap-4">
              {avatarUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover ring-1 ring-white/10" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan/15 text-lg font-black text-cyan">
                  {(handle || address || '0x').slice(-2).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <label className="text-xs font-black uppercase tracking-[0.16em] text-muted">Avatar image URL</label>
                <input
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://…/avatar.png"
                  className="mt-1 w-full rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2 text-sm text-[#e2e8f0] placeholder:text-muted outline-none focus:border-cyan/50"
                />
                <p className="mt-1 text-[11px] text-muted">Paste a link to a square image (e.g. from your socials or an image host).</p>
              </div>
            </div>

            {/* Handle */}
            <div>
              <label className="text-xs font-black uppercase tracking-[0.16em] text-muted">Username</label>
              <div className="mt-1 flex items-center rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 focus-within:border-cyan/50">
                <span className="text-sm text-muted">@</span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.slice(0, HANDLE_MAX))}
                  placeholder="username"
                  className="w-full bg-transparent px-1 py-2 text-sm text-[#e2e8f0] placeholder:text-muted outline-none"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted">Letters, numbers and underscores. {handle.length}/{HANDLE_MAX}</p>
            </div>

            {/* Bio */}
            <div>
              <label className="text-xs font-black uppercase tracking-[0.16em] text-muted">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
                rows={3}
                placeholder="A short bio…"
                className="mt-1 w-full resize-y rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2 text-sm text-[#e2e8f0] placeholder:text-muted outline-none focus:border-cyan/50"
              />
              <p className="mt-1 text-[11px] text-muted">{bio.length}/{BIO_MAX}</p>
            </div>

            {/* Leaderboard opt-in */}
            <label className="flex items-center justify-between gap-3 rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-3 text-sm font-bold text-[#cbd5e1]">
              <span>Show my username on the public leaderboard</span>
              <input
                type="checkbox"
                checked={optInLeaderboard}
                onChange={(e) => setOptInLeaderboard(e.target.checked)}
                className="accent-cyan"
              />
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || loading}
                className="rounded-[8px] bg-cyan px-5 py-2 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save profile'}
              </button>
              {address ? <span className="text-[11px] text-muted">{shortAddress(address)}</span> : null}
              {message ? <span className="text-xs font-bold text-mint">{message}</span> : null}
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
