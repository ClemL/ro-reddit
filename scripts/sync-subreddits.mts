/**
 * Rewrites `config/subreddits.json` from the subreddits your Reddit account subscribes to.
 *
 * Run it locally, review the diff, commit the result. The deployed app never runs this and never
 * sees your account credentials: it keeps using the app-only `client_credentials` grant.
 *
 *   npm run sync-subreddits -- --dry-run
 *   npm run sync-subreddits -- --limit 25 --sort subscribers --min-subscribers 5000
 *
 * Subscriptions are private to an account. There is no way to read them from a username alone —
 * `/subreddits/mine/subscriber` returns the subscriptions of whoever owns the token, which is why
 * this needs a user-context token rather than the app-only one.
 *
 * The filtering and option rules live in ./lib/subreddit-selection.mts; this file handles
 * credentials, the Reddit calls and the files written.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HelpRequested,
  OptionError,
  parseArgs,
  selectSubreddits,
  timestamp,
  toSubscription,
  type Subscription,
} from "./lib/subreddit-selection.mts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const OAUTH_BASE = "https://oauth.reddit.com";

/** Kept in sync with `USER_AGENT` in lib/reddit.ts. */
const USER_AGENT = "personal-reddit-reader/0.1 by ClemL";

const ONEDRIVE_URL = "https://inscriptrx-my.sharepoint.com/";

function fail(message: string): never {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

/* ---------------------------------------------------------- env + secrets */

/**
 * Minimal `.env.local` reader. The script runs outside Next.js, so nothing loads that file for us.
 * Values already present in the environment win, so a one-off `REDDIT_PASSWORD=… npm run …` still
 * works without a file on disk.
 */
function loadEnvLocal(): void {
  const path = resolve(REPO_ROOT, ".env.local");
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function readCredentials() {
  const missing = [
    "REDDIT_CLIENT_ID",
    "REDDIT_CLIENT_SECRET",
    "REDDIT_USERNAME",
    "REDDIT_PASSWORD",
  ].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    fail(
      `Missing ${missing.join(", ")}.\n` +
        'Add them to .env.local (see README.md, "Syncing the list from your subscriptions").\n' +
        "REDDIT_USERNAME / REDDIT_PASSWORD are used by this script only — never set them in Vercel."
    );
  }

  return {
    clientId: process.env.REDDIT_CLIENT_ID as string,
    clientSecret: process.env.REDDIT_CLIENT_SECRET as string,
    username: process.env.REDDIT_USERNAME as string,
    secret: process.env.REDDIT_PASSWORD as string,
  };
}

/* ------------------------------------------------------------ reddit calls */

/**
 * User-context token via Reddit's resource-owner grant. Requires an app of type **script** whose
 * owner/developer is this same account. The token lives in this process only, never on disk.
 */
async function getUserToken(): Promise<string> {
  const { clientId, clientSecret, username, secret } = readCredentials();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: "password",
      username,
      password: secret,
      scope: "mysubreddits read",
    }).toString(),
  });

  if (response.status === 401) {
    fail(
      "Reddit rejected the credentials (401). Check, in this order:\n" +
        "  1. The app at https://www.reddit.com/prefs/apps is type `script` — installed and web\n" +
        "     apps cannot use this grant at all.\n" +
        `  2. That app is owned by (or lists as developer) u/${process.env.REDDIT_USERNAME}.\n` +
        "  3. REDDIT_CLIENT_ID is the string under the app name, not the app name itself.\n" +
        "  4. Two-factor auth: append the current 6-digit code, i.e. REDDIT_PASSWORD=secret:123456\n" +
        "     — it expires in 30 seconds, so re-run promptly."
    );
  }
  if (!response.ok) {
    fail(
      `Reddit token request failed (${response.status}). ${(await response.text()).slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as { access_token?: string; error?: string };
  if (payload.error) {
    fail(`Reddit token request returned "${payload.error}". A \`script\`-type app is required.`);
  }
  if (!payload.access_token) fail("Reddit token response contained no access_token.");

  return payload.access_token;
}

type SubredditListing = {
  data?: {
    after?: string | null;
    children?: { kind?: string; data?: Record<string, unknown> }[];
  };
};

/** Pages through /subreddits/mine/subscriber (100 per request, `after` cursor). */
async function fetchSubscriptions(token: string): Promise<Subscription[]> {
  const collected: Subscription[] = [];
  let after: string | null = null;
  let page = 0;

  do {
    const url = new URL("/subreddits/mine/subscriber", OAUTH_BASE);
    url.searchParams.set("limit", "100");
    url.searchParams.set("raw_json", "1");
    if (after) url.searchParams.set("after", after);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });

    reportRateLimit(response.headers);

    if (response.status === 429) {
      fail("Rate limited by Reddit while listing subscriptions. Wait a minute and re-run.");
    }
    if (response.status === 403) {
      fail("Reddit returned 403. The token lacks the `mysubreddits` scope — re-run for a new one.");
    }
    if (!response.ok) {
      fail(
        `Listing subscriptions failed (${response.status}). ${(await response.text()).slice(0, 300)}`
      );
    }

    const listing = (await response.json()) as SubredditListing;

    for (const child of listing.data?.children ?? []) {
      if (child.kind !== "t5") continue;
      collected.push(toSubscription(child.data ?? {}));
    }

    after = listing.data?.after ?? null;
    page += 1;
  } while (after && page < 20); // 20 pages * 100 = 2000 subscriptions, past any real account

  return collected.filter((subscription) => subscription.name.length > 0);
}

function reportRateLimit(headers: Headers): void {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining !== null && reset !== null) {
    console.log(`  rate limit: ${remaining} requests left, window resets in ${reset}s`);
  }
}

/* ------------------------------------------------------------------- main */

async function main(): Promise<void> {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof HelpRequested) {
      console.log(error.message);
      return;
    }
    if (error instanceof OptionError) fail(error.message);
    throw error;
  }

  loadEnvLocal();

  console.log("Requesting a user-context token…");
  const token = await getUserToken();

  console.log(`Listing subscriptions for u/${process.env.REDDIT_USERNAME}…`);
  const subscriptions = await fetchSubscriptions(token);
  console.log(`  ${subscriptions.length} subscriptions returned by Reddit`);

  const { kept, rejected } = selectSubreddits(subscriptions, options);

  if (rejected.length > 0) {
    console.log(`\nSkipped ${rejected.length}:`);
    for (const { name, reason } of rejected) console.log(`  r/${name} — ${reason}`);
  }

  console.log(`\nKeeping ${kept.length} subreddit${kept.length === 1 ? "" : "s"}:`);
  for (const subscription of kept) {
    console.log(`  r/${subscription.name} (${subscription.subscribers.toLocaleString("en-US")})`);
  }

  if (kept.length === 0) {
    fail("Nothing left after filtering; refusing to write an empty list.");
  }
  if (kept.length > 25) {
    console.log(
      `\nNote: the home page spends one Reddit request per subreddit per load, so ${kept.length} ` +
        `subreddits means ${kept.length} requests against a budget of roughly 100/minute. ` +
        "Consider --limit 25."
    );
  }

  if (options.dryRun) {
    console.log("\n--dry-run: no files written.");
    return;
  }

  const configPath = resolve(REPO_ROOT, options.out);
  const config = { subreddits: kept.map((subscription) => subscription.name) };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${configPath}`);

  // Timestamped export copy, carrying the detail the config file does not keep.
  const resultsDir = resolve(REPO_ROOT, "results");
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true });
  const exportPath = resolve(resultsDir, `subreddits_${timestamp()}.json`);
  writeFileSync(
    exportPath,
    `${JSON.stringify(
      {
        syncedAt: new Date().toISOString(),
        account: process.env.REDDIT_USERNAME,
        options,
        kept,
        rejected,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  console.log(`Wrote ${exportPath}`);
  console.log(`Upload to OneDrive: ${ONEDRIVE_URL}`);
  console.log("\nReview the diff (`git diff config/subreddits.json`), then commit and redeploy.");
}

main().catch((error: unknown) => {
  console.error("\nsync-subreddits failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
