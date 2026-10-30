// X logins never reach a browser. X bills plan.video for every post made with
// one, and anyone holding one could post around their plan's X limits
// (xAllowed in plans.mjs), so the publisher swaps the code X sends back for
// the tokens itself and hands the browser a ticket: the login sealed with
// TOKEN_KEY and bound to the person and workspace (ticketBinding in
// vault.mjs), which only this service can open. The browser shows the ticket
// to login/save to attach the account to a connection, as youtube-logins.mjs
// does for YouTube.

import { redirectsFor, memberFor, tokenRequest } from "../x/handler.mjs";

import { Refused } from "./errors.mjs";
import { openTicket, sealTicket, sealer } from "./vault.mjs";

export function createXLogins({ key, env, now = () => Date.now(), token = tokenRequest, member = memberFor }) {
  const box = sealer(key);
  return {
    /**
     * Swaps the code X sent back for the account's login. Returns who the
     * account is and a ticket for its login, never the tokens. `holder` is who
     * the ticket is for.
     */
    async exchange(holder, { code, redirectUri, codeVerifier }) {
      if (!env.clientId || !env.clientSecret) throw new Refused(503, "X isn't set up on the server yet.");
      if (!redirectsFor(env.publicUrl).has(redirectUri)) throw new Refused(400, "That X redirect address isn't allowed.");
      if (!code || !codeVerifier) throw new Refused(400, "X sent the login back without a code. Try again.");
      const login = await token(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier });
      if (login.error) throw new Refused(400, login.error);
      const found = await member(login.accessToken).catch(() => ({ error: "Couldn't reach X. Try again in a moment." }));
      if (found.error) throw new Refused(400, found.error);
      const expiresAt = now() + (login.expiresIn || 0) * 1000;
      const session = { xUserId: found.userId, accessToken: login.accessToken, refreshToken: login.refreshToken, expiresAt, scope: login.scope };
      return {
        xUserId: found.userId,
        username: found.username,
        avatarUrl: found.avatarUrl,
        expiresAt,
        scope: login.scope,
        ticket: sealTicket(box, "x", holder, session, now()),
      };
    },

    /** What a ticket holds, `{ session, nonce, until }`, when it was made for this holder and hasn't run out; otherwise null. */
    open(holder, ticket) {
      return openTicket(box, "x", holder, ticket, now());
    },
  };
}
