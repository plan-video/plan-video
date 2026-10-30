// LinkedIn logins never reach a browser: an access token lasts about 60 days and can post to the profile,
// so a browser that got one connecting for someone else's workspace could keep posting after leaving it.
// The publisher swaps the code itself and hands back a ticket sealed and bound to person and workspace.

import { redirectsFor, memberFor, tokenRequest } from "../linkedin/handler.mjs";

import { Refused } from "./errors.mjs";
import { openTicket, sealTicket, sealer } from "./vault.mjs";

export function createLinkedInLogins({ key, env, now = () => Date.now(), token = tokenRequest, member = memberFor }) {
  const box = sealer(key);
  return {
    /** Returns the member, when the login runs out and whether it renews on its own, and a ticket, never the tokens. */
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

    /** Null unless made for this holder and not run out. */
    open(holder, ticket) {
      return openTicket(box, "linkedin", holder, ticket, now());
    },
  };
}
