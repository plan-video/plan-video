// Checks that a TOKEN_KEY opens every row of social_tokens and bluesky_sessions. Give a backup on stdin
// (--stdin) so it never shows in the process list; without it, publisher.env's own key is checked.
// Exits 1 when any row doesn't open. Prints counts and a fingerprint, never a key.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { createDb } from "../db.mjs";
import { blueskyBinding, sealer, tokenBinding } from "../vault.mjs";

const PAGE = 1000;

export const fingerprint = (base64Key) => createHash("sha256").update(Buffer.from(base64Key, "base64")).digest("hex").slice(0, 16);

export async function checkKeys({ db, key }) {
  const box = sealer(key);
  const tables = [
    { table: "social_tokens", columns: "user_id,connection_id,sealed", bind: (row) => tokenBinding(row.user_id, row.connection_id), id: (row) => row.connection_id },
    { table: "bluesky_sessions", columns: "user_id,did,sealed", bind: (row) => blueskyBinding(row.user_id, row.did), id: (row) => row.did },
  ];
  const result = {};
  for (const { table, columns, bind, id } of tables) {
    const counts = { total: 0, opened: 0, failed: [] };
    try {
      for (let offset = 0; ; offset += PAGE) {
        const rows = await db.select(table, {}, columns, `&order=user_id.asc&limit=${PAGE}&offset=${offset}`);
        for (const row of rows) {
          counts.total++;
          try {
            box.open(row.sealed, bind(row));
            counts.opened++;
          } catch {
            counts.failed.push(`${row.user_id}:${id(row)}`);
          }
        }
        if (rows.length < PAGE) break;
      }
    } catch (error) {
      // A table that can't be read, such as one a migration hasn't reached, fails the check too.
      counts.error = error.message;
    }
    result[table] = counts;
  }
  return result;
}

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    const eq = trimmed.indexOf("=");
    if (!trimmed || trimmed.startsWith("#") || eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

/** Bare, or as a TOKEN_KEY= line among others. */
function keyFromStdin() {
  const text = readFileSync(0, "utf8");
  const line = text.split("\n").map((item) => item.trim()).find((item) => item.startsWith("TOKEN_KEY="));
  return (line ? line.slice("TOKEN_KEY=".length) : text).trim();
}

async function main() {
  const dir = process.env.PLAN_VIDEO_ENV_DIR || "/etc/plan-video";
  const own = loadEnv(process.env.PUBLISHER_ENV || `${dir}/publisher.env`);
  const supabaseUrl = own.SUPABASE_URL || loadEnv(`${dir}/r2.env`).SUPABASE_URL;
  if (!supabaseUrl || !own.SUPABASE_SERVICE_ROLE_KEY || !own.TOKEN_KEY) {
    console.error("check-keys: publisher.env needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and TOKEN_KEY");
    process.exit(1);
  }
  const given = process.argv.includes("--stdin") ? keyFromStdin() : "";
  if (process.argv.includes("--stdin") && !given) {
    console.error("check-keys: no key on stdin");
    process.exit(1);
  }
  const key = given || own.TOKEN_KEY;
  console.log(`key ${fingerprint(key)}${given ? ` (from stdin; publisher.env's is ${fingerprint(own.TOKEN_KEY)})` : " (publisher.env's own)"}`);
  const result = await checkKeys({ db: createDb({ url: supabaseUrl, serviceKey: own.SUPABASE_SERVICE_ROLE_KEY }), key });
  let ok = true;
  for (const [table, { total, opened, failed, error }] of Object.entries(result)) {
    console.log(error ? `${table}: couldn't read it: ${error}` : `${table}: ${opened} of ${total} open`);
    for (const row of failed) console.log(`  doesn't open: ${row}`);
    if (failed.length || error) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
