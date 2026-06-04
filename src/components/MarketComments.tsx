'use client';

import { useEffect, useState } from 'react';
import { SocialSignInButton } from './SocialSignInButton';

type CommentRow = {
  id: number;
  authorAddress: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function MarketComments({ marketId, canWrite }: { marketId: string; canWrite: boolean }) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [body, setBody] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    const trimmed = body.trim();
    if (!trimmed) return;
    setIsSubmitting(true);
    setMessage('');
    try {
      const res = await fetch(`/api/markets/${marketId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Comment could not be saved.');
      setComments((current) => [data.comment, ...current]);
      setBody('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Comment could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mt-8 rounded-[14px] border border-white/[0.06] bg-[#111b2b] p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan">Evidence thread</p>
          <h2 className="mt-1 text-xl font-black text-white">Comments and source updates</h2>
        </div>
        {canWrite ? <SocialSignInButton onSignedIn={() => setMessage('Signed in. You can post now.')} /> : null}
      </div>

      {canWrite ? (
        <div className="mt-5">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={1000}
            placeholder="Add a market note, source update, or settlement concern."
            rows={3}
            className="w-full resize-none rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-[#475569] focus:border-cyan/40"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">{body.length}/1000</p>
            <button
              type="button"
              onClick={() => void submitComment()}
              disabled={isSubmitting || body.trim().length === 0}
              className="rounded-[8px] bg-cyan px-4 py-2 text-xs font-black text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? 'Posting...' : 'Post'}
            </button>
          </div>
        </div>
      ) : null}

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
