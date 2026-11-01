plan.video is one web app plus a handful of small services. The browser does the heavy work, editing video included. The services hold the secrets, and the publisher sends posts on time, whether or not anyone has a tab open.

<Diagram caption="The browser talks to Supabase itself. Anything that needs a secret goes through your server.">
  <Lane title="Browser" icon="globe">
    - **plan.video**
      The website, dashboard and editor
    - **AI agents**
      Claude, Codex, Cursor and others, over MCP
  </Lane>
  <Lane title="Your server" icon="server">
    - **Caddy**
      Serves the site and routes `/api` and `/mcp`
    - **publisher**
      Sends posts and keeps logins
    - **storage**
      Signs links to your files
    - **mcp**
      Hands agents' requests to an open tab
    - **The other services**
      Network sign-ins, Assistant, captions, billing
  </Lane>
  <Lane title="Hosted" icon="cloud">
    - **Supabase**
      Sign-in and the database
    - **Cloudflare R2**
      Videos and pictures
    - **The networks**
      TikTok, YouTube, X and the rest
    - **APIs**
      Anthropic, ElevenLabs, Stripe, Resend
  </Lane>
</Diagram>

## The web app

`apps/web` is a single [SolidJS](https://www.solidjs.com) app built with [Vite](https://vite.dev) and Tailwind CSS. The website, the dashboard and the editor are all routes of it. A copy built from this repository has no public pages: `/` opens the dashboard. plan.video's own website, with the homepage and these docs, lives in a separate private repository at `apps/web/site`, which adds those routes and gives each page its own HTML file for search engines.

- **Your data.** Posts live in the browser and sync one at a time to the `posts` table, each written only over the version the browser last read, so two devices' edits merge rather than overwrite. Workspaces, the calendar and settings sync to one `account_state` row per person. Supabase Realtime carries changes to every other open tab.
- **The editor.** Decoding, editing and exporting all run in the browser, with the `packages/runtime`, `reconciler` and `encoder` packages. For auto-captions, only the audio goes to the transcribe service.
- **Files.** Videos and pictures go straight from the browser to your R2 bucket, using links the storage service signs for 15 minutes.

## How a post goes out

<Steps>
  <Step title="It's scheduled">
    You schedule a post, and the browser saves it in the `posts` table. Saving it makes it due a look by the publisher.
  </Step>
  <Step title="The publisher picks it up">
    The publisher reads only the posts due a look: ones just changed, and ones whose next run has come (`post_schedule`). It does this every 30 seconds and again the moment a run is due. After each look it keeps the post's next run, so it never has to read every post.
  </Step>
  <Step title="It's claimed before it's sent">
    Each time a post is due, the publisher writes a row in `post_deliveries` for every account it goes to, before sending anything. So nothing goes out twice, even after a crash.
  </Step>
  <Step title="It's sent">
    The publisher opens the account's login, sealed with `TOKEN_KEY`, takes the files from R2, and posts through the network's API. It sends up to 16 at once, one at a time per account, so a long upload holds up nothing else. A failed send is tried again after 2, 10 and 30 minutes.
  </Step>
  <Step title="You see it">
    The result reaches the browser over Realtime, and the calendar marks the post as sent or failed. Once every network has a one-off post, the publisher marks it posted itself.
  </Step>
</Steps>

## How logins are kept

When someone connects an account, the network sends them back with a code, which the publisher swaps for the login. The login is sealed with AES-256-GCM under `TOKEN_KEY` and kept in `social_tokens`. Browsers only ever hold a sealed ticket. The publisher refreshes each login before it runs out. [Network apps](/docs/network-apps#how-connecting-works) goes through it step by step.

## How agents connect

An agent adds `https://your-domain.com/mcp`. The `mcp` service points it to Supabase's OAuth server, where the agent registers itself and the person signs in and allows it on `/oauth/consent`.

Every signed-in tab keeps a WebSocket open to `mcp`. When the agent calls a tool, such as `schedule_post`, `mcp` passes it to that person's most recently used tab. The tab runs it with the same code as the dashboard's Assistant and sends back the answer. That's why plan.video has to be open while an agent works. Posts it schedules still go out from the publisher.

## Where the secrets are

| Where | What |
| --- | --- |
| The browser | The Supabase publishable key and the person's own session |
| `/etc/plan-video` on your server | Each service's keys, readable only by the services |
| The database | Network logins, sealed with `TOKEN_KEY` |

The services check each signed-in request's session with Supabase before they answer it. Tokens given to AI agents work at `/mcp` only, and [Supabase](/docs/supabase#why-the-access-token-hook-matters) explains why.
