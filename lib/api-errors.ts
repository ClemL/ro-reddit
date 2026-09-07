import "server-only";
import { NextResponse } from "next/server";
import {
  RedditApiError,
  RedditConfigError,
  RedditRateLimitError,
  getRateLimitSnapshot,
  secondsUntilReset,
} from "@/lib/reddit";
import type { ApiErrorBody, RateLimitInfo } from "@/lib/types";

export function currentRateLimitInfo(): RateLimitInfo {
  const snapshot = getRateLimitSnapshot();
  if (!snapshot) return null;
  return {
    remaining: snapshot.remaining,
    resetSeconds: secondsUntilReset(snapshot),
  };
}

export function badRequest(message: string): NextResponse<ApiErrorBody> {
  return NextResponse.json<ApiErrorBody>({ error: message, kind: "bad_request" }, { status: 400 });
}

/** Turns any thrown value into a JSON response — route handlers never crash the app. */
export function toErrorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof RedditRateLimitError) {
    return NextResponse.json<ApiErrorBody>(
      {
        error: `Rate limited by Reddit, try again in ${error.retryAfterSeconds}s`,
        kind: "rate_limited",
        retryAfterSeconds: error.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } }
    );
  }

  if (error instanceof RedditConfigError) {
    return NextResponse.json<ApiErrorBody>({ error: error.message, kind: "config" }, { status: 500 });
  }

  if (error instanceof RedditApiError) {
    // Upstream 4xx is surfaced as 502 unless it is a plain "not found".
    const status = error.status === 404 ? 404 : 502;
    return NextResponse.json<ApiErrorBody>({ error: error.message, kind: "reddit" }, { status });
  }

  const message = error instanceof Error ? error.message : "Unexpected error.";
  return NextResponse.json<ApiErrorBody>({ error: message, kind: "unknown" }, { status: 500 });
}
