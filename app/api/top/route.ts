import { NextResponse } from "next/server";
import { getTopPosts } from "@/lib/reddit";
import type { TopPostsResponse } from "@/lib/types";
import { isValidSubredditName } from "@/lib/subreddits";
import { badRequest, currentRateLimitInfo, toErrorResponse } from "@/lib/api-errors";

// Reddit calls must run per-request on the server; never prerender this route.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/top?subreddit=dotnet&limit=5 — top posts of the last 24 hours. */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const subreddit = params.get("subreddit")?.trim() ?? "";
  if (!isValidSubredditName(subreddit)) {
    return badRequest("A valid `subreddit` query parameter is required.");
  }

  const limitParam = Number.parseInt(params.get("limit") ?? "5", 10);
  const limit = Number.isNaN(limitParam) ? 5 : Math.min(Math.max(limitParam, 1), 25);

  try {
    const posts = await getTopPosts(subreddit, limit);
    return NextResponse.json<TopPostsResponse>({
      subreddit,
      posts,
      rateLimit: currentRateLimitInfo(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
