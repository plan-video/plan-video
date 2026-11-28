/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What posting.mjs reads and writes, asked with the connector's own token: the agent_* functions check who it
// speaks for and where they may work (supabase/migrations/20261127120000_agent_tools.sql), services/storage copies
// files and the publisher sends and reads networks the same way. This server holds no key of its own.

const RPC_MS = 10_000;
/** A video copied inside the bucket can be 500 MB. */
const COPY_MS = 120_000;
/** Networks can be slow to answer, as the publisher is to them. */
const PUBLISHER_MS = 30_000;
const NOT_YET = "plan.video is being updated. Try again in a few minutes.";
/** Raised by the agent_* functions and the posts table's rules with words meant for the agent. */
const OWN_CODES = new Set(["28000", "42501", "22023", "P0002", "P0001", "54000"]);

async function answer(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** The workspace the publisher acts in, which it checks the agent's person is in. */
const teamOf = (scope) => ({ owner: scope.owner, workspace: scope.workspace });

export function createStore({ supabaseUrl, anonKey, storageUrl, publisherUrl, token, fetch: fetchImpl = fetch }) {
  async function rpc(name, args) {
    let response;
    try {
      response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(RPC_MS),
      });
    } catch {
      throw new Error("plan.video can't be reached right now. Try again in a minute.");
    }
    const found = await answer(response);
    if (response.ok) return found;
    // Before the migration is applied, PostgREST knows no such function, and refuse_app_tokens refuses it.
    if (found?.code === "PGRST202" || found?.code === "PT403") throw new Error(NOT_YET);
    if (found?.code === "23505") throw new Error("This post already exists.");
    // Only the agent_* functions' own words; anything else may name tables or types.
    if (OWN_CODES.has(found?.code) && typeof found.message === "string" && found.message) throw new Error(found.message);
    throw new Error("plan.video couldn't do that. Try again in a minute.");
  }

  async function publisher(route, body) {
    let response;
    try {
      response = await fetchImpl(`${publisherUrl}/api/publisher/${route}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PUBLISHER_MS),
      });
    } catch {
      throw new Error("plan.video's publisher can't be reached right now. Try again in a minute.");
    }
    const found = await answer(response);
    if (response.ok) return found ?? {};
    throw new Error(typeof found?.error === "string" && found.error ? found.error : "plan.video couldn't do that.");
  }

  return {
    context: () => rpc("agent_context", {}),

    posts: (scope, filter) =>
      rpc("agent_posts", {
        owner: scope.owner,
        workspace: scope.workspace,
        post_id: filter.id ?? null,
        status: filter.status ?? null,
        from_day: filter.from ?? null,
        to_day: filter.to ?? null,
      }),

    save: (scope, post, base) => rpc("agent_save_post", { owner: scope.owner, workspace: scope.workspace, post, base }),

    remove: (scope, id, base) => rpc("agent_delete_post", { owner: scope.owner, workspace: scope.workspace, post_id: id, base }),

    askApproval: (scope, id, base, snapshot) => rpc("agent_ask_approval", { owner: scope.owner, workspace: scope.workspace, post_id: id, base, snapshot }),

    send: async (scope, id) => (await publisher("send", { postId: id, team: teamOf(scope) })).deliveries ?? [],

    network: (scope, route, body) => publisher(route, { ...body, team: teamOf(scope) }),

    async copyFiles(scope, copies) {
      let response;
      try {
        response = await fetchImpl(`${storageUrl}/api/storage/agent-copy`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ owner: scope.owner, workspace: scope.workspace, copies }),
          signal: AbortSignal.timeout(COPY_MS),
        });
      } catch {
        throw new Error("Cloud storage can't be reached right now. Try again in a minute.");
      }
      if (response.status === 404) throw new Error(NOT_YET);
      if (!response.ok) {
        const found = await answer(response);
        throw new Error(typeof found?.error === "string" && found.error ? found.error : "Cloud storage couldn't attach the file.");
      }
    },
  };
}
