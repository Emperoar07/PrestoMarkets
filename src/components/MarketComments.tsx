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
  authorHandle?: string | null;
  authorAvatarUrl?: string | null;
};

const COMMENT_MAX_LENGTH = 1_000;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function displayName(comment: CommentRow) {
  return comment.authorHandle?.trim() ? `@${comment.authorHandle.trim()}` : shortAddress(comment.authorAddress);
}

function CommentAvatar({ comment }: { comment: CommentRow }) {
  const url = comment.authorAvatarUrl?.trim();
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />;
  }
  const seed = (comment.authorHandle?.trim() || comment.authorAddress).slice(-2).toUpperCase();
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan/15 text-[10px] font-black text-cyan">
      {seed}
    </span>
  );
}

export function MarketComments({ marketId }: { marketId: string }) {
  const { address, isConnected } = useAccount();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);

  // Editing state
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEditId, setSavingEditId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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

  async function handleSaveEdit(commentId: number) {
    const body = editDraft.trim();
    if (!body || savingEditId !== null) return;

    setSavingEditId(commentId);
    try {
      const res = await fetch(`/api/markets/${marketId}/comments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Comment could not be edited.');
      setEditingCommentId(null);
      await loadComments();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Comment could not be edited.');
    } finally {
      setSavingEditId(null);
    }
  }

  async function handleDelete(commentId: number) {
    if (deletingId !== null) return;
    if (!confirm('Are you sure you want to delete this comment?')) return;

    setDeletingId(commentId);
    try {
      const res = await fetch(`/api/markets/${marketId}/comments`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Comment could not be deleted.');
      await loadComments();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Comment could not be deleted.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="mt-8">
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

      <div className="mt-5 max-h-[400px] overflow-y-auto scrollbar-hide divide-y divide-white/[0.06]">
        {loading ? (
          <p className="py-6 text-sm text-muted">Loading comments...</p>
        ) : comments.length === 0 ? (
          <p className="py-6 text-sm text-muted">No comments yet.</p>
        ) : comments.map((comment) => {
          const isAuthor = address && comment.authorAddress.toLowerCase() === address.toLowerCase();
          const isEditing = editingCommentId === comment.id;

          return (
            <article key={comment.id} className="py-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <CommentAvatar comment={comment} />
                <span className="font-black text-cyan">{displayName(comment)}</span>
                <span>{new Date(comment.createdAt).toLocaleString()}</span>
                {comment.editedAt ? <span className="text-muted/60">· edited</span> : null}
                {isAuthor && !isEditing && (
                  <>
                    <span className="text-muted/40">·</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCommentId(comment.id);
                        setEditDraft(comment.body);
                      }}
                      className="font-bold text-cyan hover:underline"
                    >
                      Edit
                    </button>
                    <span className="text-muted/40">·</span>
                    <button
                      type="button"
                      onClick={() => void handleDelete(comment.id)}
                      disabled={deletingId === comment.id}
                      className="font-bold text-red-400 hover:underline disabled:opacity-50"
                    >
                      {deletingId === comment.id ? 'Deleting...' : 'Delete'}
                    </button>
                  </>
                )}
              </div>

              {isEditing ? (
                <div className="mt-2 flex flex-col gap-2">
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value.slice(0, COMMENT_MAX_LENGTH))}
                    rows={2}
                    className="w-full resize-y rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2 text-sm text-[#e2e8f0] outline-none transition-colors focus:border-cyan/50"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setEditingCommentId(null)}
                      className="rounded-[6px] border border-white/[0.08] px-3 py-1.5 text-xs font-black text-muted hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={savingEditId !== null || editDraft.trim().length === 0}
                      onClick={() => void handleSaveEdit(comment.id)}
                      className="rounded-[6px] bg-cyan px-3 py-1.5 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {savingEditId === comment.id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#cbd5e1]">{comment.body}</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
