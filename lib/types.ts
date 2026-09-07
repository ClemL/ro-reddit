/**
 * Shapes shared by the route handlers and the client components.
 *
 * This module holds types only, so client components can import it without
 * pulling in `lib/reddit.ts` (which is server-only and reads the credentials).
 */

export type PostType = "self" | "link";

export type RedditPost = {
  id: string;
  subreddit: string;
  title: string;
  author: string;
  score: number;
  numComments: number;
  createdUtc: number;
  postType: PostType;
  /** Body of a self post, `null` for link posts. */
  selfText: string | null;
  /** Outbound URL of a link post, `null` for self posts. */
  linkUrl: string | null;
  permalink: string;
  domain: string;
  over18: boolean;
};

export type CommentNode = {
  kind: "comment";
  id: string;
  author: string;
  body: string;
  score: number;
  createdUtc: number;
  depth: number;
  isSubmitter: boolean;
  stickied: boolean;
  replies: CommentTreeNode[];
};

/** Placeholder Reddit returns instead of the remaining replies in a deep thread. */
export type MoreCommentsNode = {
  kind: "more";
  id: string;
  count: number;
  depth: number;
};

export type CommentTreeNode = CommentNode | MoreCommentsNode;

/** Rate-limit budget echoed on successful responses so the UI can show it. */
export type RateLimitInfo = {
  remaining: number;
  resetSeconds: number;
} | null;

/** Error payload shared by every route handler; the client renders `error` verbatim. */
export type ApiErrorBody = {
  error: string;
  kind: "rate_limited" | "config" | "reddit" | "bad_request" | "unknown";
  retryAfterSeconds?: number;
};

export type TopPostsResponse = {
  subreddit: string;
  posts: RedditPost[];
  rateLimit: RateLimitInfo;
};

export type CommentsResponse = {
  post: RedditPost;
  comments: CommentTreeNode[];
  rateLimit: RateLimitInfo;
};
