import { NextResponse } from "next/server";
import { getPostWithComments } from "@/lib/reddit";
import type { CommentsResponse } from "@/lib/types";
import { isValidPostId, isValidSubredditName } from "@/lib/subreddits";
import { badRequest, currentRateLimitInfo, toErrorResponse } from "@/lib/api-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/comments?subreddit=dotnet&id=abc123 — one post plus its comment tree. */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const subreddit = params.get("subreddit")?.trim() ?? "";
  const id = params.get("id")?.trim() ?? "";

  if (!isValidSubredditName(subreddit)) {
    return badRequest("A valid `subreddit` query parameter is required.");
  }
  if (!isValidPostId(id)) {
    return badRequest("A valid `id` query parameter is required.");
  }

  try {
    const { post, comments } = await getPostWithComments(subreddit, id);
    return NextResponse.json<CommentsResponse>({
      post,
      comments,
      rateLimit: currentRateLimitInfo(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
