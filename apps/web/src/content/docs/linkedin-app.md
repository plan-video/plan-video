plan.video signs people in with LinkedIn's OpenID Connect and posts to their own profile through **Share on LinkedIn**. Both are products you add to one LinkedIn app.

## Create the app

<Steps>
  <Step title="Make an app">
    Create an app at [linkedin.com/developers](https://www.linkedin.com/developers/apps). LinkedIn asks for a company Page to link it to.
  </Step>
  <Step title="Add the products">
    Under **Products**, add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
  </Step>
  <Step title="Add the redirect URLs">
    Under **Auth**, add `https://your-domain.com/linkedin/callback`, plus `http://localhost:5173/linkedin/callback` to connect from the dev server.
  </Step>
</Steps>

plan.video asks for the scopes `openid`, `profile` and `w_member_social`.

## Add the keys

Copy the **Client ID** and **Primary Client Secret** from the **Auth** tab:

```bash /etc/plan-video/linkedin.env
LINKEDIN_CLIENT_ID=your-client-id
LINKEDIN_CLIENT_SECRET=your-client-secret
```

The LinkedIn service starts the sign-in, and the publisher swaps the code for the login and posts, so restart both:

```bash
systemctl restart plan-video-linkedin plan-video-publisher
```

## Company Pages (optional)

Posting to company Pages needs a second app, because LinkedIn keeps the **Community Management API** on an app of its own.

<Steps>
  <Step title="Make a second app">
    Create another app linked to the same company Page, and under **Products** request **Community Management API**. LinkedIn reviews the request, and starts you on its Development Tier, which allows 500 API calls a day.
  </Step>
  <Step title="Add the redirect URLs">
    Under **Auth**, add the same `/linkedin/callback` addresses as on the first app.
  </Step>
  <Step title="Add its keys">
    Add its **Client ID** and **Primary Client Secret** to `/etc/plan-video/linkedin.env` as `LINKEDIN_PAGES_CLIENT_ID` and `LINKEDIN_PAGES_CLIENT_SECRET`, then restart both services.
  </Step>
  <Step title="Show the button">
    Build the website with `VITE_LINKEDIN_PAGES=true`. **Connections** then shows **Add Page** next to LinkedIn. Connecting adds every Page the person can post to; remove the ones you don't want.
  </Step>
</Steps>

plan.video asks this app for the scopes `rw_organization_admin`, `w_organization_social` and `w_organization_social_feed` (for follow-up comments). For more than the Development Tier allows, request **Standard Tier** under **Products** once it all works. LinkedIn wants a screen recording, and a rejected app can't apply again.

## Logins run out

LinkedIn only gives refresh tokens to partner apps, so each login lasts about 60 days. The account then shows **Reconnect** in Connections. If you set `RESEND_API_KEY` in `publisher.env`, the publisher emails the account's owner a week before.

<Note>
Posts with several pictures use LinkedIn's versioned API, at the version named by `API_VERSION` in `services/linkedin/handler.mjs`. LinkedIn retires each version after about a year, so move it forward before then.
</Note>
