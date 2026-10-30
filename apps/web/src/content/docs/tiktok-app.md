plan.video signs people in with TikTok's Login Kit and posts through its Content Posting API. Both come from one app on the TikTok developer portal.

## Create the app

<Steps>
  <Step title="Make an app">
    Sign in at [developers.tiktok.com](https://developers.tiktok.com) and create an app.
  </Step>
  <Step title="Add the products">
    Add **Login Kit** and **Content Posting API**, with **Direct Post** switched on.
  </Step>
  <Step title="Add the scopes">
    Add `user.info.basic`, `video.publish` and `video.upload`. Add `video.list` too if you want Analytics to read each account's videos.
  </Step>
  <Step title="Add the redirect URIs">
    Add `https://your-domain.com/tiktok/callback`, plus `http://localhost:5173/tiktok/callback` to connect from the dev server.
  </Step>
  <Step title="Verify your domain">
    Add your domain as a URL property and verify it. TikTok fetches the pictures of a photo post from your server, and only from a verified domain.
  </Step>
</Steps>

## Add the keys

Copy the app's **Client key** and **Client secret** into `tiktok.env`:

```bash /etc/plan-video/tiktok.env
TIKTOK_CLIENT_KEY=your-client-key
TIKTOK_CLIENT_SECRET=your-client-secret
# Only once video.list is on the app: asking for a scope it lacks stops the sign-in.
TIKTOK_READ_VIDEOS=true
```

The TikTok service starts the sign-in, and the publisher swaps the code for the login and posts, so restart both:

```bash
systemctl restart plan-video-tiktok plan-video-publisher
```

## Before you post for others

TikTok audits apps that use the Content Posting API. Until yours passes, everything it posts is private to the account that posted it. Apply from the app's page once sign-in and posting work.