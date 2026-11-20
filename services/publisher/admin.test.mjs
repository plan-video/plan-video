import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createAdmin } from "./admin.mjs";
import { createApi } from "./api.mjs";
import { YOUTUBE_UPLOAD_UNITS, createApiUsage, dayOf } from "./api-usage.mjs";
import { fakeDb } from "./fake-db.mjs";

const ADMIN = "0f0f0f0f-0000-4000-8000-000000000001";
const PERSON = "0f0f0f0f-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-11-21T10:00:00Z");

const answer = (status, body = "", headers = {}) => new Response(body, { status, headers });

/** A fetch that answers each call with the next of `answers`; an Error is thrown instead. */
function fakeFetch(answers) {
  return async () => {
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  };
}

function counter(db = { rpc: async () => null }) {
  return createApiUsage({ db, now: () => NOW, log: { warn() {}, error() {} } });
}

test("counts network calls by kind, prices YouTube's quota, and leaves other hosts alone", async () => {
  const usage = counter();
  const fetch = usage.wrap(fakeFetch([answer(200), answer(200), answer(200), answer(200), answer(200)]));
  await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet", { method: "POST" });
  await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc", { method: "PUT" });
  await fetch("https://www.googleapis.com/youtube/v3/channels?mine=true");
  await fetch("https://db.supabase.co/rest/v1/post_deliveries");
  await fetch(new Request("https://morel.us-east.host.bsky.network/xrpc/com.atproto.repo.createRecord", { method: "POST" }));

  const rows = usage.pending();
  const youtube = rows.filter((row) => row.network === "youtube");
  assert.deepEqual(youtube.map(({ kind, calls, units }) => ({ kind, calls, units })), [
    { kind: "upload", calls: 2, units: YOUTUBE_UPLOAD_UNITS },
    { kind: "read", calls: 1, units: 1 },
  ]);
  assert.deepEqual(rows.find((row) => row.network === "bluesky"), { day: "2026-11-21", network: "bluesky", kind: "post", calls: 1, failed: 0, limited: 0, units: 0 });
  assert.equal(rows.length, 3, "the database call isn't a network's");
  assert.equal(youtube[0].day, "2026-11-21");
  assert.equal(dayOf("youtube", Date.parse("2026-11-21T07:59:00Z")), "2026-11-20", "YouTube's day starts at midnight Pacific");
  assert.equal(dayOf("x", Date.parse("2026-11-21T07:59:00Z")), "2026-11-21");
});

test("a refusal for a limit counts as limited, and the caller still reads the answer", async () => {
  const usage = counter();
  const metaRefusal = JSON.stringify({ error: { code: 4, message: "Application request limit reached" } });
  const quota = JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } });
  const fetch = usage.wrap(fakeFetch([answer(429), answer(400, metaRefusal), answer(403, quota), answer(400, JSON.stringify({ error: { code: 100 } }))]));

  await fetch("https://api.x.com/2/tweets", { method: "POST" });
  const meta = await fetch("https://graph.facebook.com/v21.0/123/feed", { method: "POST" });
  assert.equal(JSON.parse(await meta.text()).error.code, 4);
  await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet");
  await fetch("https://graph.instagram.com/v21.0/123/media", { method: "POST" });
  await new Promise((resolve) => setImmediate(resolve));

  const limited = Object.fromEntries(usage.pending().map((row) => [row.network, row.limited]));
  assert.deepEqual(limited, { x: 1, facebook: 1, youtube: 1, instagram: 0 });
});

test("a call that gets no answer is counted as failed and still throws", async () => {
  const usage = counter();
  const fetch = usage.wrap(fakeFetch([new TypeError("fetch failed"), answer(503)]));
  await assert.rejects(fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", { method: "POST" }), /fetch failed/);
  await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", { method: "POST" });
  assert.deepEqual(usage.pending().map(({ calls, failed }) => ({ calls, failed })), [{ calls: 2, failed: 2 }]);
});

test("keeps the latest limits networks report in their headers", async () => {
  const usage = counter();
  const fetch = usage.wrap(
    fakeFetch([
      answer(200, "", { "x-app-usage": JSON.stringify({ call_count: 12, total_cputime: 40, total_time: 31 }) }),
      answer(200, "", {
        "x-business-use-case-usage": JSON.stringify({ 1: [{ type: "pages", call_count: 5 }], 2: [{ type: "pages", call_count: 70, estimated_time_to_regain_access: 0 }] }),
      }),
      answer(201, "", { "x-app-limit-24hour-limit": "10000", "x-app-limit-24hour-remaining": "9200", "x-app-limit-24hour-reset": "1763805600" }),
    ]),
  );
  await fetch("https://graph.facebook.com/v21.0/me");
  await fetch("https://graph.facebook.com/v21.0/me");
  await fetch("https://api.x.com/2/tweets", { method: "POST" });

  const limits = Object.fromEntries(usage.limits().map((limit) => [`${limit.network}|${limit.label}`, [limit.used, limit.limit]]));
  assert.deepEqual(limits, { "facebook|app": [40, 100], "facebook|pages": [70, 100], "x|posts-24h": [800, 10000] });
});

test("counts the database couldn't take go with the next flush", async () => {
  const sent = [];
  let up = false;
  const usage = counter({
    rpc: async (name, args) => {
      if (!up) throw new Error("down");
      sent.push([name, args.rows]);
    },
  });
  const fetch = usage.wrap(fakeFetch([answer(200), answer(200)]));
  await fetch("https://api.linkedin.com/rest/posts", { method: "POST" });
  await usage.flush();
  await fetch("https://api.linkedin.com/rest/posts", { method: "POST" });
  up = true;
  await usage.flush();
  assert.deepEqual(sent, [["add_api_usage", [{ day: "2026-11-21", network: "linkedin", kind: "post", calls: 2, failed: 0, limited: 0, units: 0 }]]]);
  assert.deepEqual(usage.pending(), []);
});

function setup() {
  const db = fakeDb({ posts: [] });
  db.tables.admins = [{ user_id: ADMIN }];
  const rpc = db.rpc.bind(db);
  db.rpc = async (name, args) =>
    name === "admin_usage_report" ? { people: 3, api_usage: [{ day: "2026-11-21", network: "x", kind: "post", calls: 5, failed: 0, limited: 0, units: 0 }] } : rpc(name, args);
  const usage = counter();
  const admin = createAdmin({ db, usage, networks: { x: {}, youtube: {} }, health: { report: () => [] }, passes: { last: () => null }, now: () => NOW });
  const api = createApi({ env: {}, vault: {}, worker: {}, kick: () => undefined, users: { from: async (req) => ({ id: req.headers.authorization.slice(7) }) }, limits: {}, db, admin });

  async function ask(person) {
    const req = Object.assign(new Readable({ read() {} }), { method: "POST", headers: { authorization: `Bearer ${person}` } });
    req.push("{}");
    req.push(null);
    let status = 0;
    let body = "";
    const res = { writableEnded: false, writeHead: (code) => (status = code), end: (text) => (body = text) };
    try {
      await api(req, res, "/api/publisher/admin/report");
    } catch (error) {
      return { status: error.status, error: error.message };
    }
    return { status, ...JSON.parse(body) };
  }
  return { ask, usage };
}

test("only admins get the report, which adds the calls not yet written", async () => {
  const { ask, usage } = setup();
  await usage.wrap(fakeFetch([answer(201)]))("https://api.x.com/2/tweets", { method: "POST" });

  const refused = await ask(PERSON);
  assert.deepEqual(refused, { status: 404, error: "Unknown publisher route." });

  const report = await ask(ADMIN);
  assert.equal(report.status, 200);
  assert.equal(report.people, 3);
  assert.deepEqual(report.networks, ["x", "youtube"]);
  assert.equal(report.api_usage.find((row) => row.network === "x").calls, 6);
});
