import { getConfiguredSubreddits } from "@/lib/subreddits";
import SubredditSection from "./components/SubredditSection";

// Each section fetches on the client from /api/top, so nothing here is prerendered stale.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const subreddits = getConfiguredSubreddits();

  return (
    <>
      <h1>Top posts, last 24 hours</h1>
      <p className="muted">
        {subreddits.length} subreddit{subreddits.length === 1 ? "" : "s"} from{" "}
        <code>config/subreddits.json</code>. Edit that file to change the list.
      </p>

      {subreddits.length === 0 ? (
        <p className="notice warn">
          No valid subreddits configured. Add names to <code>config/subreddits.json</code>.
        </p>
      ) : (
        subreddits.map((subreddit) => (
          <SubredditSection key={subreddit} subreddit={subreddit} limit={5} />
        ))
      )}
    </>
  );
}
