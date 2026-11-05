// Pinterest logins never reach a browser: the publisher swaps Pinterest's code itself and hands back a ticket
// sealed and bound to person and workspace (vault.mjs).

import { Refused } from "./errors.mjs";
import { authorizeUrl, configured, exchangeCode, redirectFor } from "./pinterest.mjs";
import { openTicket, sealTicket, sealer } from "./vault.mjs";

/** PUBLIC_URL in publisher.env. */
export function createPinterestLogins({ key, env, publicUrl = "https://plan.video", now = () => Date.now(), exchange = exchangeCode }) {
  const box = sealer(key);
  const site = publicUrl.replace(/\/+$/, "");

  function ready(redirectUri) {
    if (!configured(env)) throw new Refused(503, "Pinterest isn't set up on the server yet.");
    if (redirectUri !== redirectFor(site)) throw new Refused(400, "That Pinterest redirect address isn't allowed.");
  }

  return {
    authorize({ redirectUri, state }) {
      ready(redirectUri);
      if (!/^[\w-]{8,200}$/.test(state)) throw new Refused(400, "That login state isn't valid.");
      return { url: authorizeUrl(env, { redirectUri, state }) };
    },

    /** Returns the account and a ticket for its login, never the tokens. */
    async exchange(holder, { code, redirectUri }) {
      ready(redirectUri);
      if (!code) throw new Refused(400, "Pinterest sent the login back without a code. Try again.");
      let found;
      try {
        found = await exchange(env, { code, redirectUri, now: now() });
      } catch (error) {
        throw new Refused(400, error instanceof Error && error.message ? error.message : "Couldn't reach Pinterest. Try again in a moment.");
      }
      return {
        accountId: found.accountId,
        handle: found.handle,
        avatarUrl: found.avatarUrl,
        expiresAt: found.session.expiresAt,
        scope: found.session.scope,
        ticket: sealTicket(box, "pinterest", holder, found.session, now()),
      };
    },

    /** Null unless made for this holder and not run out. */
    open(holder, ticket) {
      return openTicket(box, "pinterest", holder, ticket, now());
    },
  };
}
