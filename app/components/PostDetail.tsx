"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/client-api";
import { formatAge, formatScore } from "@/lib/format";
import type { CommentsResponse } from "@/lib/types";
import CommentTree from "./CommentTree";
import ErrorNotice from "./ErrorNotice";

type Props = {
  subreddit: string;
  postId: string;
};

/** Detail view: post body or outbound link, plus the full comment tree. */
export default function PostDetail({ subreddit, postId }: Props) {
  const [data, setData] = useState<CommentsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchApi<CommentsResponse>(
      `/api/comments?subreddit=${encodeURIComponent(subreddit)}&id=${encodeURIComponent(postId)}`,
      controller.signal
    )
      .then((payload) => setData(payload))
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [subreddit, postId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (error) {
    return (
      <>
        <p className="muted">
          <Link href="/">← back to all subreddits</Link>
        </p>
        <ErrorNotice error={error} onRetry={retry} />
      </>
    );
  }

  if (loading || !data) {
    return (
      <>
        <p className="muted">
          <Link href="/">← back to all subreddits</Link>
        </p>
        <p className="muted">Loading r/{subreddit} post {postId}…</p>
      </>
    );
  }

  const { post, comments } = data;

  return (
    <>
      <p className="muted">
        <Link href="/">← back to all subreddits</Link>
      </p>

      <h1>{post.title}</h1>
      <p className="meta">
        <span className="badge">{post.postType === "self" ? "self" : "link"}</span> r/
        {post.subreddit} · {formatScore(post.score)} points · u/{post.author} ·{" "}
        {post.numComments.toLocaleString("en-US")} comments · {formatAge(post.createdUtc)}
        {post.over18 ? " · NSFW" : ""}
      </p>

      {post.postType === "self" ? (
        post.selfText && post.selfText.trim().length > 0 ? (
          <div className="selftext">{post.selfText}</div>
        ) : (
          <p className="muted">(empty self post)</p>
        )
      ) : post.linkUrl ? (
        <p className="selftext">
          Links to:{" "}
          <a href={post.linkUrl} target="_blank" rel="noreferrer noopener">
            {post.linkUrl}
          </a>
        </p>
      ) : (
        <p className="muted">(no link URL on this post)</p>
      )}

      <div className="section">
        <div className="section-head">
          <h2>Comments</h2>
          {data.rateLimit ? (
            <span className="muted">
              {Math.floor(data.rateLimit.remaining)} requests left in window
            </span>
          ) : null}
        </div>
        <CommentTree nodes={comments} />
      </div>

      <p className="muted" style={{ marginTop: "1.5rem" }}>
        <a
          href={`https://www.reddit.com${post.permalink}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          View on reddit.com
        </a>
      </p>
    </>
  );
}
