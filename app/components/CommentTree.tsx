"use client";

import { formatAge, formatScore } from "@/lib/format";
import type { CommentTreeNode } from "@/lib/types";

/** Renders the comment tree as nested indented text — no media, by design. */
export default function CommentTree({ nodes }: { nodes: CommentTreeNode[] }) {
  if (nodes.length === 0) {
    return <p className="muted">No comments.</p>;
  }

  return (
    <div>
      {nodes.map((node) =>
        node.kind === "more" ? (
          <div key={`more-${node.id}-${node.depth}`} className="comment muted">
            {node.count.toLocaleString("en-US")} more {node.count === 1 ? "reply" : "replies"} not
            loaded
          </div>
        ) : (
          <div key={node.id} className="comment">
            <div className="meta">
              u/{node.author}
              {node.isSubmitter ? " (OP)" : ""} · {formatScore(node.score)} points ·{" "}
              {formatAge(node.createdUtc)}
              {node.stickied ? " · stickied" : ""}
            </div>
            <p className="comment-body">{node.body}</p>
            {node.replies.length > 0 ? <CommentTree nodes={node.replies} /> : null}
          </div>
        )
      )}
    </div>
  );
}
