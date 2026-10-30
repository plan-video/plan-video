// LinkedIn logins never reach a browser. A LinkedIn access token lasts about
// 60 days and can post to the member's profile, so a browser that got one
// while connecting an account for someone else's workspace could keep posting
// long after leaving it. The publisher swaps the code LinkedIn sends back for
// the tokens itself and hands the browser a ticket: the login sealed with
// TOKEN_KEY and bound to the person and workspace (ticketBinding in
// vault.mjs), which only this service can open. The browser shows the ticket
// to login/save, as youtube-logins.mjs does for YouTube.

import { redirectsFor, memberFor, tokenRequest } from "../linkedin/handler.mjs";

import { Refused } from "./errors.mjs";
import { openTicket, sealTicket, sealer } from "./vault.mjs";

export function createLinkedInLogins({ key, env, now = () => Date.now(), token = tokenRequest, member = memberFor }) {
  const box = sealer(key);
  return {
    /**
     * Swaps the code LinkedIn sent back for the member's login. Returns who the
     * member is, when the login runs out and whether it can be renewed without
     * them, and a ticket for the login, never the tokens. `holder` is who the
     * ticket is for.
     */
    async exchange(holder, { code, redirectUri }) {
      if (!env.clientId || !env.clientSecret) throw new Refused(503, "LinkedIn isn't set up on the server yet.");
      if (!redirectsFor(env.publicUrl).has(redirectUri)) throw new Refused(400, "That LinkedIn redirect address isn't allowed.");
      if (!code) throw new Refused(400, "LinkedIn sent the login back without a code. Try again.");
      const login = await token(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri }).catch(() => ({ error: "Couldn't reach LinkedIn. Try again in a moment." }));
      if (login.error) throw new Refused(400, login.error);
      const found = await member(login.accessToken).catch(() => ({ error: "Couldn't reach LinkedIn. Try again in a moment." }));
      if (found.error) throw new Refused(400, found.error);
      const expiresAt = now() + (login.expiresIn || 0) * 1000;
      const session = { personId: found.personId, accessToken: login.accessToken, refreshToken: login.refreshToken, expiresAt, scope: login.scope };
      return {
        personId: found.personId,
        displayName: found.name,
        avatarUrl: found.avatarUrl,
        expiresAt,
        renewable: !!login.refreshToken,
        scope: login.scope,
        ticket: sealTicket(box, "linkedin", holder, session, now()),
      };
    },

    /** What a ticket holds, `{ session, nonce, until }`, when it was made for this holder and hasn't run out; otherwise null. */
    open(holder, ticket) {
      return openTicket(box, "linkedin", holder, ticket, now());
    },
  };
}
