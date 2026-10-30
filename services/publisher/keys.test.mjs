import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fakeDb } from "./fake-db.mjs";
import { checkKeys, fingerprint } from "./scripts/check-keys.mjs";
import { blueskyBinding, createVault, sealer } from "./vault.mjs";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER = Buffer.alloc(32, 8).toString("base64");
const script = (name) => new URL(`./scripts/${name}`, import.meta.url).pathname;

async function keptLogins() {
  const db = fakeDb();
  const vault = createVault({ db, key: KEY, env: {} });
  await vault.put("u1", "c1", "tiktok", { openId: "o", accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 86_400_000, scope: "video.publish" });
  await vault.put("u2", "c2", "bluesky", { did: "did:plc:x", oauth: true }, { allowOAuth: true });
  db.tables.bluesky_sessions.push({ user_id: "u2", did: "did:plc:x", sealed: sealer(KEY).seal({ tokenSet: {} }, blueskyBinding("u2", "did:plc:x")) });
  return db;
}

test("the key that sealed the logins opens every one of them", async () => {
  const result = await checkKeys({ db: await keptLogins(), key: KEY });
  assert.deepEqual(result.social_tokens, { total: 2, opened: 2, failed: [] });
  assert.deepEqual(result.bluesky_sessions, { total: 1, opened: 1, failed: [] });
});

test("any other key opens none, and names each row", async () => {
  const result = await checkKeys({ db: await keptLogins(), key: OTHER });
  assert.deepEqual(result.social_tokens, { total: 2, opened: 0, failed: ["u1:c1", "u2:c2"] });
  assert.deepEqual(result.bluesky_sessions, { total: 1, opened: 0, failed: ["u2:did:plc:x"] });
});

test("a row moved to another account doesn't open, even under the right key", async () => {
  const db = await keptLogins();
  db.tables.social_tokens[0].user_id = "u9";
  const result = await checkKeys({ db, key: KEY });
  assert.deepEqual(result.social_tokens.failed, ["u9:c1"]);
});

test("a table it can't read fails the check instead of passing as empty", async () => {
  const db = await keptLogins();
  const select = db.select;
  db.select = async (table, ...rest) => {
    if (table === "bluesky_sessions") throw new Error("column bluesky_sessions.user_id does not exist");
    return select(table, ...rest);
  };
  const result = await checkKeys({ db, key: KEY });
  assert.deepEqual(result.social_tokens, { total: 2, opened: 2, failed: [] });
  assert.match(result.bluesky_sessions.error, /user_id does not exist/);
});

test("a fingerprint tells keys apart without showing them", () => {
  assert.equal(fingerprint(KEY), fingerprint(KEY));
  assert.notEqual(fingerprint(KEY), fingerprint(OTHER));
  assert.ok(!KEY.includes(fingerprint(KEY)));
});

test("make-keys refuses when publisher.env already has its keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "publisher-keys-"));
  const env = join(dir, "publisher.env");
  writeFileSync(env, `SUPABASE_URL=https://x\nTOKEN_KEY=${KEY}\n`);
  const run = spawnSync(process.execPath, [script("make-keys.mjs")], { env: { ...process.env, PUBLISHER_ENV: env }, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /already has its keys/);
  assert.equal(readFileSync(env, "utf8"), `SUPABASE_URL=https://x\nTOKEN_KEY=${KEY}\n`);
});

/** A database answering only "is anything kept in this table", with `rows` per table; "down" fails every call. */
function fakePostgrest(rows) {
  const server = createServer((req, res) => {
    if (rows === "down") {
      res.writeHead(500).end("{}");
      return;
    }
    const table = new URL(req.url, "http://x").pathname.split("/").pop();
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(Array.from({ length: rows[table] ?? 0 }, () => ({ updated_at: "2026-10-12T00:00:00Z" }))));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

/** make-keys run against a publisher.env holding `lines`. */
function makeKeys(lines, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "publisher-keys-"));
  const env = join(dir, "publisher.env");
  writeFileSync(env, lines);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script("make-keys.mjs"), ...args], { env: { ...process.env, PUBLISHER_ENV: env, PLAN_VIDEO_ENV_DIR: dir } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("make-keys prints fresh keys when the database keeps no logins", async () => {
  const db = await fakePostgrest({});
  try {
    const run = await makeKeys(`SUPABASE_URL=${db.url}\nSUPABASE_SERVICE_ROLE_KEY=k\n`);
    assert.equal(run.status, 0, run.stderr);
    const key = run.stdout.match(/^TOKEN_KEY=(.+)$/m)?.[1];
    assert.equal(Buffer.from(key, "base64").length, 32);
    assert.match(run.stdout, /^BLUESKY_OAUTH_JWK=\{/m);
  } finally {
    db.close();
  }
});

test("make-keys refuses on a rebuilt server whose database keeps logins sealed with the old key", async () => {
  for (const rows of [{ social_tokens: 1 }, { bluesky_sessions: 1 }]) {
    const db = await fakePostgrest(rows);
    try {
      const run = await makeKeys(`SUPABASE_URL=${db.url}\nSUPABASE_SERVICE_ROLE_KEY=k\n`);
      assert.equal(run.status, 1);
      assert.equal(run.stdout, "");
      assert.match(run.stderr, /already keeps logins/);
    } finally {
      db.close();
    }
  }
});

test("make-keys refuses when it can't check the database, or isn't told where it is", async () => {
  const db = await fakePostgrest("down");
  try {
    const down = await makeKeys(`SUPABASE_URL=${db.url}\nSUPABASE_SERVICE_ROLE_KEY=k\n`);
    assert.equal(down.status, 1);
    assert.equal(down.stdout, "");
    assert.match(down.stderr, /couldn't check the database/);
  } finally {
    db.close();
  }
  const blind = await makeKeys("SUPABASE_URL=https://x\n");
  assert.equal(blind.status, 1);
  assert.equal(blind.stdout, "");
  assert.match(blind.stderr, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("make-keys skips the database only when told it's a new one", async () => {
  const run = await makeKeys("SUPABASE_URL=https://x\n", ["--new-database"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^TOKEN_KEY=/m);
});
