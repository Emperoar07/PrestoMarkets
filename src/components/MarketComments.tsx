'use client';

import { useEffect, useState } from 'react';

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

export function MarketComments({ marketId }: { marketId: string }) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

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

  return (
    <section className="mt-8 rounded-[14px] border border-white/[0.06] bg-[#111b2b] p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-black text-white">Comments</h2>
        </div>
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
