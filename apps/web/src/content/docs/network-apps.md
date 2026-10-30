To post for people, your copy of plan.video needs its own developer app on each network, with its own keys. The hosted plan.video has its apps registered already; a copy you run starts with none.

<CardGroup cols={3}>
  <Card title="TikTok" network="tiktok" href="/docs/tiktok-app">Login Kit and Content Posting API.</Card>
  <Card title="YouTube" network="youtube" href="/docs/youtube-app">A Google OAuth client.</Card>
  <Card title="X" network="x" href="/docs/x-app">OAuth 2.0 and pay-per-use credits.</Card>
  <Card title="LinkedIn" network="linkedin" href="/docs/linkedin-app">Share on LinkedIn.</Card>
  <Card title="Bluesky" network="bluesky" href="/docs/bluesky-app">No app needed.</Card>
  <Card title="Instagram, Facebook, Threads" network="instagram" href="/docs/meta-app">One Meta app for all three.</Card>
</CardGroup>

## At a glance

Every network's keys go in its own file in `/etc/plan-video`. Bluesky's key is the publisher's own.

| Network | Keys | Callback |
| --- | --- | --- |
| TikTok | `tiktok.env` | `/tiktok/callback` |
| YouTube | `youtube.env` | `/youtube/callback` |
| X | `x.env` | `/x/callback` |
| LinkedIn | `linkedin.env` | `/linkedin/callback` |
| Bluesky | `publisher.env` | `/bluesky/callback` |
| Instagram | `meta.env` | `/instagram/callback` |
| Facebook | `meta.env` | `/facebook/callback` |
| Threads | `meta.env` | `/threads/callback` |

Without its keys, a network can't be connected. Everything else keeps working.

## How connecting works

<Steps>
  <Step title="Start">
    The browser asks the network's service for the sign-in address, such as `/api/tiktok/authorize`. For Instagram, Facebook and Threads, the publisher answers.
  </Step>
  <Step title="Sign in">
    The person signs in on the network's own page, which sends them back to its callback page on your site with a code.
  </Step>
  <Step title="Swap the code">
    The browser hands the code to the publisher, which swaps it for the login and answers with a ticket: the login sealed with `TOKEN_KEY`, which only the publisher can open.
  </Step>
  <Step title="Keep the login">
    The browser saves the account with that ticket. The publisher opens it and keeps the login, still sealed, in the `social_tokens` table.
  </Step>
</Steps>

From then on, the publisher posts, refreshes logins before they run out and reads Analytics. No network token reaches a browser, except a person's own Bluesky app-password session.

## Your domain

A network only sends people back to the callback addresses saved on your app. plan.video keeps its own list of those addresses too, made from your domain: the website's from `VITE_APP_URL`, the services' from `PUBLIC_URL`. Each network connects from that address and its `www.` one.

- The publisher takes `PUBLIC_URL` from `publisher.env`, for every network, Instagram, Facebook and Threads included, and for "Sign in with Bluesky".
- The TikTok, YouTube, LinkedIn and X services each take it from their own env file (`tiktok.env` and so on), or else from `r2.env`, which they all read. Setting it once in `r2.env` is enough.

Without it, they allow only plan.video's addresses. The website and the TikTok, YouTube, LinkedIn and X lists also allow the dev server's address: `http://localhost:5173`, or `http://127.0.0.1:5173` for X.

<Note>
Each network reviews apps before they can post for anyone but you, and some reviews take weeks. Start them early. Each network's page says what its review covers.
</Note>
