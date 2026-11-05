plan.video posts to Pinterest with the Pinterest API v5 and signs people in with OAuth 2.0.

## Create the app

<Steps>
  <Step title="Make an app">
    Sign in with a Pinterest business account at [developers.pinterest.com/apps](https://developers.pinterest.com/apps/) and connect an app, with **Pin creation and scheduling** as its use case. Pinterest reviews it and gives it Trial access.
  </Step>
  <Step title="Add the redirect URI">
    Once it has Trial access, add `https://your-domain.com/pinterest/callback` under **Redirect URIs**. plan.video only takes this sign-in on your site's own address, so it doesn't connect from the dev server.
  </Step>
</Steps>

plan.video asks for `boards:read`, `boards:write`, `pins:read`, `pins:write` and `user_accounts:read`.

## Add the keys

```bash /etc/plan-video/pinterest.env
PINTEREST_APP_ID=your-app-id
PINTEREST_APP_SECRET=your-app-secret
PINTEREST_SANDBOX=true
```

Pinterest turns on once its ID and secret are both set. Only the publisher reads this file, so restart only it:

```bash
systemctl restart plan-video-publisher
```

## Before you post for others

Pinterest only lets a Trial app write to its sandbox, and Pins there show only to whoever made them, so a post looks sent while nobody else can see it. `PINTEREST_SANDBOX=true` sends every call to the sandbox, for trying things out.

To post for real, ask for **Standard access** on your app's page. Pinterest wants a video of your app connecting an account and making a Pin. Once it's approved, remove `PINTEREST_SANDBOX` and restart the publisher. Sandbox logins don't work outside it, so connect each account again.

## Media links

Pinterest fetches each picture from your server, at signed links under `/api/publisher/photo/` that last two hours, so your site has to be reachable from the internet. Videos are uploaded directly.

## Logins

A Pinterest login lasts 30 days and its refresh token 60. The publisher renews both once they're a week old, as long as the account keeps posting; one left unused for 60 days has to connect again.

Pinterest has no way for an app to end its own access, so disconnecting an account deletes its login from your database, and the person removes the app in their own Pinterest settings if they want to.
