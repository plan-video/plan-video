The dev server reloads as you edit, and you need no accounts or keys to start: it comes with a demo full of sample posts.

## Before you start

- **Node.js 22** and npm. Node.js 20.19 or later runs the website, but the services need 22.
- **git**. The install step uses it to apply the fixes in `patches/`.
- **A Chromium browser**, such as Chrome, Edge, Brave or Arc. The editor only opens in one; the dashboard opens in any browser.

## Run it

<Steps>
  <Step title="Get the code">
    ```bash
    git clone https://github.com/plan-video/plan-video.git
    cd plan-video
    ```
  </Step>
  <Step title="Install">
    ```bash
    npm install
    ```
    This installs every app and package, then applies `patches/` to `node_modules`.
  </Step>
  <Step title="Start the dev server">
    ```bash
    npm run dev
    ```
    The site runs at [http://localhost:5173](http://localhost:5173). `npm run dev -w @plan.video/web` does the same.
  </Step>
  <Step title="Open the demo">
    Go to [http://localhost:5173/try](http://localhost:5173/try). The dashboard and the editor open with sample posts and analytics, without an account, and nothing is ever sent.
  </Step>
</Steps>

That's enough to work on the dashboard and the editor.

## Sign in

To sign in and keep your own posts, point the dev server at a Supabase project of your own, on Supabase's cloud or [running locally](/docs/supabase#running-supabase-locally), with the migrations applied.

```bash
cp apps/web/.env.example apps/web/.env
```

```bash apps/web/.env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key
VITE_APP_URL=
```

`.env.example` has placeholders, so put in your project's URL and key, and leave `VITE_APP_URL` empty, so sign-in comes back to the dev server. Then restart the dev server and sign in with your email. In development, the sign-in page also takes the code from the email, which plan.video's email templates include.

## Turn on more

The dev server runs the services' code itself, under the same paths, reading their keys from `apps/web/server.env`. Start it from the example, and add only the keys for what you work on:

```bash
cp apps/web/server.env.example apps/web/server.env
```


| To work on | Add |
| --- | --- |
| The Assistant and caption tools | `ANTHROPIC_API_KEY` |
| Auto-captions | `ELEVENLABS_API_KEY` |
| Paying for plans | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_DB_KEY` ([how to make it](/docs/configuration#billingenv)) |
| Connecting a network | Its keys, as in [Network apps](/docs/network-apps) |

These keys never reach the browser: Vite doesn't read `server.env`, and a build fails if one of them turns up in it.

For Stripe's webhooks, forward them to the dev server with the [Stripe CLI](https://docs.stripe.com/stripe-cli):

```bash
stripe listen --forward-to localhost:5173/api/billing/webhook
```

## Posting from the dev server

The publisher, which keeps logins and sends posts, doesn't run inside the dev server. In development, `/api/publisher` goes to `VITE_PUBLISHER_URL`, else `VITE_APP_URL`, else plan.video's own publisher, which only answers sessions from plan.video's own Supabase.

To connect accounts and post from your own copy, run the publisher and its gateway next to the dev server:

<Steps>
  <Step title="Install it">
    ```bash
    cd services/publisher && npm install
    ```
  </Step>
  <Step title="Give it settings">
    Make a folder with a `publisher.env` in it, and add the network files you need beside it. [Environment variables](/docs/configuration#publisherenv) lists every key.
    ```bash publisher.env
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_ANON_KEY=your-publishable-key
    SUPABASE_SERVICE_ROLE_KEY=your-secret-key
    # 32 random bytes in base64, from: openssl rand -base64 32
    TOKEN_KEY=your-token-key
    REQUIRE_INVITE=false
    SENDER_SECRET=any-password-you-like
    ```
    Beside it, make a `gateway.env` with the same password:
    ```bash gateway.env
    SENDER_SECRET=any-password-you-like
    ```
  </Step>
  <Step title="Start them">
    Run each in its own terminal, from its own folder:
    ```bash
    cd services/publisher && PLAN_VIDEO_ENV_DIR=/path/to/that/folder node server.mjs
    cd services/gateway && PLAN_VIDEO_ENV_DIR=/path/to/that/folder node server.mjs
    ```
    The gateway listens on `127.0.0.1:8798`, and the publisher on `127.0.0.1:8794`, where only the gateway can reach it.
  </Step>
  <Step title="Point the dev server at it">
    Set `VITE_PUBLISHER_URL=http://127.0.0.1:8798` in `apps/web/.env`, then restart the dev server.
  </Step>
</Steps>

Files you add in the dev server stay in your browser, because uploading to R2 only happens in production builds. So a local publisher can send text posts, but not posts with pictures or videos.

## Check your changes

```bash
npm run check -w @plan.video/web    # type-check the website
npm test                            # unit tests in the workspaces
npm run build                       # a production build, in apps/web/dist
```

Each service's tests run with Node's test runner:

```bash
cd services/publisher && node --test
```

## Troubleshooting

<AccordionGroup>
  <Accordion title="Port 5173 is already in use">
    The dev server only runs on 5173. Stop the other one, often a dev server you started earlier.
  </Accordion>
  <Accordion title="The editor's canvas stays blank">
    The patch in `patches/` didn't apply. Run `node scripts/apply-patches.mjs`, delete `apps/web/node_modules/.vite`, and restart the dev server.
  </Accordion>
  <Accordion title="Sign-in emails link to the wrong address">
    Supabase links emails to its **Site URL**. Set it to `http://localhost:5173` for development.
  </Accordion>
</AccordionGroup>
