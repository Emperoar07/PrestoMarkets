'use client';

import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { SocialSignInButton } from './SocialSignInButton';
import { useAppState } from '@/lib/appState';
import { useSocialSession } from '@/lib/socialSessionContext';

type CommentRow = {
  id: number;
  authorAddress: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
  authorHandle?: string | null;
  authorAvatarUrl?: string | null;
  parentId?: number | null;
  likesCount: number;
  likedByMe?: boolean;
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
  // Connected wallet covers BOTH external (wagmi) and Circle user-controlled wallets;
  // identity for edit/delete is the signed-in session address.
  const { connectedWallet } = useAppState();
  const { address: sessionAddress, isSignedIn, requireSignIn } = useSocialSession();
  const address = sessionAddress;
  const isConnected = Boolean(connectedWallet);
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

  // Replying state
  const [replyToId, setReplyToId] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [postingReply, setPostingReply] = useState(false);

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

  async function submitReply(parentId: number) {
    const body = replyDraft.trim();
    if (!body || postingReply) return;

    setPostingReply(true);
    try {
      const res = await fetch(`/api/markets/${marketId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, parentId }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        setNeedsSignIn(true);
        alert('Sign in with your wallet to reply.');
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Reply could not be saved.');

      setReplyDraft('');
      setReplyToId(null);
      await loadComments();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Reply could not be saved.');
    } finally {
      setPostingReply(false);
    }
  }

  async function toggleLike(commentId: number, currentlyLiked: boolean) {
    if (!isSignedIn) {
      requireSignIn();
      return;
    }

    // Optimistic UI updates
    setComments((prev) =>
      prev.map((c) => {
        if (c.id === commentId) {
          return {
            ...c,
            likedByMe: !currentlyLiked,
            likesCount: currentlyLiked ? Math.max(0, c.likesCount - 1) : c.likesCount + 1,
          };
        }
        return c;
      })
    );

    try {
      const method = currentlyLiked ? 'DELETE' : 'POST';
      const res = await fetch(`/api/comments/${commentId}/like`, { method });
      if (res.status === 401) {
        requireSignIn();
        throw new Error('Sign in to like comments.');
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? 'Failed to update like.');
      }
    } catch (error) {
      // Revert optimistic updates on error
      setComments((prev) =>
        prev.map((c) => {
          if (c.id === commentId) {
            return {
              ...c,
              likedByMe: currentlyLiked,
              likesCount: currentlyLiked ? c.likesCount + 1 : Math.max(0, c.likesCount - 1),
            };
          }
          return c;
        })
      );
      alert(error instanceof Error ? error.message : 'Could not update like.');
    }
  }

  async function handleSaveEdit(commentId: number) {
    const body = editDraft.trim();
    if (!body || savingEditId !== null) return;

    setSavingEditId(commentId);
    try {
      const res = await fetch(`/api/comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
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
      const res = await fetch(`/api/comments/${commentId}`, {
        method: 'DELETE',
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

  // Filter top-level parents and group replies
  const parentComments = comments.filter((c) => !c.parentId);
  const repliesByParentId: Record<number, CommentRow[]> = {};
  comments.forEach((c) => {
    if (c.parentId) {
      if (!repliesByParentId[c.parentId]) {
        repliesByParentId[c.parentId] = [];
      }
      repliesByParentId[c.parentId].push(c);
    }
  });

  // Sort replies oldest-first so they read as a conversational thread
  Object.keys(repliesByParentId).forEach((key) => {
    const pId = Number(key);
    repliesByParentId[pId].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  });

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
        ) : parentComments.length === 0 ? (
          <p className="py-6 text-sm text-muted">No comments yet.</p>
        ) : parentComments.map((parent) => {
          const isParentAuthor = address && parent.authorAddress.toLowerCase() === address.toLowerCase();
          const isParentEditing = editingCommentId === parent.id;
          const parentReplies = repliesByParentId[parent.id] ?? [];

          return (
            <div key={parent.id} className="py-4">
              {/* Parent Comment */}
              <article>
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  <div className="flex flex-wrap items-center gap-2">
                    <CommentAvatar comment={parent} />
                    <span className="font-black text-cyan">{displayName(parent)}</span>
                    <span>{new Date(parent.createdAt).toLocaleString()}</span>
                    {parent.editedAt ? <span className="text-muted/60">· edited</span> : null}
                  </div>
                  {isParentAuthor && !isParentEditing && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCommentId(parent.id);
                          setEditDraft(parent.body);
                        }}
                        className="rounded-[6px] p-1 text-[#8fa0b4] hover:bg-white/[0.04] hover:text-cyan transition-all"
                        title="Edit comment"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(parent.id)}
                        disabled={deletingId === parent.id}
                        className="rounded-[6px] p-1 text-[#8fa0b4] hover:bg-white/[0.04] hover:text-red-400 transition-all disabled:opacity-50"
                        title="Delete comment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {isParentEditing ? (
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
                        onClick={() => void handleSaveEdit(parent.id)}
                        className="rounded-[6px] bg-cyan px-3 py-1.5 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {savingEditId === parent.id ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#cbd5e1]">{parent.body}</p>

                    {/* Action buttons (Like & Reply) */}
                    <div className="mt-2.5 flex items-center gap-4 text-xs">
                      <button
                        type="button"
                        onClick={() => void toggleLike(parent.id, !!parent.likedByMe)}
                        className={`flex items-center gap-1.5 font-bold transition-colors ${
                          parent.likedByMe ? 'text-cyan' : 'text-[#8fa0b4] hover:text-white'
                        }`}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill={parent.likedByMe ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" className="opacity-85">
                          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                        </svg>
                        <span>{parent.likesCount}</span>
                      </button>

                      {isConnected && (
                        <button
                          type="button"
                          onClick={() => {
                            setReplyToId(parent.id);
                            setReplyDraft('');
                          }}
                          className="text-[#8fa0b4] hover:text-white font-bold transition-colors"
                        >
                          Reply
                        </button>
                      )}
                    </div>
                  </>
                )}
              </article>

              {/* Inline Reply Composer */}
              {replyToId === parent.id && (
                <div className="ml-6 mt-3 pl-3 border-l border-white/[0.06] flex flex-col gap-2">
                  <textarea
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value.slice(0, COMMENT_MAX_LENGTH))}
                    placeholder={`Reply to ${displayName(parent)}...`}
                    rows={2}
                    className="w-full resize-y rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2 text-sm text-[#e2e8f0] outline-none transition-colors focus:border-cyan/50"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setReplyToId(null)}
                      className="rounded-[6px] border border-white/[0.08] px-3 py-1 text-xs font-black text-muted hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={postingReply || replyDraft.trim().length === 0}
                      onClick={() => void submitReply(parent.id)}
                      className="rounded-[6px] bg-cyan px-3 py-1 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {postingReply ? 'Replying...' : 'Reply'}
                    </button>
                  </div>
                </div>
              )}

              {/* Replies list */}
              {parentReplies.length > 0 && (
                <div className="ml-6 mt-3 pl-3 border-l border-white/[0.06] flex flex-col gap-3.5">
                  {parentReplies.map((reply) => {
                    const isReplyAuthor = address && reply.authorAddress.toLowerCase() === address.toLowerCase();
                    const isReplyEditing = editingCommentId === reply.id;

                    return (
                      <article key={reply.id} className="text-sm">
                        <div className="flex items-center justify-between gap-2 text-xs text-muted">
                          <div className="flex flex-wrap items-center gap-2">
                            <CommentAvatar comment={reply} />
                            <span className="font-black text-cyan">{displayName(reply)}</span>
                            <span>{new Date(reply.createdAt).toLocaleString()}</span>
                            {reply.editedAt ? <span className="text-muted/60">· edited</span> : null}
                          </div>
                          {isReplyAuthor && !isReplyEditing && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCommentId(reply.id);
                                  setEditDraft(reply.body);
                                }}
                                className="rounded-[6px] p-1 text-[#8fa0b4] hover:bg-white/[0.04] hover:text-cyan transition-all"
                                title="Edit reply"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(reply.id)}
                                disabled={deletingId === reply.id}
                                className="rounded-[6px] p-1 text-[#8fa0b4] hover:bg-white/[0.04] hover:text-red-400 transition-all disabled:opacity-50"
                                title="Delete reply"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {isReplyEditing ? (
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
                                onClick={() => void handleSaveEdit(reply.id)}
                                className="rounded-[6px] bg-cyan px-3 py-1.5 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:opacity-50"
                              >
                                {savingEditId === reply.id ? 'Saving...' : 'Save'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#cbd5e1]">{reply.body}</p>

                            {/* Reply Like Action */}
                            <div className="mt-2 flex items-center gap-4 text-xs">
                              <button
                                type="button"
                                onClick={() => void toggleLike(reply.id, !!reply.likedByMe)}
                                className={`flex items-center gap-1.5 font-bold transition-colors ${
                                  reply.likedByMe ? 'text-cyan' : 'text-[#8fa0b4] hover:text-white'
                                }`}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill={reply.likedByMe ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" className="opacity-85">
                                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                                </svg>
                                <span>{reply.likesCount}</span>
                              </button>
                            </div>
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
