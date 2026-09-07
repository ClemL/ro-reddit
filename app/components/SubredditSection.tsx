"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/client-api";
import { formatAge, formatScore } from "@/lib/format";
import type { TopPostsResponse } from "@/lib/types";
import ErrorNotice from "./ErrorNotice";

type Props = {
  subreddit: string;
  limit?: number;
};

/** One subreddit's block on the home page: top posts of the last 24 hours. */
export default function SubredditSection({ subreddit, limit = 5 }: Props) {
  const [data, setData] = useState<TopPostsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchApi<TopPostsResponse>(
      `/api/top?subreddit=${encodeURIComponent(subreddit)}&limit=${limit}`,
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
  }, [subreddit, limit, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <section className="section">
      <div className="section-head">
        <h2>r/{subreddit}</h2>
        {loading ? <span className="muted">loading…</span> : null}
        {data?.rateLimit ? (
          <span className="muted">
            {Math.floor(data.rateLimit.remaining)} requests left in window
          </span>
        ) : null}
      </div>

      {error ? <ErrorNotice error={error} onRetry={retry} /> : null}

      {!error && data && data.posts.length === 0 ? (
        <p className="muted">No posts in the last 24 hours.</p>
      ) : null}

      {!error && data && data.posts.length > 0 ? (
        <ol className="posts">
          {data.posts.map((post) => (
            <li key={post.id}>
              <Link className="post-title" href={`/post/${post.subreddit}/${post.id}`}>
                {post.title}
              </Link>
              <div className="meta">
                <span className="badge">{post.postType === "self" ? "self" : "link"}</span>{" "}
                r/{post.subreddit} · {formatScore(post.score)} points · u/{post.author} ·{" "}
                {post.numComments.toLocaleString("en-US")} comments · {formatAge(post.createdUtc)}
                {post.postType === "link" && post.domain ? ` · ${post.domain}` : ""}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
