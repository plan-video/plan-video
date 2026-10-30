plan.video posts to X with the X API v2 and signs people in with OAuth 2.0. X charges for every post, so on plan.video X is for paid plans only.

## Create the app

<Steps>
  <Step title="Make an app">
    Sign in at [console.x.com](https://console.x.com) and create an app inside a project that has pay-per-use credits. An app outside such a project gets `client-not-enrolled` errors on every call.
  </Step>
  <Step title="Set up sign-in">
    In the app's settings, turn on OAuth 2.0 user authentication, choose the type **Web App** and give it **Read and write** permissions.
  </Step>
  <Step title="Add the callback URLs">
    Add `https://your-domain.com/x/callback`, plus `http://127.0.0.1:5173/x/callback` for the dev server. X doesn't take `localhost`, so start the dev server with `--host 127.0.0.1` and open it at that address.
  </Step>
</Steps>

plan.video asks for the scopes `tweet.read`, `tweet.write`, `users.read`, `media.write` and `offline.access`.

## Add the keys

Copy the app's OAuth 2.0 **Client ID** and **Client Secret**:

```bash /etc/plan-video/x.env
X_CLIENT_ID=your-client-id
X_CLIENT_SECRET=your-client-secret
```

The X service starts the sign-in. The publisher only turns X on when `X_CLIENT_ID` is set, swaps the code for the login and posts, so restart both:

```bash
systemctl restart plan-video-x plan-video-publisher
```

## Costs and caps

X bills your credits for each post, and more for a post with a link. When the credits run out, posts to X fail. To keep the bill in check, the publisher caps how many posts each owner sends in any 30 days, across all their X accounts:

| Plan | Posts | Of those, with a link |
| --- | --- | --- |
| Free | 0 | 0 |
| Creator | 150 | 10 |
| Pro | 400 | 25 |
| Agency | 800 | 40 |

A post past a cap fails. On top of that, an owner sends at most 50 posts to X a day; a post past those waits for the next free slot.

Set your own caps with `X_POSTS_PER_MONTH` and `X_LINK_POSTS_PER_MONTH` in `publisher.env`: four numbers, Free to Agency, such as `0,150,400,800`. Each can be up to 1,000.
