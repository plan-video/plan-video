import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CopyObjectCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const OWNER = "0f0f0f0f-0000-4000-8000-000000000001";
const GB = 1000 ** 3;

const dir = mkdtempSync(join(tmpdir(), "storage-agent-"));
writeFileSync(
  join(dir, "r2.env"),
  ["R2_ACCOUNT_ID=a", "R2_ACCESS_KEY_ID=b", "R2_SECRET_ACCESS_KEY=c", "R2_BUCKET=d", "SUPABASE_URL=https://sb.test", "SUPABASE_ANON_KEY=anon", "REQUIRE_INVITE=false"].join("\n"),
);
process.env.STORAGE_ENV = join(dir, "r2.env");

const { AGENT_ROUTES, s3, server } = await import("./server.mjs");
const copy = AGENT_ROUTES["POST /api/storage/agent-copy"];

const claims = (value) => `x.${Buffer.from(JSON.stringify(value)).toString("base64url")}.y`;
const CONNECTOR = claims({ sub: "00000000-0000-0000-0000-000000000000", client_id: "claude" });
const SIGN_IN = claims({ sub: OWNER });
const req = (token) => ({ headers: { authorization: `Bearer ${token}` } });

/** key → { size, type, at } */
const bucket = new Map();
const copied = [];
s3.send = async (command) => {
  const input = command.input;
  if (command instanceof HeadObjectCommand) {
    const found = bucket.get(input.Key);
    if (!found) throw Object.assign(new Error("NotFound"), { $metadata: { httpStatusCode: 404 } });
    return { ContentLength: found.size, ContentType: found.type, LastModified: new Date(found.at) };
  }
  if (command instanceof ListObjectsV2Command) {
    const Contents = [...bucket].filter(([key]) => key.startsWith(input.Prefix)).map(([Key, { size, at }]) => ({ Key, Size: size, LastModified: new Date(at) }));
    return { Contents, IsTruncated: false };
  }
  if (command instanceof CopyObjectCommand) {
    const from = input.CopySource.slice(input.Bucket.length + 1);
    copied.push({ from, to: input.Key, type: input.ContentType });
    bucket.set(input.Key, { ...bucket.get(from), at: Date.now() });
    return {};
  }
  throw new Error(`No fake for ${command.constructor.name}`);
};

/** What agent_copy_files answers, as the database would for this connector. */
let answer = () => Response.json({ level: 1 });
const asked = [];
const original = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith("https://sb.test/")) return original(url, init);
  assert.equal(new URL(url).pathname, "/rest/v1/rpc/agent_copy_files");
  asked.push({ token: init.headers.Authorization.slice(7), body: JSON.parse(init.body) });
  return answer();
};

after(() => {
  globalThis.fetch = original;
  server.close();
});

const day = 24 * 60 * 60 * 1000;
bucket.set(`media/${OWNER}/clip`, { size: 1000, type: "video/mp4", at: Date.now() - day });
bucket.set(`posts/${OWNER}/old_a`, { size: 500, type: "image/png", at: Date.now() - 2 * day });
bucket.set(`sent/${OWNER}/old_a`, { size: 500, type: "image/png", at: Date.now() - day });

test("copies library and post files onto the new post, inside the bucket, with their type", async () => {
  copied.length = 0;
  const result = await copy({ owner: OWNER, workspace: "default", copies: [{ from: "media/clip", to: "p1_a" }, { from: "posts/old_a", to: "p1_b" }] }, req(CONNECTOR));
  assert.deepEqual(result, { copied: 2 });
  // A sent post's newer copy, as the publisher reads it.
  assert.deepEqual(copied, [
    { from: `media/${OWNER}/clip`, to: `posts/${OWNER}/p1_a`, type: "video/mp4" },
    { from: `sent/${OWNER}/old_a`, to: `posts/${OWNER}/p1_b`, type: "image/png" },
  ]);
  assert.deepEqual(asked.at(-1), { token: CONNECTOR, body: { owner: OWNER, workspace: "default", sources: ["media/clip", "posts/old_a"], files: ["p1_a", "p1_b"] } });
});

test("takes only a connector's token, and copies nothing the database refuses", async () => {
  copied.length = 0;
  await assert.rejects(copy({ owner: OWNER, workspace: "default", copies: [{ from: "media/clip", to: "p2_a" }] }, req(SIGN_IN)), { status: 401 });
  answer = () => Response.json({ code: "42501", message: "You're not in this workspace." }, { status: 403 });
  await assert.rejects(copy({ owner: OWNER, workspace: "default", copies: [{ from: "media/clip", to: "p2_a" }] }, req(CONNECTOR)), { status: 403, message: "You're not in this workspace." });
  answer = () => Response.json({ code: "PGRST202", message: "Could not find the function" }, { status: 404 });
  await assert.rejects(copy({ owner: OWNER, workspace: "default", copies: [{ from: "media/clip", to: "p2_a" }] }, req(CONNECTOR)), { status: 404 });
  answer = () => new Response("down", { status: 500 });
  await assert.rejects(copy({ owner: OWNER, workspace: "default", copies: [{ from: "media/clip", to: "p2_a" }] }, req(CONNECTOR)), { status: 503 });
  assert.deepEqual(copied, []);
  answer = () => Response.json({ level: 1 });
});

test("a file gone from the bucket or past the plan's space is refused before any copy", async () => {
  copied.length = 0;
  await assert.rejects(copy({ owner: OWNER, workspace: "default", copies: [{ from: "media/clip", to: "p3_a" }, { from: "media/gone", to: "p3_b" }] }, req(CONNECTOR)), { status: 409 });
  bucket.set(`media/${OWNER}/huge`, { size: 400 * 1024 * 1024, type: "video/mp4", at: Date.now() - day });
  bucket.set(`projects/${OWNER}/x/big`, { size: 5 * GB - 500 * 1024 * 1024, type: "application/octet-stream", at: Date.now() - day });
  await assert.rejects(copy({ owner: OWNER, workspace: "default", copies: [{ from: "media/huge", to: "p3_c" }] }, req(CONNECTOR)), { status: 413 });
  assert.deepEqual(copied, []);
  answer = () => Response.json({ level: 2 });
  assert.deepEqual(await copy({ owner: OWNER, workspace: "default", copies: [{ from: "media/huge", to: "p3_c" }] }, req(CONNECTOR)), { copied: 1 });
  answer = () => Response.json({ level: 1 });
});

test("a malformed request is refused before the database is asked", async () => {
  const before = asked.length;
  await assert.rejects(copy({ owner: "nope", workspace: "default", copies: [{ from: "media/clip", to: "x" }] }, req(CONNECTOR)), { status: 400 });
  await assert.rejects(copy({ owner: OWNER, workspace: "default", copies: [] }, req(CONNECTOR)), { status: 400 });
  assert.equal(asked.length, before);
});
