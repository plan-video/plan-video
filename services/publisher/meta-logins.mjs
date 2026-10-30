// Instagram, Facebook Page and Threads logins never reach a browser. The
// publisher starts the login, swaps the code Meta sends back for the login
// itself, and hands the browser a ticket per account: its login sealed with
// TOKEN_KEY and bound to the network, person and workspace (ticketBinding in
// vault.mjs), which only this service can open. The browser shows the ticket
// to login/save to attach the account to a connection, as x-logins.mjs does
// for X.

import { Refused } from "./errors.mjs";
import { META_NAMES, META_NETWORKS, authorizeUrl, configured, exchangeCode, redirectFor } from "./meta.mjs";
import { openTicket, sealTicket, sealer } from "./vault.mjs";

/** Facebook Pages one login connects. */
const MAX_PAGES = 50;

/** `publicUrl` is the site the logins come back to, PUBLIC_URL in publisher.env. */
export function createMetaLogins({ key, env, publicUrl = "https://plan.video", now = () => Date.now(), exchange = exchangeCode }) {
  const box = sealer(key);
  const site = publicUrl.replace(/\/+$/, "");

  function ready(network) {
    if (!configured(network, env)) throw new Refused(503, `${META_NAMES[network]} isn't set up on the server yet.`);
  }

  function allowed(network, redirectUri) {
    if (!META_NETWORKS.includes(network) || redirectUri !== redirectFor(site, network)) {
      throw new Refused(400, `That ${META_NAMES[network]} redirect address isn't allowed.`);
    }
  }

  return {
    /** The login dialog to send the person to. */
    authorize(network, { redirectUri, state }) {
      ready(network);
      allowed(network, redirectUri);
      if (!/^[\w-]{8,200}$/.test(state)) throw new Refused(400, "That login state isn't valid.");
      return { url: authorizeUrl(network, env, { redirectUri, state }) };
    },

    /**
     * Swaps the code Meta sent back for the login. Returns each account it
     * reaches, who it is and a ticket for its login, never the tokens.
     * `holder` is who the tickets are for.
     */
    async exchange(holder, network, { code, redirectUri }) {
      ready(network);
      allowed(network, redirectUri);
      if (!code) throw new Refused(400, `${META_NAMES[network]} sent the login back without a code. Try again.`);
      let found;
      try {
        found = await exchange(network, env, { code, redirectUri, now: now() });
      } catch (error) {
        throw new Refused(400, error instanceof Error && error.message ? error.message : `Couldn't reach ${META_NAMES[network]}. Try again in a moment.`);
      }
      return {
        accounts: found.slice(0, MAX_PAGES).map((account) => ({
          accountId: account.accountId,
          handle: account.handle,
          avatarUrl: account.avatarUrl,
          expiresAt: account.session.expiresAt,
          scope: account.session.scope,
          ticket: sealTicket(box, network, holder, account.session, now()),
        })),
      };
    },

    /** What a ticket holds, `{ session, nonce, until }`, when it was made for this holder and network and hasn't run out; otherwise null. */
    open(holder, network, ticket) {
      return openTicket(box, network, holder, ticket, now());
    },
  };
}
