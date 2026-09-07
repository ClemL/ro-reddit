# ro-reddit

A read-only Reddit reader: for a fixed list of subreddits, show the top 5 posts of the last 24
hours, and let you drill into any post to read its self-text (or its outbound link) plus the full
comment tree as nested indented text.

Next.js 16 (App Router) + TypeScript, deployed on Vercel. No database, no user login, no app-level
auth — it is a personal tool.

## Environment variables (required)

The app talks to Reddit with the OAuth2 **`client_credentials`** grant (app-only, no user login),
so it needs a Reddit app's credentials:

| Variable               | Where it comes from                                                     |
| ---------------------- | ----------------------------------------------------------------------- |
| `REDDIT_CLIENT_ID`     | The string under the app name at <https://www.reddit.com/prefs/apps>     |
| `REDDIT_CLIENT_SECRET` | The `secret` field of the same app                                      |

Create the app at <https://www.reddit.com/prefs/apps> → **create another app...** → type
**script** (or **web app**). The redirect URI is unused by the `client_credentials` grant; any
valid URL, e.g. `http://localhost:3000`, is fine.

Both are read server-side with `process.env` inside `lib/reddit.ts`, which starts with
`import "server-only"` — the build fails if that module is ever pulled into a client component, so
the credentials cannot reach the browser. They are never hardcoded and never sent to the client.

### Set them in Vercel before you deploy

In the Vercel dashboard: **Project → Settings → Environment Variables → Add New**, once for each
variable, applied to Production, Preview, and Development. Add them **before** the first deploy;
if you add them afterwards, redeploy so the running build picks them up.

With the Vercel CLI instead:

```bash
vercel env add REDDIT_CLIENT_ID production
vercel env add REDDIT_CLIENT_SECRET production
```

Without both variables, every API route returns HTTP 500 with
`REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set (see README.md).`, and the page renders that
message instead of crashing.

### Set them locally for development

Create `.env.local` in the repo root (copy `.env.example`):

```bash
cp .env.example .env.local
# then edit .env.local:
# REDDIT_CLIENT_ID=your_client_id_here
# REDDIT_CLIENT_SECRET=your_client_secret_here
```

`.env.local` **is listed in `.gitignore`** (together with `.env` and the other `.env.*.local`
files), so credentials cannot be committed. `.env.example` holds placeholders only and is safe to
commit.

Then:

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm run typecheck`.

## Configuring the subreddit list

Edit `config/subreddits.json` — that is the whole configuration:

```json
{
  "subreddits": ["programming", "dotnet", "azure", "sysadmin", "ExperiencedDevs", "devops"]
}
```

Names are validated against `^[A-Za-z0-9_]{2,21}$` in `lib/subreddits.ts`; an invalid entry is
skipped rather than sent to Reddit. Changes take effect on the next build/deploy.

## How it works

```
app/page.tsx                       server component; reads the config, renders one section per subreddit
app/components/SubredditSection.tsx  client; GET /api/top?subreddit=…&limit=5
app/post/[subreddit]/[id]/page.tsx   server component; validates the route params
app/components/PostDetail.tsx        client; GET /api/comments?subreddit=…&id=…
app/components/CommentTree.tsx       recursive nested-text rendering of the comment tree
app/api/top/route.ts                 route handler → getTopPosts()
app/api/comments/route.ts            route handler → getPostWithComments()
lib/reddit.ts                        server-only: token cache, rate limits, Reddit fetches, JSON mapping
lib/types.ts                         shapes shared by routes and client components (types only)
```

Every Reddit request happens inside a route handler under `app/api/`. Client components only ever
call this app's own `/api/*` endpoints.

### Token caching

`lib/reddit.ts` holds the app-only token in a module-scoped variable
(`{ accessToken, expiresAt }`) shared by both route handlers, and re-requests it when the cached
copy is within 60 seconds of expiry. Concurrent misses collapse onto a single token request. A 401
from Reddit forces one refresh and retries the call once. Because this is process memory, each warm
serverless instance keeps its own copy and a cold start fetches a new token — Reddit's app-only
tokens last ~24 hours, so this is a handful of extra token requests per day, not per page view.

### User-Agent

Every request to Reddit — the token request included — sends
`User-Agent: personal-reddit-reader/0.1 by ClemL` (`USER_AGENT` in `lib/reddit.ts`). Reddit
throttles generic or missing User-Agents aggressively, so keep it descriptive and unique.

### Rate limits

`X-Ratelimit-Remaining` and `X-Ratelimit-Reset` are read off every response and kept in module
memory. Two things follow:

- Successful API responses carry a `rateLimit: { remaining, resetSeconds }` field, shown in the
  UI as "N requests left in window".
- When the last observed `remaining` is 0 and the window has not yet reset, the next call fails
  **before** spending a request, and an HTTP 429 from Reddit is translated the same way. Either
  way the response is `{ error, kind: "rate_limited", retryAfterSeconds }` with a `Retry-After`
  header, and the page shows `Rate limited, try again in Ns` with a Retry button that enables when
  the countdown reaches zero. Nothing crashes.

Reddit's app-only budget is roughly 100 requests per minute per client id, averaged over a
10-minute window. The home page spends one request per configured subreddit per load.

Note: React Strict Mode is on, so in `next dev` each section fetches twice on mount. Production
builds fetch once.

## Deploying to Vercel

1. Push this repository to GitHub.
2. Import it in Vercel; the framework preset (Next.js) needs no changes.
3. Add `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` as above.
4. Deploy.

All routes are `force-dynamic`, and every Reddit fetch uses `cache: "no-store"`, so pages always
reflect the current top-of-day listing.

## Limitations

- Text only, by design: no image, video, or thumbnail rendering, and Markdown in post bodies and
  comments is shown as raw text.
- Deep threads: Reddit truncates its own reply trees. Untruncated branches render as
  "N more replies not loaded" rather than issuing follow-up `morechildren` requests.
- No search, no sorting controls, no pagination — top 5 of the last 24 hours per subreddit.
