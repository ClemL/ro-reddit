import { notFound } from "next/navigation";
import PostDetail from "@/app/components/PostDetail";
import { isValidPostId, isValidSubredditName } from "@/lib/subreddits";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ subreddit: string; id: string }>;
};

export default async function PostPage({ params }: Props) {
  const { subreddit, id } = await params;

  if (!isValidSubredditName(subreddit) || !isValidPostId(id)) {
    notFound();
  }

  return <PostDetail subreddit={subreddit} postId={id} />;
}
