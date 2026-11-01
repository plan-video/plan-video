import assert from "node:assert/strict";
import test from "node:test";

import { PublishError } from "./errors.mjs";
import { createPhotos } from "./photos.mjs";

const T0 = Date.parse("2026-10-12T16:00:00Z");

function response() {
  return {
    status: 0,
    headers: {},
    body: null,
    headersSent: false,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(body) {
      this.body = body ?? null;
    },
  };
}

async function setup(stored, maker = { make: async (shape, load) => Buffer.from(`${shape}:${await load()}`) }) {
  let clock = T0;
  const media = {
    postFile: async (userId, id) => (userId === "u1" && stored[id] ? { id, key: `posts/u1/${id}`, ...stored[id].file } : null),
    bytes: async (key) => stored[key.split("/").pop()].bytes,
  };
  const photos = createPhotos({ key: "k".repeat(64), publicUrl: "https://plan.video", media, maker, now: () => clock });
  return { photos, advance: (ms) => (clock += ms) };
}

const picture = (text = "picture") => ({ bytes: Buffer.from(text), file: { size: text.length, type: "image/jpeg", kind: "image" } });

test("a photo link serves the post's picture as a JPEG made for it, until it runs out", async () => {
  const { photos, advance } = await setup({ p1_2: picture() });
  const link = photos.link("u1", "p1_2");
  assert.match(link, /^https:\/\/plan\.video\/api\/publisher\/photo\/u1\/p1_2\/\d+\/[\w-]+\.jpg$/);
  const path = new URL(link).pathname;

  const res = response();
  await photos.serve({ method: "GET" }, res, path);
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "image/jpeg");
  assert.equal(String(res.body), "tiktok:picture");

  const head = response();
  await photos.serve({ method: "HEAD" }, head, path);
  assert.equal(head.status, 200);
  assert.equal(head.body, null);

  advance(3 * 60 * 60_000);
  const late = response();
  await photos.serve({ method: "GET" }, late, path);
  assert.equal(late.status, 404);
});

test("a photo link can't be turned into one for another file or account", async () => {
  const { photos } = await setup({ p1: picture("one"), p1_2: picture("two") });
  const path = new URL(photos.link("u1", "p1")).pathname;
  for (const forged of [path.replace("/p1/", "/p1_2/"), path.replace("/u1/", "/u2/"), path.replace(/\/[\w-]+\.jpg$/, "/AAAA.jpg")]) {
    const res = response();
    await photos.serve({ method: "GET" }, res, forged);
    assert.equal(res.status, 404, forged);
  }
  const res = response();
  await photos.serve({ method: "GET" }, res, path);
  assert.equal(res.status, 200);
  assert.equal(String(res.body), "tiktok:one");
});

test("a photo link serves pictures only", async () => {
  const { photos } = await setup({ p1: { bytes: Buffer.from("video"), file: { size: 5, type: "video/mp4", kind: "video" } } });
  const res = response();
  await photos.serve({ method: "GET" }, res, new URL(photos.link("u1", "p1")).pathname);
  assert.equal(res.status, 404);
});

test("a picture that can't be made reaches the server as an error, not as a link that was never there", async () => {
  const refusal = new PublishError("plan.video couldn't prepare a picture just now. Trying again soon.", { retry: true });
  const { photos } = await setup({ p1: picture() }, { make: async () => { throw refusal; } });
  const res = response();
  await assert.rejects(photos.serve({ method: "GET" }, res, new URL(photos.link("u1", "p1")).pathname), (error) => error === refusal);
  assert.equal(res.status, 0, "nothing is answered here: server.mjs makes it a 503");
});

test("a feed link and a plain photo link can't be swapped for each other", async () => {
  const { photos } = await setup({ p1: picture() });
  const feed = new URL(photos.feedLink("u1", "p1")).pathname;
  const plain = new URL(photos.link("u1", "p1")).pathname;
  for (const forged of [feed.replace("/photo/feed/", "/photo/"), plain.replace("/photo/", "/photo/feed/")]) {
    const res = response();
    await photos.serve({ method: "GET" }, res, forged);
    assert.equal(res.status, 404, forged);
  }
  const res = response();
  await photos.serve({ method: "GET" }, res, plain);
  assert.equal(String(res.body), "tiktok:picture", "a Story's picture stays whole");
  const cut = response();
  await photos.serve({ method: "GET" }, cut, feed);
  assert.equal(String(cut.body), "feed:picture");
});
