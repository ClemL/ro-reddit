/**
 * Server-only Reddit API client.
 *
 * Responsibilities:
 *  - OAuth2 `client_credentials` (app-only) token acquisition + in-memory caching.
 *  - A single `redditFetch` chokepoint that sets the User-Agent and tracks rate limits.
 *  - Typed mapping of Reddit's listing JSON into the shapes the UI consumes.
 *
 * `import "server-only"` makes the build fail if this module is ever pulled into a
 * client component, so REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET cannot leak to the browser.
 */
import "server-only";
import type { CommentTreeNode, RedditPost } from "@/lib/types";

const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const OAUTH_BASE = "https://oauth.reddit.com";

/** Reddit requires a descriptive, unique User-Agent on every request. */
export const USER_AGENT = "personal-reddit-reader/0.1 by ClemL";

/** Refresh the token this many seconds before it actually expires. */
const TOKEN_EXPIRY_SKEW_SECONDS = 60;

/* ------------------------------------------------------------------ errors */

export class RedditConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedditConfigError";
  }
}

export class RedditRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Rate limited by Reddit, try again in ${retryAfterSeconds}s`);
    this.name = "RedditRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class RedditApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "RedditApiError";
    this.status = status;
  }
}

/* ------------------------------------------------------- rate limit state */

export type RateLimitSnapshot = {
  /** Requests left in the current window, as reported by X-Ratelimit-Remaining. */
  remaining: number;
  /** Seconds until the window resets, as reported by X-Ratelimit-Reset. */
  resetSeconds: number;
  /** Epoch ms at which the header above was read, so the reset can be aged. */
  observedAt: number;
};

// Module scope: one snapshot per warm serverless instance.
let rateLimit: RateLimitSnapshot | null = null;

/** Seconds still to wait before the observed window resets (0 once elapsed). */
export function secondsUntilReset(snapshot: RateLimitSnapshot, now = Date.now()): number {
  const elapsed = (now - snapshot.observedAt) / 1000;
  return Math.max(0, Math.ceil(snapshot.resetSeconds - elapsed));
}

export function getRateLimitSnapshot(): RateLimitSnapshot | null {
  return rateLimit;
}

function recordRateLimit(headers: Headers): void {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining === null || reset === null) return;

  const remainingValue = Number.parseFloat(remaining);
  const resetValue = Number.parseFloat(reset);
  if (Number.isNaN(remainingValue) || Number.isNaN(resetValue)) return;

  rateLimit = {
    remaining: remainingValue,
    resetSeconds: resetValue,
    observedAt: Date.now(),
  };
}

/** Throws before spending a request when the last response said the budget is gone. */
function assertRateLimitBudget(): void {
  if (!rateLimit || rateLimit.remaining >= 1) return;
  const wait = secondsUntilReset(rateLimit);
  if (wait <= 0) {
    // Window has rolled over; the next response will refresh the snapshot.
    rateLimit = null;
    return;
  }
  throw new RedditRateLimitError(wait);
}

/* ------------------------------------------------------------ token cache */

type CachedToken = { accessToken: string; expiresAt: number };

// Module scope: survives between invocations on a warm instance, keyed by expiry.
let tokenCache: CachedToken | null = null;
let tokenRequest: Promise<string> | null = null;

function readCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new RedditConfigError(
      "REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set (see README.md)."
    );
  }
  return { clientId, clientSecret };
}

async function requestAccessToken(): Promise<string> {
  const { clientId, clientSecret } = readCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    cache: "no-store",
  });

  recordRateLimit(response.headers);

  if (response.status === 429) {
    throw new RedditRateLimitError(retryAfterFrom(response.headers));
  }
  if (!response.ok) {
    const detail = (await safeText(response)).slice(0, 300);
    throw new RedditApiError(
      response.status,
      `Reddit token request failed (${response.status}). ${detail}`.trim()
    );
  }

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new RedditApiError(response.status, "Reddit token response contained no access_token.");
  }

  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (expiresIn - TOKEN_EXPIRY_SKEW_SECONDS) * 1000,
  };
  return tokenCache.accessToken;
}

/** Returns a cached token when one is still valid, otherwise fetches a fresh one. */
async function getAccessToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    tokenCache = null;
    tokenRequest = null;
  }
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }
  // Collapse concurrent misses onto a single token request.
  if (!tokenRequest) {
    tokenRequest = requestAccessToken().finally(() => {
      tokenRequest = null;
    });
  }
  return tokenRequest;
}

/* --------------------------------------------------------------- fetching */

function retryAfterFrom(headers: Headers): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const parsed = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(parsed)) return Math.max(1, parsed);
  }
  const reset = headers.get("x-ratelimit-reset");
  if (reset) {
    const parsed = Number.parseFloat(reset);
    if (!Number.isNaN(parsed)) return Math.max(1, Math.ceil(parsed));
  }
  return 60;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

async function redditFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  assertRateLimitBudget();

  const url = new URL(path, OAUTH_BASE);
  url.searchParams.set("raw_json", "1");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const send = async (token: string) =>
    fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      cache: "no-store",
    });

  let response = await send(await getAccessToken());
  recordRateLimit(response.headers);

  // A 401 usually means the cached token was revoked early; retry once with a new one.
  if (response.status === 401) {
    response = await send(await getAccessToken(true));
    recordRateLimit(response.headers);
  }

  if (response.status === 429) {
    throw new RedditRateLimitError(retryAfterFrom(response.headers));
  }
  if (response.status === 404) {
    throw new RedditApiError(404, "Not found on Reddit (bad subreddit or post id?).");
  }
  if (!response.ok) {
    const detail = (await safeText(response)).slice(0, 300);
    throw new RedditApiError(
      response.status,
      `Reddit API request failed (${response.status}). ${detail}`.trim()
    );
  }

  return (await response.json()) as T;
}

/* ------------------------------------------------------- response parsing */

type RawThing = { kind?: unknown; data?: unknown };
type RawData = Record<string, unknown>;

function asRecord(value: unknown): RawData {
  return value && typeof value === "object" ? (value as RawData) : {};
}

function str(data: RawData, key: string, fallback = ""): string {
  const value = data[key];
  return typeof value === "string" ? value : fallback;
}

function num(data: RawData, key: string, fallback = 0): number {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(data: RawData, key: string, fallback = false): boolean {
  const value = data[key];
  return typeof value === "boolean" ? value : fallback;
}

function mapPost(thing: RawThing): RedditPost {
  const data = asRecord(thing.data);
  const isSelf = bool(data, "is_self");
  const selfText = str(data, "selftext");
  return {
    id: str(data, "id"),
    subreddit: str(data, "subreddit"),
    title: str(data, "title", "(untitled)"),
    author: str(data, "author", "[unknown]"),
    score: num(data, "score"),
    numComments: num(data, "num_comments"),
    createdUtc: num(data, "created_utc"),
    postType: isSelf ? "self" : "link",
    selfText: isSelf ? selfText : null,
    linkUrl: isSelf ? null : str(data, "url_overridden_by_dest") || str(data, "url") || null,
    permalink: str(data, "permalink"),
    domain: str(data, "domain"),
    over18: bool(data, "over_18"),
  };
}

function mapCommentTree(thing: RawThing, depth: number): CommentTreeNode | null {
  const kind = typeof thing.kind === "string" ? thing.kind : "";
  const data = asRecord(thing.data);

  if (kind === "more") {
    const count = num(data, "count");
    const id = str(data, "id", "more");
    // `more` entries with count 0 are "continue this thread" stubs; keep them out of the UI.
    return count > 0 ? { kind: "more", id, count, depth } : null;
  }

  if (kind !== "t1") return null;

  const repliesListing = asRecord(data["replies"]);
  const repliesData = asRecord(repliesListing["data"]);
  const children = Array.isArray(repliesData["children"]) ? (repliesData["children"] as RawThing[]) : [];

  return {
    kind: "comment",
    id: str(data, "id"),
    author: str(data, "author", "[deleted]"),
    body: str(data, "body", "[no body]"),
    score: num(data, "score"),
    createdUtc: num(data, "created_utc"),
    depth,
    isSubmitter: bool(data, "is_submitter"),
    stickied: bool(data, "stickied"),
    replies: children
      .map((child) => mapCommentTree(child, depth + 1))
      .filter((node): node is CommentTreeNode => node !== null),
  };
}

/* ------------------------------------------------------------ public API */

type Listing = { data?: { children?: RawThing[] } };

/** Top posts of the last 24 hours for a subreddit. */
export async function getTopPosts(subreddit: string, limit = 5): Promise<RedditPost[]> {
  const listing = await redditFetch<Listing>(`/r/${encodeURIComponent(subreddit)}/top`, {
    t: "day",
    limit: String(limit),
  });
  const children = listing.data?.children ?? [];
  return children.filter((child) => child.kind === "t3").map(mapPost);
}

export type PostWithComments = {
  post: RedditPost;
  comments: CommentTreeNode[];
};

/** A single post plus its comment tree. */
export async function getPostWithComments(
  subreddit: string,
  postId: string,
  commentLimit = 200
): Promise<PostWithComments> {
  const payload = await redditFetch<Listing[]>(
    `/r/${encodeURIComponent(subreddit)}/comments/${encodeURIComponent(postId)}`,
    { limit: String(commentLimit), depth: "10", sort: "top" }
  );

  const postChild = payload[0]?.data?.children?.[0];
  if (!postChild) {
    throw new RedditApiError(404, `Post ${postId} not found in r/${subreddit}.`);
  }

  const commentChildren = payload[1]?.data?.children ?? [];
  return {
    post: mapPost(postChild),
    comments: commentChildren
      .map((child) => mapCommentTree(child, 0))
      .filter((node): node is CommentTreeNode => node !== null),
  };
}
