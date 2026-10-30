import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { fakeDb } from "./fake-db.mjs";
import { createHealth, deliveryProblems, keyOpensLogins } from "./health.mjs";
import { blueskyBinding, sealer, tokenBinding } from "./vault.mjs";
import { createWorker } from "./worker.mjs";

const KEY = randomBytes(32).toString("base64");
const OTHER = randomBytes(32).toString("base64");
const T0 = Date.parse("2026-10-16T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

const login = (key, user, connection, at = iso(T0)) => ({
  user_id: user,
  connection_id: connection,
  platform: "tiktok",
  sealed: sealer(key).seal({ accessToken: "a" }, tokenBinding(user, connection)),
  updated_at: at,
});

test("the key that sealed the logins opens them", async () => {
  const db = fakeDb();
  db.tables.social_tokens.push(login(KEY, "u1", "c1"), login(KEY, "u2", "c2"));
  db.tables.bluesky_sessions.push({ user_id: "u1", did: "did:plc:a", sealed: sealer(KEY).seal({}, blueskyBinding("u1", "did:plc:a")), updated_at: iso(T0) });
  assert.equal(await keyOpensLogins(db, KEY), "ok");
});

test("a new key on a rebuilt server is found out, even after someone connects with it", async () => {
  const db = fakeDb();
  db.tables.social_tokens.push(login(OTHER, "u1", "c1", iso(T0 - 3e9)), login(OTHER, "u2", "c2", iso(T0 - 2e9)), login(OTHER, "u3", "c3", iso(T0 - 1e9)));
  assert.equal(await keyOpensLogins(db, KEY), "wrong");
  // One new connection made since, sealed with the new key, doesn't hide it.
  db.tables.social_tokens.push(login(KEY, "u4", "c4"));
  assert.equal(await keyOpensLogins(db, KEY), "wrong");
});

test("no logins yet is fine, and logins that can't be read are unknown", async () => {
  assert.equal(await keyOpensLogins(fakeDb(), KEY), "ok");
  const db = fakeDb();
  db.sealedSample = async () => {
    throw new Error("The database didn't answer.");
  };
  assert.equal(await keyOpensLogins(db, KEY), "unknown");
});

test("a post long past its next look is reported", async () => {
  const db = fakeDb();
  db.tables.post_deliveries.push({ id: "r1", user_id: "u1", state: "queued", attempts: 0, next_at: iso(T0 - 20 * 60_000), updated_at: iso(T0 - 20 * 60_000) });
  assert.match((await deliveryProblems(db, T0)).join(), /past its time/);
  db.tables.post_deliveries[0].next_at = iso(T0 - 5 * 60_000);
  assert.deepEqual(await deliveryProblems(db, T0), []);
});

test("several people's posts failing with none going out is reported, one person's bad posts aren't", async () => {
  const db = fakeDb();
  const failed = (id, user) => ({ id, user_id: user, state: "failed", attempts: 4, next_at: iso(T0), updated_at: iso(T0 - 30 * 60_000) });
  for (let index = 0; index < 5; index++) db.tables.post_deliveries.push(failed(`a${index}`, "u1"));
  assert.deepEqual(await deliveryProblems(db, T0), []);
  db.tables.post_deliveries.push(failed("b1", "u2"));
  assert.match((await deliveryProblems(db, T0)).join(), /6 posts from 2 people failed/);
  db.tables.post_deliveries.push({ id: "s1", user_id: "u3", state: "sent", attempts: 1, next_at: iso(T0), updated_at: iso(T0 - 10 * 60_000) });
  assert.deepEqual(await deliveryProblems(db, T0), []);
});

test("health stops sending while the key is wrong and says why", async () => {
  const db = fakeDb();
  db.tables.social_tokens.push(login(OTHER, "u1", "c1"));
  const health = createHealth({ db, key: KEY, now: () => T0, log: { error() {} } });
  assert.equal(health.keyWrong(), false);
  const problems = await health.check();
  assert.equal(health.keyWrong(), true);
  assert.match(problems.join(), /TOKEN_KEY opens none/);
  // Back with the right key: sending goes on.
  const right = createHealth({ db, key: OTHER, now: () => T0, log: { error() {} } });
  await right.check();
  assert.equal(right.keyWrong(), false);
  assert.deepEqual(right.report(), []);
});

test("a database that can't be read doesn't stop sending", async () => {
  const db = fakeDb();
  db.tables.social_tokens.push(login(KEY, "u1", "c1"));
  const health = createHealth({ db, key: KEY, now: () => T0, log: { error() {} } });
  await health.check();
  db.sealedSample = async () => {
    throw new Error("down");
  };
  await health.check();
  assert.equal(health.keyWrong(), false);
});

test("a pass whose planning failed doesn't count as finished, so health turns red", async () => {
  const db = fakeDb();
  db.rpc = async () => {
    throw new Error("canceling statement due to statement timeout");
  };
  const worker = createWorker({ db, vault: {}, media: {}, networks: {}, sendFrom: 0, now: () => T0, log: { error() {} } });
  assert.equal(await worker.tick(), false);
  const fine = createWorker({ db: fakeDb(), vault: {}, media: {}, networks: {}, sendFrom: 0, now: () => T0, log: { error() {} } });
  assert.equal(await fine.tick(), true);
});
