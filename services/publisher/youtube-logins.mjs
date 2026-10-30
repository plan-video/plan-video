// YouTube logins never reach a browser: anyone holding one could upload around plan.video's share of the
// daily quota every account draws on. The publisher swaps Google's code itself and hands back a ticket
// sealed and bound to person and workspace, attachable once within 15 minutes.

import { redirectsFor, channelFor, explain, tokenRequest } from "../youtube/handler.mjs";

import { Refused } from "./errors.mjs";
import { openTicket, sealTicket, sealer } from "./vault.mjs";

export function createYouTubeLogins({ key, env, now = () => Date.now(), token = tokenRequest, channel = channelFor }) {
  const box = sealer(key);
  return {
    /** Returns the channel and a ticket for its login, never the tokens. */
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

    /** Null unless made for this holder and not run out. */
    open(holder, ticket) {
      return openTicket(box, "youtube", holder, ticket, now());
    },
  };
}
