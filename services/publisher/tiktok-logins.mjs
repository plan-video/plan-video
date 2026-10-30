// TikTok logins never reach a browser: anyone holding one could post straight through TikTok's API, and
// one got connecting for someone else's workspace would outlast leaving it. The publisher swaps the code
// itself and hands back a ticket sealed and bound to person and workspace.

import { redirectsFor, profileFor, tokenRequest } from "../tiktok/handler.mjs";

import { Refused } from "./errors.mjs";
import { openTicket, sealTicket, sealer } from "./vault.mjs";

export function createTikTokLogins({ key, env, now = () => Date.now(), token = tokenRequest, profile = profileFor }) {
  const box = sealer(key);
  return {
    /** Returns the account and a ticket for its login, never the tokens. */
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

    /** Null unless made for this holder and not run out. */
    open(holder, ticket) {
      return openTicket(box, "tiktok", holder, ticket, now());
    },
  };
}
