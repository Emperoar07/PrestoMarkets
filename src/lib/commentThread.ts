export type CommentThreadRow = {
  id: number;
  parentId?: number | null;
  createdAt: string;
};

export type CommentThreadNode<T extends CommentThreadRow> = T & {
  children: CommentThreadNode<T>[];
};

function timeValue(row: CommentThreadRow) {
  const value = new Date(row.createdAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function buildCommentTree<T extends CommentThreadRow>(comments: T[]): CommentThreadNode<T>[] {
  const nodes = new Map<number, CommentThreadNode<T>>();
  const roots: CommentThreadNode<T>[] = [];

  comments.forEach((comment) => {
    nodes.set(comment.id, { ...comment, children: [] });
  });

  comments.forEach((comment) => {
    const node = nodes.get(comment.id);
    if (!node) return;

    const parentId = comment.parentId ?? null;
    const parent = parentId === null ? null : nodes.get(parentId);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortChildren = (node: CommentThreadNode<T>) => {
    node.children.sort((a, b) => timeValue(a) - timeValue(b));
    node.children.forEach(sortChildren);
  };

  roots.sort((a, b) => timeValue(b) - timeValue(a));
  roots.forEach(sortChildren);
  return roots;
}

export function getVisibleReplies<T extends CommentThreadRow>(
  node: CommentThreadNode<T>,
  expandedIds: ReadonlySet<number>,
  limit = 2,
): { visible: CommentThreadNode<T>[]; hiddenCount: number } {
  if (expandedIds.has(node.id) || node.children.length <= limit) {
    return { visible: node.children, hiddenCount: 0 };
  }

  return {
    visible: node.children.slice(0, limit),
    hiddenCount: node.children.length - limit,
  };
}
