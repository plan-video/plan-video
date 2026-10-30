// Prints the publisher's own secrets as publisher.env lines: the key that
// seals logins, and the "Sign in with Bluesky" client's private key. Run it on
// the server, once, and append its output to /etc/plan-video/publisher.env:
//
//   node scripts/make-keys.mjs >> /etc/plan-video/publisher.env
//
// Changing TOKEN_KEY later makes every kept login unreadable, so every account
// would have to connect again. Changing the Bluesky key ends every Bluesky sign-in.
// So it refuses when publisher.env already holds either: a second run appended
// to it would quietly win, as the last line does. It also refuses when the
// database already keeps logins, as on a server rebuilt for the same database:
// those were sealed with the key in the backup, which goes back in instead.
// publisher.env needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first for that
// check; `--new-database` skips it, only for a database that has never kept a
// login. Keep a copy of both keys off the server, and prove the copy with
// scripts/check-keys.mjs.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { makeBlueskyKey } from "../bluesky-oauth.mjs";
import { createDb } from "../db.mjs";

function loadEnv(path) {
  const env = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const eq = trimmed.indexOf("=");
    if (!trimmed || trimmed.startsWith("#") || eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return { env, text };
}

const fail = (message) => {
  console.error(`make-keys: ${message}`);
  process.exit(1);
};

const dir = process.env.PLAN_VIDEO_ENV_DIR || "/etc/plan-video";
const target = process.env.PUBLISHER_ENV || `${dir}/publisher.env`;
const { env: own, text: existing } = loadEnv(target);
if (/^\s*(TOKEN_KEY|BLUESKY_OAUTH_JWK)\s*=/m.test(existing)) {
  fail(`${target} already has its keys. New ones would make every kept login unreadable, so nothing was printed.`);
}

if (!process.argv.includes("--new-database")) {
  const url = own.SUPABASE_URL || loadEnv(`${dir}/r2.env`).env.SUPABASE_URL;
  if (!url || !own.SUPABASE_SERVICE_ROLE_KEY) {
    fail(`put SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in ${target} first, so it can check the database keeps no logins sealed with an earlier key. Nothing was printed.`);
  }
  const db = createDb({ url, serviceKey: own.SUPABASE_SERVICE_ROLE_KEY });
  let kept = 0;
  try {
    for (const table of ["social_tokens", "bluesky_sessions"]) kept += (await db.select(table, {}, "updated_at", "&limit=1")).length;
  } catch (error) {
    fail(`couldn't check the database for kept logins (${error.message}). Nothing was printed.`);
  }
  if (kept) {
    fail(
      "the database already keeps logins, sealed with an earlier TOKEN_KEY, and new keys would make every one unreadable. " +
        "Put the keys from their backup in publisher.env instead (Keychain: \"plan.video publisher\", accounts TOKEN_KEY and BLUESKY_OAUTH_JWK), " +
        "then prove them with scripts/check-keys.mjs. Nothing was printed.",
    );
  }
}

console.log(`TOKEN_KEY=${randomBytes(32).toString("base64")}`);
console.log(`BLUESKY_OAUTH_JWK=${await makeBlueskyKey()}`);
console.log(`SEND_FROM=${new Date().toISOString()}`);
// The site's address, for login callbacks and the links in emails: PUBLIC_URL
// from the environment when given (`PUBLIC_URL=https://example.com node
// scripts/make-keys.mjs`), else plan.video's. One publisher.env already has
// stays as it is.
if (!own.PUBLIC_URL) console.log(`PUBLIC_URL=${process.env.PUBLIC_URL || "https://plan.video"}`);
