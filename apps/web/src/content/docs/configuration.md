The website takes its settings when it's built. Each service reads its files from `/etc/plan-video` when it starts.

## The website

`apps/web/.env`, read by the dev server and by `npm run build`. Start from `apps/web/.env.example`.

| Key | | What it does |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Required | Your Supabase project's address. Without it and the key, sign-in is off. |
| `VITE_SUPABASE_ANON_KEY` | Required | Its publishable key, which is safe in a browser |
| `VITE_INVITE_ONLY` | | `false` lets everyone sign up. A build shows the waitlist unless this is `false`; the dev server doesn't unless it's `true`. |
| `VITE_APP_URL` | | Your site's address, like `https://your-domain.com`; set it for every build. Sign-in emails and the networks' logins come back to it, and the dashboard shows the agent address with it. Leave it empty on the dev server, so sign-in comes back to `localhost`. |
| `VITE_SENTRY_DSN` | | A [Sentry](https://sentry.io) project's DSN, for reporting a build's errors. Without it, nothing is reported and Sentry isn't loaded. |
| `VITE_UMAMI_WEBSITE_ID`, `VITE_UMAMI_SCRIPT_URL`, `VITE_UMAMI_DOMAINS` | | [Umami](https://umami.is) analytics. Off when empty. |
| `VITE_PUBLISHER_URL` | | Where the dev server sends `/api/publisher`. Default `VITE_APP_URL`, else `https://plan.video`. Only the dev server reads it. |
| `VITE_API_URL` | | Where the editor's `/api/trpc` calls go. Empty means your own site. |
| `VITE_AGENT_CHAT_URL` | | An agent chat host for the editor. Without it, the editor's agent chat stays off. |
| `VITE_CONNECTOR_DEV` | | `true` turns the agent connector on in the dev server too, through `/api/mcp`. Builds always have it. |

Keys with the `VITE_` prefix are built into the browser bundle, so `apps/web/.env` holds nothing else: the dev server and the build stop if it does.

The secrets the dev server needs to stand in for the services go in `apps/web/server.env`, from `apps/web/server.env.example`: the networks' keys, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, and Stripe's keys with `SUPABASE_SERVICE_ROLE_KEY`. Vite never reads that file, git ignores it, and a build fails if any of its values turns up in what it wrote.

<Warning>
Set `VITE_APP_URL` for every build you put up. Without it, the website takes itself for plan.video: connecting TikTok, YouTube, LinkedIn, X, Instagram, Facebook or Threads asks people to open plan.video, and "Sign in with Bluesky" is off.
</Warning>

## Shared: r2.env

Read by every service except `mcp`.

| Key | | What it does |
| --- | --- | --- |
| `SUPABASE_URL` | Required | Your Supabase project's address |
| `SUPABASE_ANON_KEY` | Required | Its publishable key, for checking who's signed in |
| `R2_ACCOUNT_ID` | Required | Your Cloudflare account ID |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Required | An R2 API token with read and write access to the bucket |
| `R2_BUCKET` | Required | The bucket's name |
| `R2_JURISDICTION` | | The bucket's jurisdiction: `eu`, `fedramp`, or `default` for a bucket made without one. Default `eu`. |
| `R2_ENDPOINT` | | The bucket's full S3 address, in place of the R2 one the two keys above make, such as another S3-compatible store's |
| `REQUIRE_INVITE` | | `false` lets everyone in. Otherwise each service checks the person was let in from the waitlist. |
| `PUBLIC_URL` | | Your site's address. The TikTok, YouTube, LinkedIn and X services allow sign-ins to come back to it and its `www.` address. Default `https://plan.video`. |

## publisher.env

| Key | | What it does |
| --- | --- | --- |
| `SUPABASE_URL` | Required | Your Supabase project's address, if not in `r2.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | A secret key for your project. The publisher reads and writes tables browsers can't. |
| `TOKEN_KEY` | Required | 32 random bytes in base64, from `make-keys`. Seals logins, tickets and media links. |
| `BLUESKY_OAUTH_JWK` | | The "Sign in with Bluesky" key, from `make-keys`. Without it, Bluesky connects with app passwords only. |
| `PUBLIC_URL` | | Your site's address, for media links, emails, the networks' sign-in callbacks and Bluesky. Default `https://plan.video`. |
| `SEND_FROM` | | A time in ISO 8601. Runs due before it are never sent. `make-keys` sets it; without it, runs that fell due while the publisher was down are skipped. |
| `RESEND_API_KEY` | | A [Resend](https://resend.com) key, to email owners about failed posts and LinkedIn logins running out |
| `NOTICE_FROM` | | Who those emails come from. Default `plan.video <hello@plan.video>`. |
| `BILLING_URL` | | Where the billing service is, to end a plan when an account is deleted. Default `http://127.0.0.1:8799`. |
| `YOUTUBE_UPLOADS_PER_DAY` | | YouTube uploads a day per owner, Free to Agency. Default `3,50,100,200`. |
| `X_POSTS_PER_MONTH` | | Posts to X in any 30 days per owner, Free to Agency. Default `0,150,400,800`. |
| `X_LINK_POSTS_PER_MONTH` | | How many of those can have a link. Default `0,10,25,40`. |

## Network files

The network's service and the publisher both read these.

| File | Keys |
| --- | --- |
| `tiktok.env` | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, and `TIKTOK_READ_VIDEOS=true` once your app has `video.list` |
| `youtube.env` | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` |
| `linkedin.env` | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` |
| `x.env` | `X_CLIENT_ID`, `X_CLIENT_SECRET` |
| `meta.env` | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_CONFIG_ID`, `THREADS_APP_ID`, `THREADS_APP_SECRET` |

[Network apps](/docs/network-apps) shows where to get each one.

## agent.env

| Key | | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Required | An API key from the [Claude Console](https://platform.claude.com) |
| `AGENT_PERSON_BUDGET` | | How much each person can use the Assistant in a day, in input tokens, with output counted five times. One number is Creator's, and Free gets a quarter of it, Pro twice and Agency four times; or give all four as `Free,Creator,Pro,Agency`. Default `4000000`. A team member on Free uses their owner's. |
| `AGENT_SITE_BUDGET` | | The same for everyone together, the caption tools included. Default `200000000`. |
| `AGENT_FREE_SHARE` | | The share of `AGENT_SITE_BUDGET` that Free accounts can use between them, from `0` to `1`, so they never use up what paying ones need. Default `0.5`. |
| `AGENT_NETWORK_BUDGET` | | What Free accounts on one network (IP address, or IPv6 /64) can use between them in a day, the Assistant and caption tools together. Default `4000000`. |
| `CAPTIONS_PERSON_BUDGET` | | Each person's daily share of the caption tools, by plan like `AGENT_PERSON_BUDGET`. Default `4000000`. |
| `AGENT_SIGNING_SECRET` | | Signs the Assistant's replies, so a browser can't make up its turns. By default it comes from the API key, so a new key ends open chats. |

## transcribe.env

| Key | | What it does |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | Required | An [ElevenLabs](https://elevenlabs.io) key with the Speech to Text permission |

## billing.env

| Key | | What it does |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Required | Your Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Required | The signing secret of the webhook `setup-stripe.mjs` makes |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | To write each person's plan |
| `PUBLIC_URL` | | Where Stripe sends people back. Default `https://plan.video`. |
| `STRIPE_AUTOMATIC_TAX` | | `true` turns on Stripe Tax in Checkout |

Make the products, prices, billing portal and webhook with `services/billing/scripts/setup-stripe.mjs`:

```bash
STRIPE_SECRET_KEY=sk_... PUBLIC_URL=https://your-domain.com node services/billing/scripts/setup-stripe.mjs
```

It's safe to run again, and prints the webhook's secret the first time.

## mcp.env

| Key | | What it does |
| --- | --- | --- |
| `SUPABASE_URL` | Required | Your Supabase project's address. Agents sign in at its OAuth server. |
| `SUPABASE_ANON_KEY` | Required | Its publishable key |
| `PUBLIC_URL` | | Your site's address. It names the server to agents, and the site they ask people to open, so it must be right. Default `https://plan.video`. |
| `ALLOWED_ORIGINS` | | Sites whose tabs may connect, separated by commas. Default `PUBLIC_URL` and its `www.` address. |

## monitor.env

| Key | | What it does |
| --- | --- | --- |
| `HC_PING_URL` | | Your check's ping address from [Healthchecks.io](https://healthchecks.io). Without it, problems only go to `journalctl -u plan-video-monitor`. |
| `PUBLIC_URL` | | Your site's address. The watchdog loads it and the publisher's health from outside, and checks its certificate. Default `https://plan.video`. |
