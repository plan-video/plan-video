// YouTube logins never reach a browser. Anyone holding one could upload around
// plan.video's share of YouTube's daily quota, which every account draws on,
// so the publisher swaps the code Google sends back for the tokens itself and
// hands the browser a ticket: the login sealed with TOKEN_KEY and bound to the
// person and workspace (ticketBinding in vault.mjs), which only this service
// can open. The browser shows the ticket to login/save to attach the channel
// to a connection, once, within 15 minutes, and asks the publisher for the
// channel's picture and numbers.

import { redirectsFor, channelFor, explain, tokenRequest } from "../youtube/handler.mjs";

import { Refused } from "./errors.mjs";
import { openTicket, sealTicket, sealer } from "./vault.mjs";

export function createYouTubeLogins({ key, env, now = () => Date.now(), token = tokenRequest, channel = channelFor }) {
  const box = sealer(key);
  return {
    /**
     * Swaps the code Google sent back for the channel's login. Returns who the
     * channel is and a ticket for its login, never the tokens. `holder` is who
     * the ticket is for.
     */
    async exchange(holder, { code, redirectUri, codeVerifier }) {
      if (!env.clientId || !env.clientSecret) throw new Refused(503, "YouTube isn't set up on the server yet.");
      if (!redirectsFor(env.publicUrl).has(redirectUri)) throw new Refused(400, "That YouTube redirect address isn't allowed.");
      if (!code || !codeVerifier) throw new Refused(400, "YouTube sent the login back without a code. Try again.");
      const login = await token(env, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier });
      if (login.error) throw new Refused(400, login.error);
      const found = await channel(login.accessToken).catch(() => ({ error: explain(null) }));
      if (found.error) throw new Refused(400, found.error);
      const expiresAt = now() + (login.expiresIn || 0) * 1000;
      const session = { channelId: found.channelId, accessToken: login.accessToken, refreshToken: login.refreshToken, expiresAt, scope: login.scope };
      return {
        channelId: found.channelId,
        handle: found.handle,
        avatarUrl: found.avatarUrl,
        expiresAt,
        scope: login.scope,
        ticket: sealTicket(box, "youtube", holder, session, now()),
      };
    },

    /** What a ticket holds, `{ session, nonce, until }`, when it was made for this holder and hasn't run out; otherwise null. */
    open(holder, ticket) {
      return openTicket(box, "youtube", holder, ticket, now());
    },
  };
}
