import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createApi } from "./api.mjs";
import { createDb } from "./db.mjs";
import { fakeDb } from "./fake-db.mjs";
import { createVault } from "./vault.mjs";
import { chatHoldsYouTube, createYouTubeCheck } from "./youtube-check.mjs";

const KEY = Buffer.alloc(32, 7).toString("base64");
const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const T0 = Date.parse("2026-11-20T03:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const OLD = iso(T0 - 3 * 24 * 60 * 60_000);
const YOUNG = iso(T0 - 60 * 60_000);
const UPLOAD = "upload:https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc";

const row = (id, values) => ({ id, user_id: OWNER, workspace_id: "brand", post_id: id, occurrence: "once", platform: "youtube", connection_id: "yt1", state: "sent", publish_id: null, url: null, error: null, updated_at: OLD, ...values });
const watch = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

const account = () => ({
  user_id: OWNER,
  payload: {
    revision: "r1",
    workspaces: { active: "brand", list: [{ id: "brand", name: "Brand" }] },
    slices: {
      brand: {
        connections: [
          { id: "yt1", platform: "youtube", handle: "old name", avatarUrl: "https://yt3.test/old.jpg", youtube: { channelId: "UC1", scope: "s" } },
          { id: "x1", platform: "x", handle: "someone" },
        ],
      },
    },
  },
});

function google({ token = () => ({ status: 200, body: { access_token: "ya29.new", expires_in: 3600 } }), videos = (ids) => ({ status: 200, body: { items: ids.map((id) => ({ id })) } }) } = {}) {
  const asked = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const address = String(url);
    asked.push(address);
    const answer = address.startsWith("https://oauth2.googleapis.com/token")
      ? token()
      : address.startsWith("https://www.googleapis.com/youtube/v3/videos")
        ? videos(new URL(address).searchParams.get("id").split(","))
        : { status: 404, body: {} };
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  return { asked, restore: () => (globalThis.fetch = original) };
}

async function setup({ rows = [], channel } = {}) {
  const db = fakeDb();
  db.tables.post_deliveries.push(...rows);
  db.tables.account_state.push(account());
  const vault = createVault({ db, key: KEY, env: { youtube: { clientId: "id", clientSecret: "secret" } } });
  await vault.put(OWNER, "yt1", "youtube", { channelId: "UC1", accessToken: "ya29.old", refreshToken: "1//refresh", expiresAt: 0, scope: "s" });
  const lines = [];
  const log = { log: (line) => lines.push(line), warn: (...parts) => lines.push(parts.join(" ")) };
  const check = createYouTubeCheck({
    db,
    vault,
    env: { clientId: "id", clientSecret: "secret" },
    channel: channel ?? (async () => ({ channelId: "UC1", handle: "New Name", avatarUrl: "https://yt3.test/new.jpg" })),
    now: () => T0,
    pause: 0,
    log,
  });
  const byId = (id) => db.tables.post_deliveries.find((item) => item.id === id);
  const connection = () => db.tables.account_state[0].payload.slices.brand.connections[0];
  return { db, vault, check, lines, byId, connection };
}

test("a video deleted on YouTube loses its id and link; the rest stay, and new or unfinished ones aren't asked about", async () => {
  const { db, check, lines, byId, connection } = await setup({
    rows: [
      row("d1", { publish_id: "aaaaaaaaaa1", url: watch("aaaaaaaaaa1") }),
      row("d2", { publish_id: "bbbbbbbbbb2", url: watch("bbbbbbbbbb2"), error: "private" }),
      row("d3", { state: "failed", publish_id: UPLOAD, error: "The upload to YouTube stopped." }),
      row("d4", { publish_id: "cccccccccc3", url: watch("cccccccccc3"), updated_at: YOUNG }),
      row("d5", { state: "sending", publish_id: UPLOAD }),
    ],
  });
  const { asked, restore } = google({ videos: (ids) => ({ status: 200, body: { items: ids.filter((id) => id !== "bbbbbbbbbb2").map((id) => ({ id })) } }) });
  try {
    const counts = await check.run();
    assert.equal(counts.gone, 1);
    assert.equal(counts.confirmed, 1);
  } finally {
    restore();
  }
  const lookups = asked.filter((url) => url.includes("/youtube/v3/videos"));
  assert.equal(lookups.length, 1);
  assert.deepEqual(new URL(lookups[0]).searchParams.get("id").split(","), ["aaaaaaaaaa1", "bbbbbbbbbb2"]);
  assert.deepEqual([byId("d2").publish_id, byId("d2").url, byId("d2").error, byId("d2").state], [null, null, null, "sent"]);
  assert.equal(byId("d1").publish_id, "aaaaaaaaaa1");
  assert.equal(byId("d3").publish_id, UPLOAD);
  assert.equal(byId("d4").publish_id, "cccccccccc3");
  assert.equal(byId("d5").publish_id, UPLOAD);
  assert.equal(db.tables.social_tokens.length, 1);
  assert.equal(connection().handle, "New Name");
  assert.equal(connection().avatarUrl, "https://yt3.test/new.jpg");
  assert.deepEqual(connection().youtube, { channelId: "UC1", scope: "s" });
  const payload = db.tables.account_state[0].payload;
  assert.notEqual(payload.revision, "r1");
  assert.deepEqual(payload.slices.brand.connections[1], account().payload.slices.brand.connections[1]);
  assert.equal(payload.workspaces.list.length, 1);
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /ya29|refresh|aaaaaaaaaa1/);
});

test("a deleted video's row is cleared though the account can't be saved: no post keeps a copy of its id", async () => {
  const { db, check, byId } = await setup({ rows: [row("d1", { publish_id: "aaaaaaaaaa1", url: watch("aaaaaaaaaa1") })] });
  let saves = 0;
  db.replaceAccountState = async () => (saves++, false);
  const { restore } = google({ videos: () => ({ status: 200, body: { items: [] } }) });
  try {
    const counts = await check.run();
    assert.equal(counts.gone, 1);
  } finally {
    restore();
  }
  assert.equal(byId("d1").publish_id, null);
  assert.equal(byId("d1").url, null);
  assert.ok(saves <= 3);
});

test("the account isn't saved when the name and picture are the same, nor over a copy saved meanwhile", async () => {
  const same = await setup({ channel: async () => ({ channelId: "UC1", handle: "@old name", avatarUrl: "https://yt3.test/old.jpg" }) });
  let { restore } = google();
  try {
    assert.equal((await same.check.run()).renamed, 0);
  } finally {
    restore();
  }
  assert.equal(same.db.tables.account_state[0].payload.revision, "r1");

  const busy = await setup();
  // Every save finds the account moved on, as when a browser saves it each time first.
  busy.db.replaceAccountState = async () => false;
  ({ restore } = google());
  try {
    const counts = await busy.check.run();
    assert.equal(counts.renamed, 0);
    assert.equal(counts.failed, 1);
  } finally {
    restore();
  }
  assert.equal(busy.connection().handle, "old name");
});

test("another channel's login doesn't rename the account", async () => {
  const { check, connection } = await setup({ channel: async () => ({ channelId: "UC2", handle: "Other", avatarUrl: "" }) });
  const { restore } = google();
  try {
    await check.run();
  } finally {
    restore();
  }
  assert.equal(connection().handle, "old name");
});

test("access taken away at Google drops the login, the channel's videos' ids and links, and its name and picture", async () => {
  const { db, check, byId, connection } = await setup({
    rows: [
      row("d1", { publish_id: "aaaaaaaaaa1", url: watch("aaaaaaaaaa1") }),
      row("d2", { state: "failed", publish_id: UPLOAD, error: "YouTube refused the request." }),
      row("d3", { state: "queued", error: "Your plan uploads up to 3 YouTube videos a day" }),
      row("o1", { connection_id: "yt9", user_id: "0f0f0f0f-0000-4000-8000-000000000002", publish_id: "zzzzzzzzzz9", url: watch("zzzzzzzzzz9") }),
    ],
  });
  db.tables.social_tokens.push({ ...db.tables.social_tokens[0], user_id: "0f0f0f0f-0000-4000-8000-000000000002", connection_id: "yt9" });
  db.tables.social_tokens[1].sealed = "unreadable";
  const { asked, restore } = google({ token: () => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }) });
  try {
    const counts = await check.run();
    assert.equal(counts.revoked, 1);
  } finally {
    restore();
  }
  assert.ok(!asked.some((url) => url.includes("/youtube/v3/")), "nothing more is asked of YouTube");
  assert.deepEqual(db.tables.social_tokens.map((item) => item.connection_id), ["yt9"]);
  for (const id of ["d1", "d2"]) assert.deepEqual([byId(id).publish_id, byId(id).url, byId(id).error], [null, null, null], id);
  assert.equal(byId("d1").state, "sent", "the row still says it went out");
  assert.equal(byId("d3").error, "Your plan uploads up to 3 YouTube videos a day");
  assert.equal(byId("o1").publish_id, "zzzzzzzzzz9");
  assert.equal(connection().handle, "YouTube");
  assert.equal("avatarUrl" in connection(), false);
  assert.deepEqual(connection().youtube, { channelId: "UC1", scope: "s" });
});

test("a login reconnected meanwhile isn't dropped with the one that failed", async () => {
  const { db, vault, check } = await setup();
  const { restore } = google({
    token: () => {
      // The channel is connected again while Google answers about the old login.
      void vault.put(OWNER, "yt1", "youtube", { channelId: "UC1", accessToken: "ya29.fresh", refreshToken: "1//again", expiresAt: Date.now() + 3600_000, scope: "s" });
      return { status: 400, body: { error: "invalid_grant" } };
    },
  });
  try {
    await check.run();
  } finally {
    restore();
  }
  assert.equal(db.tables.social_tokens.length, 1);
  assert.equal((await vault.read(OWNER, "yt1")).session.refreshToken, "1//again");
});

for (const [name, answers] of [
  ["Google not answering", { token: () => new TypeError("fetch failed") }],
  ["Google failing", { token: () => ({ status: 503, body: { error: "backend_error" } }) }],
  ["YouTube's quota used up", { videos: () => ({ status: 403, body: { error: { errors: [{ reason: "quotaExceeded" }] } } }) }],
  ["YouTube failing", { videos: () => ({ status: 500, body: {} }) }],
  ["YouTube not answering", { videos: () => new TypeError("fetch failed") }],
]) {
  test(`${name} deletes nothing, and the channel is tried again tomorrow`, async () => {
    const { db, check, byId, connection, lines } = await setup({ rows: [row("d1", { publish_id: "aaaaaaaaaa1", url: watch("aaaaaaaaaa1"), error: "private" })] });
    const { restore } = google(answers);
    try {
      const counts = await check.run();
      assert.equal(counts.failed, 1);
      assert.equal(counts.revoked + counts.gone + counts.cleared, 0);
    } finally {
      restore();
    }
    assert.equal(db.tables.social_tokens.length, 1);
    assert.deepEqual([byId("d1").publish_id, byId("d1").url, byId("d1").error], ["aaaaaaaaaa1", watch("aaaaaaaaaa1"), "private"]);
    assert.equal(connection().handle, "old name");
    assert.ok(lines.some((line) => line.includes("tomorrow")));
  });
}

test("a channel disconnected without its videos cleared is cleared the next day; rows for no account stay", async () => {
  const { db, vault, check, byId } = await setup({
    rows: [
      row("o1", { connection_id: "gone1", publish_id: "aaaaaaaaaa1", url: watch("aaaaaaaaaa1") }),
      row("o2", { connection_id: "gone1", state: "failed", error: "YouTube refused the request." }),
      row("n1", { connection_id: "none", state: "failed", error: "Connect a YouTube channel first." }),
      row("t1", { connection_id: "tiktok1", platform: "tiktok", publish_id: "v_123", url: "https://tiktok.test/v" }),
    ],
  });
  await vault.remove(OWNER, "yt1");
  const { restore } = google();
  try {
    assert.equal((await check.run()).cleared, 2);
  } finally {
    restore();
  }
  assert.deepEqual([byId("o1").publish_id, byId("o1").url, byId("o2").error], [null, null, null]);
  assert.equal(byId("n1").error, "Connect a YouTube channel first.");
  assert.equal(byId("t1").publish_id, "v_123");
  assert.equal(db.tables.post_deliveries.length, 4, "no row is deleted");
});

test("Assistant chats holding YouTube's numbers go 30 days after their last message, others stay", async () => {
  const youtubeAnswer = (useId, platform = "youtube") => [
    { role: "user", content: [{ type: "text", text: "How did my videos do?" }] },
    { role: "assistant", content: [{ type: "tool_use", id: useId, name: "analytics", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: useId, content: JSON.stringify({ accounts: [{ platform, views: 10 }] }) }] },
  ];
  const otherTool = [
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "list_posts", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '{"platform":"youtube","title":"Hi"}' }] },
  ];
  const day = 24 * 60 * 60_000;
  const { db, check } = await setup();
  db.tables.agent_chats.push(
    { id: "c1", user_id: OWNER, messages: youtubeAnswer("u1"), updated_at: iso(T0 - 31 * day) },
    { id: "c2", user_id: OWNER, messages: youtubeAnswer("u2"), updated_at: iso(T0 - 29 * day) },
    { id: "c3", user_id: OWNER, messages: youtubeAnswer("u3", "tiktok"), updated_at: iso(T0 - 40 * day) },
    { id: "c4", user_id: OWNER, messages: otherTool, updated_at: iso(T0 - 40 * day) },
    { id: "c5", user_id: OWNER, messages: [{ role: "user", content: "a plain string" }], updated_at: iso(T0 - 40 * day) },
  );
  for (let index = 0; index < 45; index++) db.tables.agent_chats.push({ id: `d${String(index).padStart(2, "0")}`, user_id: OWNER, messages: [], updated_at: iso(T0 - 50 * day) });
  db.tables.agent_chats.push({ id: "z1", user_id: OWNER, messages: youtubeAnswer("u9"), updated_at: iso(T0 - 50 * day) });
  const { restore } = google();
  try {
    assert.equal((await check.run()).chats, 2);
  } finally {
    restore();
  }
  const left = db.tables.agent_chats.map((chat) => chat.id);
  assert.ok(!left.includes("c1") && !left.includes("z1"));
  for (const id of ["c2", "c3", "c4", "c5"]) assert.ok(left.includes(id), id);
  assert.equal(chatHoldsYouTube(youtubeAnswer("u1")), true);
  assert.equal(chatHoldsYouTube(otherTool), false);
});

test("chats are pruned even without YouTube set up on the server", async () => {
  const db = fakeDb();
  db.tables.agent_chats.push({
    id: "c1",
    user_id: OWNER,
    updated_at: iso(T0 - 31 * 24 * 60 * 60_000),
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "u1", name: "analytics", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "u1", content: '{"platform": "youtube"}' }] },
    ],
  });
  const check = createYouTubeCheck({ db, vault: {}, env: { clientId: "" }, now: () => T0, pause: 0, log: { log() {}, warn() {} } });
  assert.equal((await check.run()).chats, 1);
  assert.equal(db.tables.agent_chats.length, 0);
});

test("disconnecting a channel clears its videos' ids and links at once; other networks' rows stay", async () => {
  const db = fakeDb();
  db.tables.post_deliveries.push(
    row("d1", { publish_id: "aaaaaaaaaa1", url: watch("aaaaaaaaaa1") }),
    row("d2", { state: "processing", publish_id: "bbbbbbbbbb2" }),
    row("t1", { connection_id: "tt1", platform: "tiktok", publish_id: "v_1" }),
  );
  const vault = createVault({ db, key: KEY, env: {} });
  await vault.put(OWNER, "yt1", "youtube", { channelId: "UC1", accessToken: "ya29.a", refreshToken: "1//r", expiresAt: T0 * 2, scope: "s" });
  await vault.put(OWNER, "tt1", "tiktok", { openId: "o", accessToken: "act.a", refreshToken: "rft.r", expiresAt: T0 * 2, scope: "s" });
  const api = createApi({
    env: { tiktok: { clientKey: "k", clientSecret: "s" } },
    vault,
    worker: {},
    kick: () => undefined,
    users: { from: async (req) => ({ id: req.headers.authorization.slice(7) }), access: async () => null },
    limits: { limitFor: async () => 40 },
    db,
  });
  const forget = async (connectionId) => {
    const req = Object.assign(new Readable({ read() {} }), { method: "POST", headers: { authorization: `Bearer ${OWNER}` } });
    req.push(JSON.stringify({ connectionId }));
    req.push(null);
    let status = 0;
    const res = { writableEnded: false, writeHead: (code) => (status = code), end: () => undefined };
    await api(req, res, "/api/publisher/login/forget");
    return status;
  };
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  try {
    assert.equal(await forget("yt1"), 200);
    assert.equal(await forget("tt1"), 200);
  } finally {
    globalThis.fetch = original;
  }
  const byId = (id) => db.tables.post_deliveries.find((item) => item.id === id);
  assert.deepEqual([byId("d1").publish_id, byId("d1").url, byId("d1").state], [null, null, "sent"]);
  assert.equal(byId("d2").publish_id, "bbbbbbbbbb2", "a send still going is left to fail on its own");
  assert.equal(byId("t1").publish_id, "v_1");
  assert.deepEqual(await vault.list(OWNER), []);
});

test("the queries the check makes, as PostgREST gets them", async () => {
  const calls = [];
  const db = createDb({
    url: "https://sb.test",
    serviceKey: "service",
    fetch: async (url, init) => {
      calls.push({ url: decodeURIComponent(url), method: init.method, body: init.body });
      return new Response(init.method === "PATCH" ? "[]" : "[]", { status: 200 });
    },
  });
  await db.youtubeHeld("id-5", 500);
  assert.equal(await db.replaceAccountState(OWNER, "r1", { revision: "r2" }, "2026-11-20T03:00:00.000Z"), false);
  await db.oldChats("2026-10-21T03:00:00.000Z", "", 20);
  await db.deleteOldChats(["c1", "c2"], "2026-10-21T03:00:00.000Z");
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url.replace("https://sb.test/rest/v1/", "")}`),
    [
      "GET post_deliveries?select=id,user_id,connection_id,state,publish_id,url,error,updated_at&platform=eq.youtube&connection_id=neq.none&state=in.(sent,failed)&or=(publish_id.not.is.null,url.not.is.null,error.not.is.null)&id=gt.id-5&order=id.asc&limit=500",
      `PATCH account_state?select=user_id&user_id=eq.${OWNER}&payload->>revision=eq.r1`,
      "GET agent_chats?select=id,messages&updated_at=lt.2026-10-21T03:00:00.000Z&order=id.asc&limit=20",
      "DELETE agent_chats?id=in.(c1,c2)&updated_at=lt.2026-10-21T03:00:00.000Z",
    ],
  );
  assert.equal(JSON.parse(calls[1].body).payload.revision, "r2");
});
