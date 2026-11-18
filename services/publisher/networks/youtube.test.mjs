import assert from "node:assert/strict";
import test from "node:test";

import { PublishError } from "../errors.mjs";
import { youtube } from "./youtube.mjs";

const VIDEO = { id: "p1", key: "posts/u1/p1", size: 100, type: "video/mp4", kind: "video" };
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc";
const media = { bytes: async (_key, from, to) => Buffer.alloc(to - from + 1) };

async function upload(asked, kept) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "POST") return new Response("{}", { status: 200, headers: { location: UPLOAD } });
    return new Response(JSON.stringify({ id: "vid1", status: { privacyStatus: kept, uploadStatus: "uploaded" } }), { status: 200 });
  };
  try {
    return await youtube.send({
      post: { id: "p1", title: "Hi", platforms: ["youtube"], youtube: { title: "Hi", privacy: asked } },
      session: { accessToken: "a" },
      files: [VIDEO],
      media,
      delivery: { user_id: "u1" },
      progress: async () => {},
    });
  } finally {
    globalThis.fetch = original;
  }
}

test("a video YouTube kept private, though it was meant to be public, says so", async () => {
  const result = await upload("public", "private");
  assert.equal(result.state, "sent");
  assert.equal(result.note, "private");
  assert.equal((await upload(undefined, "private")).note, "private");
  assert.equal((await upload("unlisted", "private")).note, "private");
});

test("a video that went out as asked has no note", async () => {
  assert.equal((await upload("public", "public")).note, undefined);
  assert.equal((await upload("private", "private")).note, undefined);
  assert.equal((await upload("unlisted", "unlisted")).note, undefined);
});

test("starting an upload is tried again when YouTube is busy, and not when it turns the video down", async (t) => {
  const starting = () => youtube.send({ post: { id: "p1", title: "Hi", platforms: ["youtube"], youtube: { title: "Hi", privacy: "public" } }, session: { accessToken: "a" }, files: [VIDEO], media, delivery: { user_id: "u1" }, progress: async () => {} });
  for (const status of [500, 503, 429]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "Backend Error", errors: [{ reason: "backendError" }] } }, { status }), { times: 1 });
    await assert.rejects(starting(), (error) => error instanceof PublishError && error.retry === true, `after ${status}`);
  }
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "Too long", errors: [{ reason: "invalidTitle" }] } }, { status: 400 }), { times: 1 });
  await assert.rejects(starting(), (error) => error instanceof PublishError && error.retry === false);
});
