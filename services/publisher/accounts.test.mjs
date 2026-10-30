import { test } from "node:test";
import assert from "node:assert/strict";

import { accountLimit, createAccountLimits } from "./accounts.mjs";
import { createApi } from "./api.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createVault } from "./vault.mjs";

test("accountLimit is the plan's accounts plus the extra ones paid for", () => {
  assert.equal(accountLimit(1), 3);
  assert.equal(accountLimit(2), 15);
  assert.equal(accountLimit(3), 40);
  assert.equal(accountLimit(4), 100);
  assert.equal(accountLimit(4, 25), 125);
  assert.equal(accountLimit(undefined), 3);
  assert.equal(accountLimit(9, -4), 100);
});

test("limitFor reads the plan, falls back without the extras column, and gives up quietly", async () => {
  const rows = { u1: { access_level: 4, extra_accounts: 20 } };
  const withColumn = { selectOne: async (_table, filter) => rows[filter.id] ?? null };
  assert.equal(await createAccountLimits(withColumn).limitFor("u1"), 120);
  assert.equal(await createAccountLimits(withColumn).limitFor("nobody"), 3);

  const noColumn = {
    selectOne: async (_table, _filter, columns) => {
      if (columns.includes("extra_accounts")) throw new Error("column user_data.extra_accounts does not exist");
      return { access_level: 3 };
    },
  };
  assert.equal(await createAccountLimits(noColumn).limitFor("u1"), 40);

  const down = { selectOne: async () => { throw new Error("down"); } };
  assert.equal(await createAccountLimits(down).limitFor("u1"), undefined);
});

test("login/save refuses a new account past the limit, and still takes a reconnect", async () => {
  const db = fakeDb();
  const vault = createVault({ db, key: Buffer.alloc(32, 7).toString("base64"), env: {} });
  const api = createApi({
    env: {},
    vault,
    worker: {},
    kick: () => undefined,
    users: { from: async () => ({ id: "u1" }) },
    limits: { limitFor: async () => 2 },
  });
  const session = { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000, openId: "o", scope: "video.publish" };
  const save = async (connectionId) => {
    const body = JSON.stringify({ connectionId, platform: "tiktok", session });
    const req = Object.assign(new (await import("node:stream")).Readable({ read() {} }), { method: "POST", headers: {} });
    req.push(body);
    req.push(null);
    let status = 0;
    let answer = "";
    const res = { writableEnded: false, writeHead: (code) => (status = code), end: (text) => (answer = text) };
    try {
      await api(req, res, "/api/publisher/login/save");
    } catch (error) {
      return { status: error.status, error: error.message };
    }
    return { status, ...JSON.parse(answer) };
  };
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  assert.equal((await save(ids[0])).status, 200);
  assert.equal((await save(ids[1])).status, 200);
  const third = await save(ids[2]);
  assert.equal(third.status, 403);
  assert.match(third.error, /connects 2 social accounts/);
  assert.equal((await save(ids[0])).status, 200);
  assert.equal(db.tables.social_tokens.length, 2);
});
