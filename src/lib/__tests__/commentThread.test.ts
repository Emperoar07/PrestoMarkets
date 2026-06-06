import { describe, expect, it } from 'vitest';
import { buildCommentTree, getVisibleReplies } from '../commentThread';

type Row = {
  id: number;
  parentId?: number | null;
  createdAt: string;
  body: string;
};

const row = (id: number, parentId: number | null, createdAt: string): Row => ({
  id,
  parentId,
  createdAt,
  body: `comment-${id}`,
});

describe('commentThread', () => {
  it('builds a recursive reply tree for replies to replies', () => {
    const tree = buildCommentTree([
      row(4, 3, '2026-06-06T10:03:00.000Z'),
      row(3, 2, '2026-06-06T10:02:00.000Z'),
      row(2, 1, '2026-06-06T10:01:00.000Z'),
      row(1, null, '2026-06-06T10:00:00.000Z'),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(1);
    expect(tree[0].children[0].id).toBe(2);
    expect(tree[0].children[0].children[0].id).toBe(3);
    expect(tree[0].children[0].children[0].children[0].id).toBe(4);
  });

  it('collapses each reply branch until it is expanded', () => {
    const [parent] = buildCommentTree([
      row(1, null, '2026-06-06T10:00:00.000Z'),
      row(2, 1, '2026-06-06T10:01:00.000Z'),
      row(3, 1, '2026-06-06T10:02:00.000Z'),
      row(4, 1, '2026-06-06T10:03:00.000Z'),
    ]);

    expect(getVisibleReplies(parent, new Set(), 2)).toMatchObject({
      hiddenCount: 1,
      visible: [{ id: 2 }, { id: 3 }],
    });
    expect(getVisibleReplies(parent, new Set([1]), 2)).toMatchObject({
      hiddenCount: 0,
      visible: [{ id: 2 }, { id: 3 }, { id: 4 }],
    });
  });
});
