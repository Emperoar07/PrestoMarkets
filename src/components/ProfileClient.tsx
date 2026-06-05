'use client';

import { useEffect, useState } from 'react';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { useSocialSession } from '@/lib/socialSessionContext';
import { useAppState } from '@/lib/appState';
import { broadcastSocialChanged } from '@/lib/socialSignIn';

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const HANDLE_MAX = 32;
const BIO_MAX = 280;

export function ProfileClient() {
  // The profile reflects the CONNECTED wallet (external or Circle), so it mounts and updates
  // per-wallet. Signing in is only required to save (the PATCH is gated on a session).
  const { connectedWallet } = useAppState();
  const { address: sessionAddress, isSignedIn, ready, requireSignIn, refresh } = useSocialSession();
  const walletAddress = connectedWallet?.address ?? null;
  const canEdit = isSignedIn && !!walletAddress && sessionAddress?.toLowerCase() === walletAddress.toLowerCase();

  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [optInLeaderboard, setOptInLeaderboard] = useState(false);
  const [email, setEmail] = useState('');
  const [emailNotifications, setEmailNotifications] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  function notify(text: string, error = false) {
    setMessage(text);
    setIsError(error);
    if (!error) window.setTimeout(() => setMessage(''), 2000);
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    setMessage('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/profiles/avatar', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        requireSignIn();
        throw new Error('Sign in to upload an avatar.');
      }
      if (!res.ok) throw new Error(data.error ?? 'Avatar upload failed.');
      setAvatarUrl(data.url);
      notify('Image uploaded — remember to Save.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Avatar upload failed.', true);
    } finally {
      setUploading(false);
    }
  }

  // Load the connected wallet's profile, and reload when the wallet changes.
  useEffect(() => {
    if (!walletAddress) {
      setHandle(''); setBio(''); setAvatarUrl(''); setOptInLeaderboard(false); setEmail(''); setEmailNotifications(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Clear stale fields immediately so switching wallets never shows the previous profile.
    setHandle(''); setBio(''); setAvatarUrl(''); setOptInLeaderboard(false); setEmail(''); setEmailNotifications(false);
    // When editing your own profile, use the authed endpoint so private fields (email) load;
    // otherwise the public endpoint (no PII).
    const endpoint = canEdit ? '/api/profiles/me' : `/api/profiles/${walletAddress}`;
    fetch(endpoint, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled || !data.profile) return;
        setHandle(data.profile.handle ?? '');
        setBio(data.profile.bio ?? '');
        setAvatarUrl(data.profile.avatarUrl ?? '');
        setOptInLeaderboard(Boolean(data.profile.optInLeaderboard));
        setEmail(data.profile.email ?? '');
        setEmailNotifications(Boolean(data.profile.emailNotifications));
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [walletAddress, canEdit]);

  async function save() {
    if (!canEdit) {
      requireSignIn();
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/profiles/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, bio, avatarUrl, optInLeaderboard, email, emailNotifications }),
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
        setEmail(data.profile.email ?? '');
        setEmailNotifications(Boolean(data.profile.emailNotifications));
      }
      notify('Profile saved.');
      void refresh();
      broadcastSocialChanged(); // update the header avatar immediately
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Profile could not be saved.', true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[640px] px-4 pb-16 pt-28 md:px-7 md:pt-28">
        <h1 className="text-[clamp(40px,6vw,60px)] font-black tracking-tight text-white">Profile</h1>
        <p className="mt-2 text-sm text-muted">
          Set a username and avatar so your comments and leaderboard entry show your identity instead of your address.
        </p>

        {!ready ? (
          <p className="mt-10 text-sm text-muted">Loading…</p>
        ) : !walletAddress ? (
          <div className="mt-8">
            <p className="text-sm text-[#e2e8f0]">Connect a wallet to view and edit your profile.</p>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-6">
            {!canEdit ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-cyan/20 bg-cyan/[0.06] px-4 py-3">
                <span className="text-sm text-[#cbd5e1]">Sign in with this wallet to edit your profile.</span>
                <button
                  type="button"
                  onClick={() => requireSignIn()}
                  className="rounded-[8px] bg-cyan px-4 py-2 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90"
                >
                  Sign in
                </button>
              </div>
            ) : null}
            {/* Avatar preview + URL */}
            <div className="flex items-center gap-4">
              {avatarUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover ring-1 ring-white/10" />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-cyan/15 text-lg font-black text-cyan">
                  {(handle || walletAddress || '0x').slice(-2).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <label className="text-xs font-black uppercase tracking-[0.16em] text-muted">Avatar</label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <label className={`cursor-pointer rounded-[8px] border border-cyan/30 bg-cyan/10 px-3 py-2 text-xs font-black text-cyan transition-colors hover:bg-cyan/15 ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
                    {uploading ? 'Uploading…' : 'Upload image'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadAvatar(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {avatarUrl.trim() ? (
                    <button
                      type="button"
                      onClick={() => setAvatarUrl('')}
                      className="rounded-[8px] border border-white/[0.08] px-3 py-2 text-xs font-black text-muted transition-colors hover:text-white"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <input
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="…or paste an image URL"
                  className="mt-2 w-full rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2 text-sm text-[#e2e8f0] placeholder:text-muted outline-none focus:border-cyan/50"
                />
                <p className="mt-1 text-[11px] text-muted">Square images look best. PNG/JPG/WEBP/GIF, up to 3MB.</p>
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
            <label className="flex items-center justify-between gap-3 text-sm font-bold text-[#cbd5e1] py-1">
              <span>Show my username on the public leaderboard</span>
              <input
                type="checkbox"
                checked={optInLeaderboard}
                onChange={(e) => setOptInLeaderboard(e.target.checked)}
                className="accent-cyan h-4 w-4"
              />
            </label>

            {/* Email notifications */}
            <div>
              <label className="text-xs font-black uppercase tracking-[0.16em] text-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="mt-1 w-full rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2 text-sm text-[#e2e8f0] placeholder:text-muted outline-none focus:border-cyan/50"
              />
              <label className="mt-2 flex items-center justify-between gap-3 text-sm font-bold text-[#cbd5e1] py-1">
                <span>Email me notifications when I&apos;m offline</span>
                <input
                  type="checkbox"
                  checked={emailNotifications}
                  onChange={(e) => setEmailNotifications(e.target.checked)}
                  className="accent-cyan h-4 w-4"
                />
              </label>
              <p className="text-[11px] text-muted">In-app notifications always work. Email needs a verified address.</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || loading}
                className="rounded-[8px] bg-cyan px-5 py-2 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save profile'}
              </button>
              {walletAddress ? <span className="text-[11px] text-muted">{shortAddress(walletAddress)}</span> : null}
              {message ? <span className={`text-xs font-bold ${isError ? 'text-yellow-200' : 'text-mint'}`}>{message}</span> : null}
            </div>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
