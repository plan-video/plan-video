// TikTok logins never reach a browser. Anyone holding one could post to the
// account straight through TikTok's API, and a browser that got one while
// connecting an account for someone else's workspace would keep it after
// leaving it. So the publisher swaps the code TikTok sends back for the tokens
// itself and hands the browser a ticket: the login sealed with TOKEN_KEY and
// bound to the person and workspace (ticketBinding in vault.mjs), which only
// this service can open. The browser shows the ticket to login/save, as
// youtube-logins.mjs does for YouTube.

import { redirectsFor, profileFor, tokenRequest } from "../tiktok/handler.mjs";

import { Refused } from "./errors.mjs";
import { openTicket, sealTicket, sealer } from "./vault.mjs";

export function createTikTokLogins({ key, env, now = () => Date.now(), token = tokenRequest, profile = profileFor }) {
  const box = sealer(key);
  return {
    /**
     * Swaps the code TikTok sent back for the account's login. Returns who the
     * account is and a ticket for its login, never the tokens. `holder` is who
     * the ticket is for.
     */
    async exchange(holder, { code, redirectUri, codeVerifier }) {
      if (!env.clientKey || !env.clientSecret) throw new Refused(503, "TikTok isn't set up on the server yet.");
      if (!redirectsFor(env.publicUrl).has(redirectUri)) throw new Refused(400, "That TikTok redirect address isn't allowed.");
      if (!code || !codeVerifier) throw new Refused(400, "TikTok sent the login back without a code. Try again.");
      const login = await token(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier }).catch(() => ({ error: "Couldn't reach TikTok. Try again in a moment." }));
      if (login.error) throw new Refused(400, login.error);
      const found = await profile(login.accessToken).catch(() => ({ error: "Couldn't reach TikTok. Try again in a moment." }));
      const openId = found.openId || login.openId;
      if (!openId) throw new Refused(400, found.error || "TikTok didn't return an account id.");
      const expiresAt = now() + (login.expiresIn || 0) * 1000;
      const session = { openId, accessToken: login.accessToken, refreshToken: login.refreshToken, expiresAt, scope: login.scope };
      return {
        openId,
        displayName: found.displayName || openId,
        avatarUrl: found.avatarUrl || "",
        expiresAt,
        scope: login.scope,
        ticket: sealTicket(box, "tiktok", holder, session, now()),
      };
    },

    /** What a ticket holds, `{ session, nonce, until }`, when it was made for this holder and hasn't run out; otherwise null. */
    open(holder, ticket) {
      return openTicket(box, "tiktok", holder, ticket, now());
    },
  };
}
