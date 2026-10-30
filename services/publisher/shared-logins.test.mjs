import assert from "node:assert/strict";
import test from "node:test";

import { fakeDb } from "./fake-db.mjs";
import { sharedLogins } from "./scripts/shared-logins.mjs";

test("finds the logins an admin or member could have been given", async () => {
  const db = fakeDb();
  db.tables.social_tokens = [
    { user_id: "o1", connection_id: "li-team", platform: "linkedin" },
    { user_id: "o1", connection_id: "tt-team", platform: "tiktok" },
    { user_id: "o1", connection_id: "li-own", platform: "linkedin" },
    { user_id: "o1", connection_id: "yt-team", platform: "youtube" },
    { user_id: "o2", connection_id: "tt-members", platform: "tiktok" },
    { user_id: "o2", connection_id: "li-members", platform: "linkedin" },
    { user_id: "o3", connection_id: "li-alone", platform: "linkedin" },
  ];
  db.tables.workspace_members = [
    { owner_id: "o1", workspace_id: "brand", role: "admin", user_id: "a1" },
    { owner_id: "o1", workspace_id: "own", role: "admin", user_id: null }, // invited, not joined
    { owner_id: "o2", workspace_id: "w", role: "member", user_id: "m1" },
  ];
  const listed = { o1: [["brand", "li-team"], ["brand", "tt-team"], ["brand", "yt-team"], ["own", "li-own"]], o2: [["w", "tt-members"], ["w", "li-members"]] };
  db.rpc = async (name, { owner }) => (listed[owner] ?? []).map(([workspace_id, connection_id]) => ({ workspace_id, connection_id }));
  const found = (await sharedLogins(db)).map((row) => `${row.connection_id}:${row.why}`).sort();
  assert.deepEqual(found, ["li-team:admin", "tt-members:member", "tt-team:admin"]);
  const all = (await sharedLogins(db, { everyone: true })).map((row) => `${row.connection_id}:${row.why}`).sort();
  assert.deepEqual(all, ["li-alone:everyone", "li-members:everyone", "li-own:everyone", "li-team:admin", "tt-members:member", "tt-team:admin"]);
});
