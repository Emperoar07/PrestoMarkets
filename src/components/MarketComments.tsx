'use client';

import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Pencil, Trash2 } from 'lucide-react';
import { SocialSignInButton } from './SocialSignInButton';
import { useAppState } from '@/lib/appState';
import { buildCommentTree, getVisibleReplies, type CommentThreadNode } from '@/lib/commentThread';
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
const REPLY_PREVIEW_LIMIT = 2;

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

function formatReplyCount(count: number) {
  return count === 1 ? '1 more reply' : `${count} more replies`;
}

export function MarketComments({ marketId }: { marketId: string }) {
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

  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEditId, setSavingEditId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [replyToId, setReplyToId] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [postingReply, setPostingReply] = useState(false);
  const [expandedReplyIds, setExpandedReplyIds] = useState<Set<number>>(new Set());

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

  const commentTree = useMemo(() => buildCommentTree(comments), [comments]);

  function toggleExpandedReplies(commentId: number) {
    setExpandedReplyIds((current) => {
      const next = new Set(current);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  }

  function startReply(comment: CommentRow) {
    if (!isSignedIn) {
      setNeedsSignIn(true);
      requireSignIn();
      return;
    }
    setReplyToId(comment.id);
    setReplyDraft('');
  }

  async function submitComment() {
    const body = draft.trim();
    if (!body || posting) return;

    if (!isSignedIn) {
      setNeedsSignIn(true);
      requireSignIn();
      return;
    }

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

    if (!isSignedIn) {
      setNeedsSignIn(true);
      requireSignIn();
      return;
    }

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
        requireSignIn();
        return;
      }
      if (!res.ok) throw new Error(data.error ?? 'Reply could not be saved.');

      setExpandedReplyIds((current) => new Set(current).add(parentId));
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

    setComments((prev) =>
      prev.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              likedByMe: !currentlyLiked,
              likesCount: currentlyLiked ? Math.max(0, comment.likesCount - 1) : comment.likesCount + 1,
            }
          : comment,
      ),
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
      setComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                likedByMe: currentlyLiked,
                likesCount: currentlyLiked ? comment.likesCount + 1 : Math.max(0, comment.likesCount - 1),
              }
            : comment,
        ),
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
      const res = await fetch(`/api/comments/${commentId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Comment could not be deleted.');
      await loadComments();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Comment could not be deleted.');
    } finally {
      setDeletingId(null);
    }
  }

  function renderReplyComposer(comment: CommentRow) {
    if (replyToId !== comment.id) return null;
    return (
      <div className="mt-3 flex flex-col gap-2 rounded-[10px] border border-white/[0.06] bg-[#0d1520]/70 p-3">
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-cyan">
          Replying to {displayName(comment)}
        </p>
        <textarea
          value={replyDraft}
          onChange={(event) => setReplyDraft(event.target.value.slice(0, COMMENT_MAX_LENGTH))}
          placeholder="Write a reply..."
          rows={2}
          className="w-full resize-y rounded-[10px] border border-white/[0.08] bg-[#09111d] px-3 py-2 text-sm text-[#e2e8f0] outline-none transition-colors placeholder:text-muted focus:border-cyan/50"
        />
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setReplyToId(null)}
            className="rounded-[6px] border border-white/[0.08] px-3 py-1 text-xs font-black text-muted transition-colors hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={postingReply || replyDraft.trim().length === 0}
            onClick={() => void submitReply(comment.id)}
            className="rounded-[6px] bg-cyan px-3 py-1 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {postingReply && replyToId === comment.id ? 'Replying...' : 'Reply'}
          </button>
        </div>
      </div>
    );
  }

  function renderCommentActions(comment: CommentRow) {
    const isAuthor = address && comment.authorAddress.toLowerCase() === address.toLowerCase();
    const isEditing = editingCommentId === comment.id;
    if (!isAuthor || isEditing) return null;

    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setEditingCommentId(comment.id);
            setEditDraft(comment.body);
          }}
          className="rounded-[6px] p-1 text-[#8fa0b4] transition-all hover:bg-white/[0.04] hover:text-cyan"
          title="Edit comment"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void handleDelete(comment.id)}
          disabled={deletingId === comment.id}
          className="rounded-[6px] p-1 text-[#8fa0b4] transition-all hover:bg-white/[0.04] hover:text-red-400 disabled:opacity-50"
          title="Delete comment"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  function renderCommentBody(comment: CommentRow) {
    if (editingCommentId !== comment.id) {
      return <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#cbd5e1]">{comment.body}</p>;
    }

    return (
      <div className="mt-2 flex flex-col gap-2">
        <textarea
          value={editDraft}
          onChange={(event) => setEditDraft(event.target.value.slice(0, COMMENT_MAX_LENGTH))}
          rows={2}
          className="w-full resize-y rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2 text-sm text-[#e2e8f0] outline-none transition-colors focus:border-cyan/50"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditingCommentId(null)}
            className="rounded-[6px] border border-white/[0.08] px-3 py-1.5 text-xs font-black text-muted transition-colors hover:text-white"
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
    );
  }

  function renderComment(node: CommentThreadNode<CommentRow>, depth = 0) {
    const { visible, hiddenCount } = getVisibleReplies(node, expandedReplyIds, REPLY_PREVIEW_LIMIT);
    const hasChildren = node.children.length > 0;
    const inset = depth === 0 ? 0 : Math.min(depth, 3) * 18;

    return (
      <div key={node.id} style={{ marginLeft: inset }} className={depth === 0 ? 'py-4' : 'pt-3'}>
        <article className={depth > 0 ? 'border-l border-white/[0.07] pl-3' : ''}>
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <CommentAvatar comment={node} />
              <span className="font-black text-cyan">{displayName(node)}</span>
              <span>{new Date(node.createdAt).toLocaleString()}</span>
              {node.editedAt ? <span className="text-muted/60">· edited</span> : null}
            </div>
            {renderCommentActions(node)}
          </div>

          {renderCommentBody(node)}

          {editingCommentId !== node.id ? (
            <div className="mt-2.5 flex items-center gap-4 text-xs">
              <button
                type="button"
                onClick={() => void toggleLike(node.id, !!node.likedByMe)}
                className={`flex items-center gap-1.5 font-bold transition-colors ${
                  node.likedByMe ? 'text-cyan' : 'text-[#8fa0b4] hover:text-white'
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill={node.likedByMe ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" className="opacity-85">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                </svg>
                <span>{node.likesCount}</span>
              </button>
              <button
                type="button"
                onClick={() => startReply(node)}
                className="flex items-center gap-1.5 font-bold text-[#8fa0b4] transition-colors hover:text-white"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Reply
              </button>
            </div>
          ) : null}

          {renderReplyComposer(node)}
        </article>

        {hasChildren ? (
          <div className="mt-1">
            {visible.map((child) => renderComment(child, depth + 1))}
            {hiddenCount > 0 ? (
              <button
                type="button"
                onClick={() => toggleExpandedReplies(node.id)}
                className="mt-3 border-l border-white/[0.07] pl-3 text-xs font-black text-cyan transition-colors hover:text-white"
                style={{ marginLeft: Math.min(depth + 1, 3) * 18 }}
              >
                See {formatReplyCount(hiddenCount)}
              </button>
            ) : node.children.length > REPLY_PREVIEW_LIMIT ? (
              <button
                type="button"
                onClick={() => toggleExpandedReplies(node.id)}
                className="mt-3 border-l border-white/[0.07] pl-3 text-xs font-black text-[#8fa0b4] transition-colors hover:text-white"
                style={{ marginLeft: Math.min(depth + 1, 3) * 18 }}
              >
                Hide replies
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="mt-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <h2 className="text-xl font-black text-white">Comments</h2>
      </div>

      <div className="mt-4">
        {isSignedIn ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, COMMENT_MAX_LENGTH))}
              placeholder="Share your take on this market..."
              rows={3}
              className="w-full resize-y rounded-[10px] border border-white/[0.08] bg-[#0d1520] px-3 py-2 text-sm text-[#e2e8f0] outline-none transition-colors placeholder:text-muted focus:border-cyan/50"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted">{draft.length}/{COMMENT_MAX_LENGTH}</span>
              <button
                type="button"
                onClick={() => void submitComment()}
                disabled={posting || draft.trim().length === 0}
                className="rounded-[8px] bg-cyan px-4 py-2 text-xs font-black text-[#07111f] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {posting ? 'Posting...' : 'Post comment'}
              </button>
            </div>
            {postError ? <p className="text-xs text-yellow-200">{postError}</p> : null}
          </div>
        ) : isConnected || needsSignIn ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-white/[0.06] bg-[#0d1520] px-3 py-3">
            <p className="text-sm text-muted">Sign in with your wallet to join the discussion.</p>
            <SocialSignInButton onSignedIn={() => setNeedsSignIn(false)} />
          </div>
        ) : (
          <p className="text-sm text-muted">Connect a wallet to join the discussion.</p>
        )}
      </div>

      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}

      <div className="mt-5 max-h-[400px] overflow-y-auto scrollbar-hide divide-y divide-white/[0.06]">
        {loading ? (
          <p className="py-6 text-sm text-muted">Loading comments...</p>
        ) : commentTree.length === 0 ? (
          <p className="py-6 text-sm text-muted">No comments yet.</p>
        ) : (
          commentTree.map((comment) => renderComment(comment))
        )}
      </div>
    </section>
  );
}
