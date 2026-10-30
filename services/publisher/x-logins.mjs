// X logins never reach a browser: X bills plan.video per post, and anyone holding one could post around
// their plan's X limits. The publisher swaps X's code itself and hands back a ticket sealed and bound to
// person and workspace.

import { redirectsFor, memberFor, tokenRequest } from "../x/handler.mjs";

import { Refused } from "./errors.mjs";
import { openTicket, sealTicket, sealer } from "./vault.mjs";

export function createXLogins({ key, env, now = () => Date.now(), token = tokenRequest, member = memberFor }) {
  const box = sealer(key);
  return {
    /** Returns the account and a ticket for its login, never the tokens. */
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

    /** Null unless made for this holder and not run out. */
    open(holder, ticket) {
      return openTicket(box, "x", holder, ticket, now());
    },
  };
}
