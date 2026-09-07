/**
 * Pure option parsing and filtering for `scripts/sync-subreddits.mts`.
 *
 * Kept free of credentials, network calls and file I/O so the selection rules — which decide what
 * ends up in config/subreddits.json — can be exercised on their own.
 */

/** Subreddit types an app-only token can actually read once the list is deployed. */
export const READABLE_TYPES = new Set(["public", "restricted", "archived"]);

/** Same rule lib/subreddits.ts applies at read time, so a synced list is never rejected there. */
export const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{2,21}$/;

export type Options = {
  limit: number;
  sort: "name" | "subscribers";
  minSubscribers: number;
  includeNsfw: boolean;
  dryRun: boolean;
  out: string;
};

export const DEFAULTS: Options = {
  limit: 0, // 0 = keep every subscription
  sort: "name",
  minSubscribers: 0,
  includeNsfw: false,
  dryRun: false,
  out: "config/subreddits.json",
};

export const HELP = `
Sync config/subreddits.json from your Reddit subscriptions.

Usage: npm run sync-subreddits -- [options]

  --limit N                Keep only the first N subreddits after sorting (default: ${DEFAULTS.limit}, meaning all)
  --sort name|subscribers  Order of the written list (default: ${DEFAULTS.sort})
  --min-subscribers N      Drop subreddits smaller than N subscribers (default: ${DEFAULTS.minSubscribers})
  --include-nsfw           Keep subreddits flagged over-18 (default: ${DEFAULTS.includeNsfw}, they are dropped)
  --dry-run                Print the result without writing any file (default: ${DEFAULTS.dryRun})
  --out PATH               Config file to rewrite (default: ${DEFAULTS.out})
  --help                   Show this message

Reads REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME and REDDIT_PASSWORD from .env.local.
`.trim();

/** Thrown for a bad command line; the CLI turns it into a message and a non-zero exit. */
export class OptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptionError";
  }
}

/** Signals `--help`, so the CLI can print usage and exit 0 rather than treat it as a failure. */
export class HelpRequested extends Error {
  constructor() {
    super(HELP);
    this.name = "HelpRequested";
  }
}

export function parseArgs(argv: string[]): Options {
  const options: Options = { ...DEFAULTS };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new OptionError(`${arg} needs a value.`);
      i += 1;
      return next;
    };

    switch (arg) {
      case "--help":
      case "-h":
        throw new HelpRequested();
      case "--limit":
        options.limit = requireNonNegativeInt(arg, value());
        break;
      case "--min-subscribers":
        options.minSubscribers = requireNonNegativeInt(arg, value());
        break;
      case "--sort": {
        const sort = value();
        if (sort !== "name" && sort !== "subscribers") {
          throw new OptionError("--sort must be `name` or `subscribers`.");
        }
        options.sort = sort;
        break;
      }
      case "--include-nsfw":
        options.includeNsfw = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--out":
        options.out = value();
        break;
      default:
        throw new OptionError(`Unknown option: ${arg}\n\n${HELP}`);
    }
  }

  return options;
}

function requireNonNegativeInt(flag: string, raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new OptionError(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

export type Subscription = {
  name: string;
  title: string;
  subscribers: number;
  type: string;
  nsfw: boolean;
  quarantined: boolean;
};

export type Rejection = { name: string; reason: string };

/**
 * Applies the filters, then sorts. Rejections carry a reason so the CLI can explain every
 * subscription it left out.
 */
export function selectSubreddits(
  subscriptions: Subscription[],
  options: Options
): { kept: Subscription[]; rejected: Rejection[] } {
  const rejected: Rejection[] = [];
  const kept: Subscription[] = [];

  for (const subscription of subscriptions) {
    const { name } = subscription;
    if (name.startsWith("u_")) {
      rejected.push({ name, reason: "profile subreddit" });
    } else if (!SUBREDDIT_PATTERN.test(name)) {
      rejected.push({ name, reason: "name fails validation" });
    } else if (!READABLE_TYPES.has(subscription.type)) {
      // The deployed app reads with an app-only token, which cannot see private subreddits.
      rejected.push({ name, reason: `${subscription.type} — unreadable app-only` });
    } else if (subscription.quarantined) {
      rejected.push({ name, reason: "quarantined — unreadable app-only" });
    } else if (subscription.nsfw && !options.includeNsfw) {
      rejected.push({ name, reason: "NSFW (use --include-nsfw to keep)" });
    } else if (subscription.subscribers < options.minSubscribers) {
      rejected.push({ name, reason: `${subscription.subscribers} subscribers < --min-subscribers` });
    } else {
      kept.push(subscription);
    }
  }

  kept.sort((a, b) =>
    options.sort === "subscribers"
      ? b.subscribers - a.subscribers
      : a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );

  return { kept: options.limit > 0 ? kept.slice(0, options.limit) : kept, rejected };
}

/** `yyyyMMdd_HHmm` in local time, for the timestamped export filename. */
export function timestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}`
  );
}

/** Maps one `t5` listing child onto a Subscription, tolerating missing or oddly-typed fields. */
export function toSubscription(data: Record<string, unknown>): Subscription {
  return {
    name: typeof data.display_name === "string" ? data.display_name : "",
    title: typeof data.title === "string" ? data.title : "",
    subscribers: typeof data.subscribers === "number" ? data.subscribers : 0,
    type: typeof data.subreddit_type === "string" ? data.subreddit_type : "unknown",
    // t5 objects spell this `over18`; t3 objects spell it `over_18`. Accept either.
    nsfw: data.over18 === true || data.over_18 === true,
    quarantined: data.quarantine === true,
  };
}
