plan.video keeps its accounts and data in [Supabase](https://supabase.com): sign-in, the Postgres database, profile pictures and the OAuth server AI agents sign in through. A project on Supabase's cloud works, and so does a self-hosted Supabase. Plain Postgres doesn't, because the migrations use Supabase's `auth` and `storage` schemas and its roles.

## What's in the database

| Table | What it holds |
| --- | --- |
| `posts` | Each post, one row per post, with a version raised on every change, kept as a marker once deleted so other devices learn of it |
| `post_thumbnails` | Each post's thumbnail, apart from the post so it isn't sent with every change |
| `post_schedule` | When the publisher next looks at each post |
| `account_state` | Each person's workspaces, calendars, connected accounts and settings, as one document the browser keeps in sync |
| `user_data` | Each person's plan (`access_level`) and email preferences |
| `post_deliveries` | A row for each account a post goes to, each time it's due, which stops anything going out twice |
| `social_tokens`, `bluesky_sessions` | Network logins, sealed with the publisher's `TOKEN_KEY` |
| `workspace_members` | Who's in which shared workspace, and their role |
| `post_previews` | The preview links people share for feedback, and their comments |
| `waitlist` | Emails waiting to be let in, while sign-up is invite-only |
| `invite_gate` | One switch: whether the database itself keeps out anyone not let in |

Browsers read and write only their own rows, under row-level security. Logins and deliveries are written only by the services, with the secret key, plans only by billing, with a key of its own, and browsers can't read the logins at all. Videos and pictures aren't in Supabase: they go to your R2 bucket.

## Set it up

<Steps>
  <Step title="Make a project">
    Create a project at [supabase.com](https://supabase.com/dashboard), or start a self-hosted Supabase. Note its URL, its publishable key and a secret key, under **Project Settings** → **API Keys**.
  </Step>
  <Step title="Apply the migrations">
    Run every file in `supabase/migrations` in order, oldest first. Either link the project with the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and push them, or paste each file into the dashboard's SQL editor.
    ```bash
    supabase link --project-ref your-project-ref
    supabase db push
    ```
  </Step>
  <Step title="Set the URLs">
    Under **Authentication** → **URL Configuration**, set **Site URL** to your site's address, and add `https://your-domain.com/**` to the redirect URLs. Sign-in emails link to the Site URL.
  </Step>
  <Step title="Add the emails">
    Under **Authentication** → **Emails**, paste each template from `supabase/templates` into its email: `magic-link.html` for the magic link, `confirm-signup.html` for confirming a sign-up, and `invite.html` for invites. Their links and logo come from your Site URL, so there's nothing to change.
  </Step>
  <Step title="Send the emails yourself">
    Supabase's own mail service only sends a few emails an hour, so set up your own SMTP under **Authentication** → **Emails** → **SMTP Settings**. plan.video uses [Resend](https://resend.com).
  </Step>
  <Step title="Turn on the OAuth server">
    For AI agents, turn on Supabase's **OAuth Server** under **Authentication**, allow dynamic client registration, and set the authorization path to `/oauth/consent`. Agents register themselves and sign in there.
  </Step>
  <Step title="Turn on the sign-up hook">
    While sign-up is invite-only, turn on **Authentication** → **Auth Hooks** → **Before User Created** with the Postgres function `public.before_user_created`. Supabase then won't make an account for an email that wasn't let in, however the request reaches it.
  </Step>
  <Step title="Turn on the access token hook">
    Once the `mcp` service is running, turn on **Authentication** → **Auth Hooks** → **Customize Access Token** with the Postgres function `public.connector_access_token`. See below for why it comes last.
  </Step>
</Steps>

Google sign-in is optional. Turn on the Google provider in Supabase to offer it; the button only shows once sign-up isn't invite-only.

## Why the access token hook matters

Anyone can register an OAuth client with your project, so a token an agent gets must not work as a full sign-in. The hook, from the migration `20261015180000_connector_tokens.sql`, takes the user out of those tokens. Every table, Supabase Auth itself and every service then refuse them, and only `mcp` can still tell whose they are.

Turn it on after `mcp` is running: an `mcp` that doesn't know the new tokens can't read them.

## Letting people in

While sign-up is invite-only, only emails you let in can use your copy. Up to four things keep it that way: the website if you set `VITE_INVITE_ONLY=true`, the services (`REQUIRE_INVITE`), the database, which saves nothing for someone not let in, and the sign-up hook above, which makes no account for them. Let someone in with SQL:

```sql
insert into public.waitlist (email, invited_at) values ('name@example.com', now())
on conflict (email) do update set invited_at = now();
```

The migrations also let in `reviewer@plan.video`, the sign-in plan.video gives its network reviewers. On your own copy, take it out:

```sql
delete from public.waitlist where email = 'reviewer@plan.video';
```

Or open sign-up to everyone: set `REQUIRE_INVITE=false` in `r2.env`, turn off the sign-up hook, and open the database:

```sql
update public.invite_gate set invite_only = false;
```

A local Supabase starts open, from `supabase/seed.sql`.

## Running Supabase locally

The repository's `supabase/config.toml` sets up a local Supabase for development and tests, with the OAuth server and the email templates. With [Docker](https://docs.docker.com/get-docker/) running:

```bash
supabase start
```

That applies every migration, and catches sign-in emails in a test inbox at `http://127.0.0.1:54324`. `supabase status` prints the local URL and keys for `apps/web/.env`. Set `site_url` in `config.toml` to `http://localhost:5173`, the dev server, so the emails' links open it.

The tests in `supabase/tests` run against it:

```bash
node --test supabase/tests/*.test.mjs
```

`connector-tokens` needs its hook turned on in `config.toml`, and the last `access-gate` test needs its hook plus `BEFORE_USER_CREATED_HOOK=on`.

So do the publisher's tests against the real database (`services/publisher/integration.test.mjs`, skipped when no local Supabase answers), and the end-to-end checks in `apps/web/e2e`, which drive the dashboard in Chrome against it.
