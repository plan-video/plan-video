// Beyond passes finishing: a TOKEN_KEY that opens no kept login (sending stops so posts wait instead of all
// failing), posts long past their next look, and several people's posts failing with none sent.
// Checked once a minute, not on each request: health is open to anyone.

import { blueskyBinding, sealer, tokenBinding } from "./vault.mjs";

export const OVERDUE_MS = 15 * 60_000;
export const FAILING_WINDOW_MS = 2 * 60 * 60_000;
export const FAILING_AT_LEAST = 5;
export const FAILING_PEOPLE = 2;
const SAMPLE = 5;

const iso = (ms) => new Date(ms).toISOString();

/**
 * Tried on the oldest and newest of each table: "wrong" when fewer than half open, as after a rebuild with
 * a new key (newer logins open, older don't); "ok" when there are none; "unknown" when they couldn't be read.
 */
export async function keyOpensLogins(db, key) {
  const box = sealer(key);
  const tables = [
    { table: "social_tokens", columns: "user_id,connection_id,sealed", bind: (row) => tokenBinding(row.user_id, row.connection_id) },
    { table: "bluesky_sessions", columns: "user_id,did,sealed", bind: (row) => blueskyBinding(row.user_id, row.did) },
  ];
  let tried = 0;
  let opened = 0;
  for (const { table, columns, bind } of tables) {
    let rows;
    try {
      rows = await db.sealedSample(table, columns, SAMPLE);
    } catch {
      return "unknown";
    }
    for (const row of rows) {
      tried++;
      try {
        box.open(row.sealed, bind(row));
        opened++;
      } catch {}
    }
  }
  return tried && opened * 2 < tried ? "wrong" : "ok";
}

export async function deliveryProblems(db, at) {
  const problems = [];
  const overdue = await db.overdue(iso(at - OVERDUE_MS));
  if (overdue) problems.push("a scheduled post is over 15 minutes past its time and hasn't been sent");
  const { failed, people, sent } = await db.outcomesSince(iso(at - FAILING_WINDOW_MS));
  if (!sent && failed >= FAILING_AT_LEAST && people >= FAILING_PEOPLE) {
    problems.push(`${failed} posts from ${people} people failed in the last 2 hours and none went out`);
  }
  return problems;
}

export function createHealth({ db, key, now = () => Date.now(), log = console }) {
  let keys = "unknown";
  let problems = [];
  let checkedAt = 0;

  async function check() {
    const at = now();
    const found = await keyOpensLogins(db, key);
    // A failed read keeps what was last known, so a database hiccup neither stops nor starts sending.
    if (found !== "unknown") {
      if (found === "wrong" && keys !== "wrong") log.error("[publisher] TOKEN_KEY opens none of the kept logins: sending is stopped until the right key is back");
      keys = found;
    }
    try {
      problems = await deliveryProblems(db, at);
      checkedAt = at;
    } catch (error) {
      log.error("[publisher] checking deliveries failed", error instanceof Error ? error.message : error);
    }
    return report();
  }

  function report() {
    const list = [...(keys === "wrong" ? ["TOKEN_KEY opens none of the kept logins, so nothing can be sent"] : []), ...problems];
    // Not checked for 5 minutes counts too: the check itself may be what's stuck.
    if (checkedAt && now() - checkedAt > 5 * 60_000) list.push("deliveries haven't been checked for 5 minutes");
    return list;
  }

  return {
    check,
    report,
    /** Sending waits while the key is known to be wrong, so posts aren't all failed for it. */
    keyWrong: () => keys === "wrong",
  };
}
