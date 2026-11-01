You can run all of plan.video yourself: the website, the services that post for you, and the database.

<Note>
Just want to post? [plan.video](https://plan.video) runs this same code, with the networks' developer apps already registered, so there's nothing to set up.
</Note>

## What you need

- **A Linux server with systemd**, and a domain pointing at it. Two CPU cores and 4 GB of memory run every service.
- **Node.js 22**, plus the official build from [nodejs.org](https://nodejs.org) for the publisher.
- **[Caddy](https://caddyserver.com)**, which serves the site over HTTPS and routes the services.
- **A [Supabase](https://supabase.com) project**, for sign-in and the database.
- **A [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket**, for videos and pictures.
- **A developer app on each network** you want to post to.

Each of these is optional and turns on one feature:

| Account | What it turns on |
| --- | --- |
| [Anthropic](https://platform.claude.com) | The dashboard's Assistant and the editor's caption tools |
| [ElevenLabs](https://elevenlabs.io) | Auto-captions |
| [Resend](https://resend.com) | Emails about failed posts and logins running out. It can send Supabase's sign-in emails too. |
| [Stripe](https://stripe.com) | Paid plans |
| [Healthchecks.io](https://healthchecks.io) | Alerts when the server has a problem |

## Set it up

<Steps>
  <Step title="Set up Supabase">
    Create the project, apply the migrations and set up sign-in. See [Supabase](/docs/supabase).
  </Step>
  <Step title="Make the bucket">
    Create an R2 bucket and an API token that can read and write it, then allow your site in the bucket's CORS policy, as shown below.
  </Step>
  <Step title="Install the services">
    Write their settings, make the publisher's keys and start them. See [Services](/docs/services).
  </Step>
  <Step title="Put the website up">
    Build it, copy it to the server and set up Caddy. See [Website](/docs/website).
  </Step>
  <Step title="Register the network apps">
    Make a developer app on each network and add its keys. See [Network apps](/docs/network-apps).
  </Step>
  <Step title="Sign in">
    [Let your own email in](/docs/supabase#letting-people-in), since the database starts invite-only. Then open your site, sign in with your email and [give yourself a plan](#give-yourself-a-plan).
  </Step>
</Steps>

## The bucket

Browsers upload straight to R2, so the bucket has to allow your site. Add a CORS policy in the bucket's settings:

```json
[
  {
    "AllowedOrigins": ["https://your-domain.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

<Note>
The services reach R2 at its EU address, `<account>.eu.r2.cloudflarestorage.com`, unless `r2.env` says otherwise. For a bucket in another jurisdiction, set `R2_JURISDICTION` (`fedramp`, or `default` for none); for another S3-compatible store, set `R2_ENDPOINT` to its address. See [r2.env](/docs/configuration#shared-r2env).
</Note>

## Give yourself a plan

Plans are kept in `user_data.access_level`: 1 is Free, 2 Creator, 3 Pro and 4 Agency. Without the billing service, everyone stays on Free, with its limits: 3 social accounts, 10 scheduled posts waiting per account, and no X or team members. Give yourself Agency in the SQL editor:

```sql
update public.user_data set access_level = 4
where id = (select id from auth.users where email = 'you@example.com');
```

## Open sign-up

Out of the box, only emails you let in can use your copy: the database saves nothing for anyone else, the services turn them down and, with the sign-up hook on, no account is made for them. There's no waitlist page, because that belongs to plan.video's own website. To let anyone sign up, set `REQUIRE_INVITE=false` in `r2.env`, and run `update public.invite_gate set invite_only = false;` in the SQL editor (with the sign-up hook off, if you turned it on). To let one person in, see [Letting people in](/docs/supabase#letting-people-in).

## Your domain

Your site's address is a setting, with plan.video's as the default:

- `VITE_APP_URL` in `apps/web/.env`, for the website
- `PUBLIC_URL` in `publisher.env`, `billing.env`, `mcp.env` and `monitor.env`, for the services

The email templates in `supabase/templates` take their links and logo from the Site URL you set in Supabase. The networks' sign-in callbacks follow `PUBLIC_URL`: see [Network apps](/docs/network-apps#your-domain).

A copy you run has no homepage of its own: `/` opens the dashboard.

## Updating

<Steps>
  <Step title="Get the new code">
    `git pull`, then read the new migrations' first lines: some say to apply them before or after a service is updated.
  </Step>
  <Step title="Apply new migrations">
    Apply each new file in `supabase/migrations`, oldest first, in the order its notes ask for.
  </Step>
  <Step title="Update the services">
    Run `services/deploy.sh all`, or name the services you run. See [Services](/docs/services#update).
  </Step>
  <Step title="Update the website">
    Build it and copy `apps/web/dist` to the server again.
  </Step>
</Steps>

<Warning>
Back up `TOKEN_KEY` and `BLUESKY_OAUTH_JWK` before anything else. Without them, every connected account has to connect again. See [The publisher's keys](/docs/services#the-publishers-keys).
</Warning>
