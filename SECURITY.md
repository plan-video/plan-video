# Security policy

plan.video holds people's logins to their social accounts and posts for them, so we take security reports seriously and are grateful for them.

## Reporting a vulnerability

**Please don't open a public issue, pull request or discussion for a security problem.**

Email [hello@plan.video](mailto:hello@plan.video) with "Security" in the subject, and include:

- what the problem is and what someone could do with it,
- the steps to reproduce it, or a proof of concept,
- the affected URL, endpoint, service or file,
- your name or handle if you'd like to be credited.

We aim to reply within 3 working days, and to keep you posted until it's fixed. Please give us a reasonable time to fix it before you tell anyone else, and we'll agree on a date to publish together.

## What's in scope

- The code in this repository: the website and dashboard (`apps/web`), the editor's packages (`packages/`), the server services (`services/`) and the database schema and policies (`supabase/`).
- The hosted version at [plan.video](https://plan.video).

Things we especially want to hear about:

- reading or changing another person's posts, workspaces, media or account,
- getting a network login (YouTube, TikTok, X, LinkedIn, Bluesky, Instagram, Facebook, Threads, Pinterest) out of the publisher,
- posting to someone else's social account,
- getting around plan limits or billing,
- an agent connector token doing more than it was given.

## What's out of scope

- Denial of service, load testing or flooding any endpoint.
- Social engineering, phishing or physical attacks.
- Problems in services we use (Supabase, Stripe, Cloudflare, Resend, the social networks) that aren't caused by how plan.video uses them. Report those to the service.
- The setup of someone's self-hosted copy, such as leaked keys or a missing firewall.
- Reports from automated scanners without a working attack, and missing headers or best practices with no real impact.

## Testing the hosted version

- Only use accounts you own, and test against your own posts, workspaces and social accounts.
- Don't read, change or delete anyone else's data. If you reach it by accident, stop, don't keep it, and tell us.
- Don't publish anything to a social network from an account that isn't yours.
- Don't spam the sign-in, invite or email features.

If you follow these rules and report in good faith, we won't take legal action against you or ask anyone else to.

There's no paid bug bounty at the moment.

## Supported versions

There are no numbered releases yet. Fixes go into `main` and out to the hosted version. If you self-host, keep your copy up to date with `main`.

## For self-hosters

- Secrets stay on the server. Anything with the `VITE_` prefix is built into the browser bundle, so never put a secret in one.
- The publisher encrypts network logins with `TOKEN_KEY`. Keep it out of git and back it up: without it the stored logins can't be read.
- Run each service on `127.0.0.1` behind a reverse proxy, and only open ports 80 and 443 to the internet.
