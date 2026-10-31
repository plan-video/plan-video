import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CopyObjectCommand, DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const MEMBER = "0f0f0f0f-0000-4000-8000-000000000003";

const dir = mkdtempSync(join(tmpdir(), "storage-quota-"));
writeFileSync(
  join(dir, "r2.env"),
  ["R2_ACCOUNT_ID=a", "R2_ACCESS_KEY_ID=b", "R2_SECRET_ACCESS_KEY=c", "R2_BUCKET=d", "SUPABASE_URL=https://sb.test", "SUPABASE_ANON_KEY=anon", "REQUIRE_INVITE=false"].join("\n"),
);
process.env.STORAGE_ENV = join(dir, "r2.env");

const { ROUTES, Refused, s3, server } = await import("./server.mjs");
const upload = ROUTES["POST /api/storage/upload-url"];
const settle = ROUTES["POST /api/storage/settle"];
const remove = ROUTES["POST /api/storage/delete"];
const usage = ROUTES["GET /api/storage/usage"];

const MiB = 1024 * 1024;
const GB = 1000 ** 3;
const HOUR = 60 * 60 * 1000;

// Every bucket call waits a moment, so calls made together interleave the way they do against R2.

/** key → { size, at } */
const bucket = new Map();
let random = 1;
const pause = async () => {
  for (let hops = (random = (random * 16807) % 2147483647) % 5; hops > 0; hops--) await new Promise((resolve) => setImmediate(resolve));
};
const missing = () => Object.assign(new Error("NotFound"), { $metadata: { httpStatusCode: 404 } });

s3.send = async (command) => {
  await pause();
  const input = command.input;
  if (command instanceof HeadObjectCommand) {
    const found = bucket.get(input.Key);
    if (!found) throw missing();
    return { ContentLength: found.size, LastModified: new Date(found.at) };
  }
  if (command instanceof ListObjectsV2Command) {
    const Contents = [...bucket].filter(([key]) => key.startsWith(input.Prefix)).map(([Key, { size, at }]) => ({ Key, Size: size, LastModified: new Date(at) }));
    return { Contents, IsTruncated: false };
  }
  if (command instanceof CopyObjectCommand) {
    const found = bucket.get(input.CopySource.slice(input.Bucket.length + 1));
    if (!found) throw missing();
    bucket.set(input.Key, { size: found.size, at: Date.now() });
    return {};
  }
  if (command instanceof DeleteObjectsCommand) {
    for (const { Key } of input.Delete.Objects) bucket.delete(Key);
    return {};
  }
  throw new Error(`No fake for ${command.constructor.name}`);
};

const land = (signed, size) => bucket.set(signed.key, { size, at: Date.now() });

const stored = (key, size) => bucket.set(key, { size, at: Date.now() - 30 * 24 * HOUR });

/** `${owner}/${post}` of posts with a delivery in `sent`. */
const delivered = new Set();
/** The tokens and owners the deliveries were asked about with. */
const askedDeliveries = [];
let deliveriesDown = false;
const original = globalThis.fetch;

before(() => {
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).startsWith("https://sb.test/")) return original(url, init);
    const token = (init.headers?.Authorization ?? "").slice(7);
    const address = new URL(url);
    if (address.pathname === "/auth/v1/user") return Response.json({ id: token === "member-token" ? MEMBER : OWNER });
    if (address.pathname === "/rest/v1/user_data") return Response.json([{ access_level: 1 }]);
    if (address.pathname === "/rest/v1/rpc/team_access") {
      const { owner, workspace } = JSON.parse(init.body);
      return Response.json(token === "member-token" && owner === OWNER && workspace === "brand" ? { role: "member", level: 1 } : null);
    }
    if (address.pathname === "/rest/v1/rpc/team_files_allowed") return Response.json(true);
    if (address.pathname === "/rest/v1/post_deliveries") {
      if (deliveriesDown) return new Response("{}", { status: 500 });
      const params = address.searchParams;
      assert.equal(params.get("state"), "eq.sent");
      const owner = params.get("user_id").slice(3);
      const posts = params.get("post_id").slice(4, -1).split(",");
      askedDeliveries.push({ token, owner, posts });
      return Response.json(posts.filter((post) => delivered.has(`${owner}/${post}`)).map((post_id) => ({ post_id })));
    }
    return new Response("{}", { status: 404 });
  };
});

after(() => {
  globalThis.fetch = original;
  server.close();
});

const req = (token = "owner-token") => ({ headers: { authorization: `Bearer ${token}` } });
let users = 0;
/** So one test's files and holds don't reach another's. */
const someone = (plan = "free") => ({ id: `user-${++users}`, plan });
const video = (user, id, size, extra = {}) => upload(user, { purpose: "posts", id, contentType: "video/mp4", size, ...extra }, req());
const status = (promise) => promise.then(() => 200, (error) => (error instanceof Refused ? error.status : Promise.reject(error)));

/** Has the signer count the account from the bucket again, as any delete does. */
const recount = (user) => remove(user, { purpose: "media", ids: ["nothing"] });

/** Moves this process's clock on, as far as the signer can tell. */
function later(ms) {
  const now = Date.now;
  Date.now = () => now() + ms;
  return () => (Date.now = now);
}

test("the link signs the file's size, so R2 takes no other size than the one held", async () => {
  const signed = await video(someone(), "clip", 1234);
  const link = new URL(signed.uploadUrl);
  assert.deepEqual(link.searchParams.get("X-Amz-SignedHeaders").split(";").sort(), ["content-length", "content-type", "host"]);
  assert.equal(link.searchParams.get("X-Amz-Expires"), "900");
});

test("20 uploads asked for at once: only those that fit are signed", async () => {
  const user = someone();
  const size = 400 * MiB;
  const fits = Math.floor((5 * GB) / size);
  const answers = await Promise.all(Array.from({ length: 20 }, (_, index) => status(video(user, `fill-${index}`, size))));
  assert.equal(answers.filter((answer) => answer === 200).length, fits);
  assert.equal(answers.filter((answer) => answer === 413).length, 20 - fits);
  assert.equal((await usage(user)).used, fits * size);
});

test("a carousel that fits goes through whole, all at once", async () => {
  const user = someone();
  stored(`media/${user.id}/library`, 5 * GB - 100 * MiB);
  const pictures = await Promise.all(
    Array.from({ length: 10 }, (_, index) => upload(user, { purpose: "posts", id: `post1_${index}abc`, contentType: "image/jpeg", size: 8 * MiB }, req())),
  );
  assert.equal(pictures.length, 10);
  assert.equal((await usage(user)).used, 5 * GB - 100 * MiB + 80 * MiB);
  assert.equal(await status(video(user, "post2", 30 * MiB)), 413);
});

test("deleting nothing, or the cache running out, doesn't give back room held by links not used yet", async () => {
  const user = someone();
  const size = 400 * MiB;
  const fits = Math.floor((5 * GB) / size);
  for (let index = 0; index < fits; index++) await video(user, `held-${index}`, size);
  assert.equal(await status(video(user, "one-more", size)), 413);
  // Each of these makes the signer list the bucket again, which has none of the held files yet.
  await remove(user, { purpose: "media", ids: [] });
  assert.equal(await status(video(user, "one-more", size)), 413);
  await remove(user, { purpose: "posts", ids: [] });
  assert.equal(await status(video(user, "one-more", size)), 413);
  const restore = later(11 * 60 * 1000);
  try {
    assert.equal(await status(video(user, "one-more", size)), 413);
  } finally {
    restore();
  }
});

test("a held file counts once when it lands, and stops being held once its link is long dead", async () => {
  const user = someone();
  const size = 400 * MiB;
  stored(`media/${user.id}/library`, 5 * GB - 2 * size);
  const first = await video(user, "a", size);
  await video(user, "b", size);
  // Two held, nothing landed: a third doesn't fit.
  assert.equal(await status(video(user, "c", size)), 413);

  // One lands; counted again from the bucket, it isn't counted twice.
  land(first, size);
  await recount(user);
  assert.equal((await usage(user)).used, 5 * GB);

  // Deleting the file doesn't let go of its hold: the link could send it again.
  await remove(user, { purpose: "posts", ids: ["a"] });
  assert.equal((await usage(user)).used, 5 * GB);
  assert.equal(await status(video(user, "c", size)), 413);

  // Long after the links ran out, only what's in the bucket counts.
  const restore = later(HOUR);
  try {
    assert.equal((await usage(user)).used, 5 * GB - 2 * size);
    assert.equal(await status(video(user, "c", size)), 200);
  } finally {
    restore();
  }
});

test("a file that landed and outlived its hold is still counted", async () => {
  const user = someone();
  const size = 400 * MiB;
  stored(`media/${user.id}/library`, 5 * GB - size);
  const signed = await video(user, "kept", size);
  land(signed, size);
  const restore = later(HOUR);
  try {
    assert.equal((await usage(user)).used, 5 * GB);
    assert.equal(await status(video(user, "more", 1)), 413);
  } finally {
    restore();
  }
});

test("renewing a file in place on a nearly full plan isn't counted twice", async () => {
  const user = someone();
  const size = 400 * MiB;
  stored(`posts/${user.id}/old`, size);
  stored(`media/${user.id}/library`, 5 * GB - size - 80 * MiB);
  assert.equal(await status(video(user, "old", size)), 200);
  assert.equal(await status(video(user, "old", size)), 200);
  assert.equal((await usage(user)).used, 5 * GB - 80 * MiB);
  // Signing the same key again for a larger file counts only the difference.
  assert.equal(await status(video(user, "old", size + 50 * MiB)), 200);
  assert.equal(await status(video(user, "old", size + 100 * MiB)), 413);
});

test("a file sent: true of a post that didn't go out is stored as waiting, on the plan", async () => {
  const user = someone();
  const signed = await video(user, "draft_abc123", 1000, { sent: true });
  assert.equal(signed.key, `posts/${user.id}/draft_abc123`);
  assert.equal((await usage(user)).used, 1000);
  assert.deepEqual(askedDeliveries.at(-1), { token: "owner-token", owner: user.id, posts: ["draft_abc123", "draft"] });

  // On a full plan it's refused like any waiting file, not let into sent/.
  stored(`media/${user.id}/library`, 5 * GB);
  await recount(user);
  assert.equal(await status(video(user, "draft_def456", 1000, { sent: true })), 413);
});

test("a file sent: true of a post the publisher sent goes to sent/, off the plan", async () => {
  const user = someone();
  delivered.add(`${user.id}/went`);
  const own = await video(user, "went", 1000, { sent: true });
  const extra = await video(user, "went_abc123", 2000, { sent: true });
  assert.equal(own.key, `sent/${user.id}/went`);
  assert.equal(extra.key, `sent/${user.id}/went_abc123`);
  assert.equal((await usage(user)).used, 0);
  // Another post named like a file of this one isn't one of its files.
  assert.equal((await video(user, "went_x_abc", 1000, { sent: true })).key, `posts/${user.id}/went_x_abc`);
});

test("settle moves only the files of posts that went out", async () => {
  const user = someone();
  delivered.add(`${user.id}/out`);
  stored(`posts/${user.id}/out_abc123`, 500);
  stored(`posts/${user.id}/waiting_abc123`, 700);
  const result = await settle(
    user,
    {
      files: [
        { id: "out_abc123", size: 500 },
        { id: "waiting_abc123", size: 700 },
        { id: "nothing", size: 5 },
      ],
    },
    req(),
  );
  assert.deepEqual(result, { sent: [{ id: "out_abc123", key: `sent/${user.id}/out_abc123` }], missing: ["nothing"], full: [], unsent: ["waiting_abc123"] });
  assert.ok(bucket.has(`sent/${user.id}/out_abc123`) && !bucket.has(`posts/${user.id}/out_abc123`));
  assert.ok(bucket.has(`posts/${user.id}/waiting_abc123`) && !bucket.has(`sent/${user.id}/waiting_abc123`));
  assert.equal((await usage(user)).used, 700);
});

test("when Supabase can't say whether a post went out, nothing goes to sent/", async () => {
  const user = someone();
  delivered.add(`${user.id}/out`);
  stored(`posts/${user.id}/out`, 500);
  deliveriesDown = true;
  try {
    assert.equal(await status(settle(user, { files: [{ id: "out", size: 500 }] }, req())), 503);
    assert.equal(await status(video(user, "out", 500, { sent: true })), 503);
  } finally {
    deliveriesDown = false;
  }
  assert.ok(bucket.has(`posts/${user.id}/out`));
});

test("someone in a shared workspace uploads, and settles, on its owner's plan", async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const ask = (path, body, token = "member-token") =>
    original(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (response) => ({ status: response.status, ...(await response.json()) }));
  const team = { owner: OWNER, workspace: "brand" };

  // A carousel, all at once, from the member and the owner together: one plan, one queue.
  stored(`media/${OWNER}/library`, 5 * GB - 60 * MiB);
  const answers = await Promise.all([
    ...Array.from({ length: 5 }, (_, index) => ask("/api/storage/upload-url", { purpose: "posts", id: `team1_${index}abc`, contentType: "image/png", size: 8 * MiB, team })),
    ...Array.from({ length: 5 }, (_, index) => ask("/api/storage/upload-url", { purpose: "posts", id: `own1_${index}abc`, contentType: "image/png", size: 8 * MiB }, "owner-token")),
  ]);
  assert.deepEqual(answers.map((answer) => answer.status).sort(), [200, 200, 200, 200, 200, 200, 200, 413, 413, 413]);
  assert.ok(answers.filter((answer) => answer.status === 200).every((answer) => answer.key.startsWith(`posts/${OWNER}/`)));

  // A post of the workspace that went out: asked with the member's own token, about the owner's posts.
  delivered.add(`${OWNER}/teampost`);
  const sent = await ask("/api/storage/upload-url", { purpose: "posts", id: "teampost_abc123", contentType: "video/mp4", size: 1000, sent: true, team });
  assert.equal(sent.status, 200);
  assert.equal(sent.key, `sent/${OWNER}/teampost_abc123`);
  assert.deepEqual(askedDeliveries.at(-1), { token: "member-token", owner: OWNER, posts: ["teampost_abc123", "teampost"] });

  stored(`posts/${OWNER}/teampost_def456`, 900);
  stored(`posts/${OWNER}/teamdraft`, 800);
  const settled = await ask("/api/storage/settle", { files: [{ id: "teampost_def456", size: 900 }, { id: "teamdraft", size: 800 }], team });
  assert.equal(settled.status, 200);
  assert.deepEqual(settled.sent, [{ id: "teampost_def456", key: `sent/${OWNER}/teampost_def456` }]);
  assert.deepEqual(settled.unsent, ["teamdraft"]);
});
