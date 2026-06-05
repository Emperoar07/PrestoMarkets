'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { SocialSignInButton } from './SocialSignInButton';

type CommentRow = {
  id: number;
  authorAddress: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
};

const COMMENT_MAX_LENGTH = 1_000;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function MarketComments({ marketId }: { marketId: string }) {
  const { isConnected } = useAccount();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);

  async function loadComments() {
    setLoading(true);
    try {
      const res = await fetch(`/api/markets/${marketId}/comments`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Comments unavailable.');
      setComments(data.comments ?? []);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Comments unavailable.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadComments();
  }, [marketId]);

  async function submitComment() {
    const body = draft.trim();
    if (!body || posting) return;

    setPosting(true);
    setPostError('');
    try {
      const res = await fetch(`/api/markets/${marketId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        // No session yet — prompt the wallet sign-in, then the user can post.
        setNeedsSignIn(true);
        setPostError('Sign in with your wallet to post.');
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Comment could not be saved.');

      setDraft('');
      setNeedsSignIn(false);
      await loadComments();
    } catch (error) {
      setPostError(error instanceof Error ? error.message : 'Comment could not be saved.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="mt-8 rounded-[14px] border border-white/[0.06] bg-[#111b2b] p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-black text-white">Comments</h2>
        </div>
      </div>

      {/* Composer */}
      <div className="mt-4">
        {isConnected ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, COMMENT_MAX_LENGTH))}
              placeholder="Share your take on this market..."
              rows={3}
              className="w-full resize-y rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2 text-sm text-[#e2e8f0] placeholder:text-muted outline-none transition-colors focus:border-cyan/50"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted">{draft.length}/{COMMENT_MAX_LENGTH}</span>
              {needsSignIn ? (
                <SocialSignInButton onSignedIn={() => { setNeedsSignIn(false); void submitComment(); }} />
              ) : (
                <button
                  type="button"
                  onClick={() => void submitComment()}
                  disabled={posting || draft.trim().length === 0}
                  className="rounded-[8px] bg-cyan px-4 py-2 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {posting ? 'Posting...' : 'Post comment'}
                </button>
              )}
            </div>
            {postError ? <p className="text-xs text-yellow-200">{postError}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted">Connect a wallet to join the discussion.</p>
        )}
      </div>

      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}

      <div className="mt-5 divide-y divide-white/[0.06]">
        {loading ? (
          <p className="py-6 text-sm text-muted">Loading comments...</p>
        ) : comments.length === 0 ? (
          <p className="py-6 text-sm text-muted">No comments yet.</p>
        ) : comments.map((comment) => (
          <article key={comment.id} className="py-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="font-black text-cyan">{shortAddress(comment.authorAddress)}</span>
              <span>{new Date(comment.createdAt).toLocaleString()}</span>
              {comment.editedAt ? <span>edited</span> : null}
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#cbd5e1]">{comment.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
