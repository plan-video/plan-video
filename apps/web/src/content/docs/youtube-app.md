plan.video uploads to YouTube with the YouTube Data API and reads each channel's numbers with the YouTube Analytics API. Both use one OAuth client in a Google Cloud project.

## Create the OAuth client

<Steps>
  <Step title="Make a project">
    Create a project in the [Google Cloud console](https://console.cloud.google.com).
  </Step>
  <Step title="Turn on the APIs">
    Enable the **YouTube Data API v3** and the **YouTube Analytics API**.
  </Step>
  <Step title="Set up the consent screen">
    Make it **External**, and add the scopes `youtube.upload`, `youtube.readonly` and `yt-analytics.readonly`. While it's in testing, only the Google accounts you list as test users can connect.
  </Step>
  <Step title="Make the client">
    Create an OAuth client of type **Web application**. Under **Authorized redirect URIs**, add `https://your-domain.com/youtube/callback`, plus `http://localhost:5173/youtube/callback` to connect from the dev server.
  </Step>
</Steps>

## Add the keys

```bash /etc/plan-video/youtube.env
YOUTUBE_CLIENT_ID=your-client-id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your-client-secret
```

The YouTube service starts the sign-in, and the publisher swaps the code for the login, uploads and reads Analytics, so restart both:

```bash
systemctl restart plan-video-youtube plan-video-publisher
```

## Before you post for others

- **Verification.** `youtube.upload` and `youtube.readonly` are sensitive scopes, so Google verifies your app before anyone outside your test users can connect.
- **The YouTube audit.** YouTube keeps every video uploaded through an unaudited project private. Its separate API audit lifts that.
- **Quota.** Each project gets a daily quota of API units, and uploads are the expensive part. `YOUTUBE_UPLOADS_PER_DAY` in `publisher.env` shares it out: how many uploads a day each plan gets, Free to Agency, `3,50,100,200` by default. YouTube gives a new project 100 uploads a day for all its users together, so lower these, or ask YouTube for more quota.
