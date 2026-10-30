Bluesky has no developer portal to register with. People connect in one of two ways, and plan.video supports both.

## App passwords

Someone makes an app password in Bluesky's settings and types it into plan.video. The browser signs in with it once and hands the session to the publisher, which keeps it sealed with `TOKEN_KEY`. The password itself goes no further. This needs no setup on your side.

Accounts on other Bluesky servers work too. The publisher calls them through a guard that only allows HTTPS on the usual port, refuses private addresses and caps each reply's size.

## Sign in with Bluesky

"Sign in with Bluesky" is OAuth. The publisher is a confidential client, so its identity is a page it serves and a private key only it has.

<Steps>
  <Step title="Make the key">
    `scripts/make-keys.mjs` prints `BLUESKY_OAUTH_JWK` along with the publisher's other keys. See [Services](/docs/services#the-publishers-keys).
  </Step>
  <Step title="Set your address">
    Set `PUBLIC_URL` in `publisher.env` to your site's address. Your client's identity is then `https://your-domain.com/api/publisher/bluesky/client.json`, and Bluesky sends people back to `https://your-domain.com/bluesky/callback`. The website only offers the button on the address in `ORIGIN`, in `apps/web/src/lib/bluesky-oauth.ts`, so set that to yours too.
  </Step>
  <Step title="Check it's reachable">
    Bluesky servers fetch that `client.json` and its `jwks.json` over HTTPS, so open both in a browser and check they load.
  </Step>
</Steps>

```bash /etc/plan-video/publisher.env
PUBLIC_URL=https://your-domain.com
BLUESKY_OAUTH_JWK={"kty":"EC","crv":"P-256",...}
```

<Warning>
Changing `BLUESKY_OAUTH_JWK` ends every "Sign in with Bluesky" session, and those accounts have to connect again. Keep a copy of it next to your copy of `TOKEN_KEY`.
</Warning>

## Node.js

Bluesky's OAuth library checks `process.versions.undici`, which the official Node.js 22 builds from [nodejs.org](https://nodejs.org) report and some Linux distributions' own packages don't. On those, every "Sign in with Bluesky" fails while everything else works. With `BLUESKY_OAUTH_JWK` set, the publisher's `/api/publisher/health` reports it when it starts on such a Node.js.
