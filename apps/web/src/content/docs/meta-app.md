Instagram, Facebook Pages and Threads all come from one Meta app, but each signs people in on its own, with its own app ID and secret.

| Network | Sign-in | What people connect |
| --- | --- | --- |
| Instagram | Instagram API with Instagram Login | A professional account, with no Facebook Page needed |
| Facebook | Facebook Login for Business | Each Page they share becomes its own account |
| Threads | Threads API | Their Threads profile |

## Create the app

<Steps>
  <Step title="Make an app">
    Create an app at [developers.facebook.com](https://developers.facebook.com/apps) and add the three use cases: Instagram API with Instagram Login, Facebook Login for Business, and the Threads API.
  </Step>
  <Step title="Add the permissions">
    - Instagram: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`
    - Facebook: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `pages_read_user_content`, `read_insights`, `business_management`
    - Threads: `threads_basic`, `threads_content_publish`, `threads_manage_insights`

    For Facebook, you can put these in a Login for Business configuration and use its ID as `FACEBOOK_CONFIG_ID`. Without one, plan.video asks for the permissions itself.
  </Step>
  <Step title="Add the redirect URIs">
    Add `https://your-domain.com/instagram/callback`, `https://your-domain.com/facebook/callback` and `https://your-domain.com/threads/callback`, each to its own product's settings. plan.video only takes these sign-ins on your site's own address, so these three don't connect from the dev server.
  </Step>
</Steps>

## Add the keys

Instagram and Threads show their own app ID and secret on their products' settings pages. Facebook's are the app's own, under **App settings** → **Basic**.

```bash /etc/plan-video/meta.env
INSTAGRAM_APP_ID=your-instagram-app-id
INSTAGRAM_APP_SECRET=your-instagram-app-secret
FACEBOOK_APP_ID=your-app-id
FACEBOOK_APP_SECRET=your-app-secret
FACEBOOK_CONFIG_ID=your-login-configuration-id
THREADS_APP_ID=your-threads-app-id
THREADS_APP_SECRET=your-threads-app-secret
```

Each network turns on once its ID and secret are both set. The publisher handles all three on its own, from sign-in to posting, so restart only it:

```bash
systemctl restart plan-video-publisher
```

## Media links

Meta fetches each post's pictures and videos from your server, at signed links under `/api/publisher/photo/` and `/api/publisher/video/`. A picture's link lasts two hours and a video's a day. Your site has to be reachable from the internet for these posts to go out.

## Before you post for others

While the app is in development mode, only people with a role on it, such as admins and testers, can connect. Everyone else can once Meta approves the permissions above in App Review.

## Logins

Instagram and Threads logins last 60 days. The publisher renews each one once it's a week old, as long as the account keeps posting; one left unused for 60 days has to connect again. Facebook Page logins don't run out.

Meta has no way for an app to end its own access, so disconnecting an account deletes its login from your database, and the person removes the app in their own Meta settings if they want to.
