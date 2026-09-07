import config from "@/config/subreddits.json";

/**
 * The subreddit list is plain config — edit `config/subreddits.json` and redeploy.
 * Names are validated here so a typo surfaces as a clear error instead of a 404
 * from Reddit, and so nothing from the config can be spliced into a URL path.
 */
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{2,21}$/;

export function isValidSubredditName(name: string): boolean {
  return SUBREDDIT_PATTERN.test(name);
}

export function getConfiguredSubreddits(): string[] {
  const names = Array.isArray(config.subreddits) ? config.subreddits : [];
  return names.filter((name): name is string => typeof name === "string" && isValidSubredditName(name));
}

/** Reddit post ids are base-36; reject anything else before building a path. */
export function isValidPostId(id: string): boolean {
  return /^[a-z0-9]{4,12}$/i.test(id);
}
