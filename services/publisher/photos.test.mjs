import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

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

async function setup(stored) {
  let clock = T0;
  const media = {
    postFile: async (userId, id) => (userId === "u1" && stored[id] ? { id, key: `posts/u1/${id}`, ...stored[id].file } : null),
    bytes: async (key) => stored[key.split("/").pop()].bytes,
  };
  const photos = createPhotos({ key: "k".repeat(64), publicUrl: "https://plan.video", media, now: () => clock });
  return { photos, advance: (ms) => (clock += ms) };
}

const picture = async (width, height, format = "png") => {
  const bytes = await sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } })[format]().toBuffer();
  return { bytes, file: { size: bytes.length, type: `image/${format}`, kind: "image" } };
};

test("a photo link serves the post's picture as a JPEG of 1080p at most, until it runs out", async () => {
  const { photos, advance } = await setup({ p1_2: await picture(3000, 2000) });
  const link = photos.link("u1", "p1_2");
  assert.match(link, /^https:\/\/plan\.video\/api\/publisher\/photo\/u1\/p1_2\/\d+\/[\w-]+\.jpg$/);
  const path = new URL(link).pathname;

  const res = response();
  await photos.serve({ method: "GET" }, res, path);
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "image/jpeg");
  const meta = await sharp(res.body).metadata();
  assert.equal(meta.format, "jpeg");
  assert.deepEqual([meta.width, meta.height], [1620, 1080]);

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
  const { photos } = await setup({ p1: await picture(800, 1200, "jpeg"), p1_2: await picture(800, 1200, "jpeg") });
  const path = new URL(photos.link("u1", "p1")).pathname;
  for (const forged of [path.replace("/p1/", "/p1_2/"), path.replace("/u1/", "/u2/"), path.replace(/\/[\w-]+\.jpg$/, "/AAAA.jpg")]) {
    const res = response();
    await photos.serve({ method: "GET" }, res, forged);
    assert.equal(res.status, 404, forged);
  }
  const res = response();
  await photos.serve({ method: "GET" }, res, path);
  assert.equal(res.status, 200);
  const meta = await sharp(res.body).metadata();
  assert.deepEqual([meta.width, meta.height], [800, 1200]);
});

test("a photo link serves pictures only", async () => {
  const { photos } = await setup({ p1: { bytes: Buffer.from("video"), file: { size: 5, type: "video/mp4", kind: "video" } } });
  const res = response();
  await photos.serve({ method: "GET" }, res, new URL(photos.link("u1", "p1")).pathname);
  assert.equal(res.status, 404);
});

test("a feed link cuts a picture to the shapes Instagram's feed takes, from its middle", async () => {
  const { photos } = await setup({
    tall: await picture(1170, 2532),
    wide: await picture(3000, 1000, "jpeg"),
    square: await picture(1080, 1080, "jpeg"),
    big: await picture(4000, 3000, "jpeg"),
  });
  const shapes = {};
  for (const id of ["tall", "wide", "square", "big"]) {
    const link = photos.feedLink("u1", id);
    assert.match(link, /^https:\/\/plan\.video\/api\/publisher\/photo\/feed\/u1\/\w+\/\d+\/[\w-]+\.jpg$/);
    const res = response();
    await photos.serve({ method: "GET" }, res, new URL(link).pathname);
    assert.equal(res.status, 200, id);
    assert.equal(res.headers["Content-Type"], "image/jpeg");
    const meta = await sharp(res.body).metadata();
    shapes[id] = [meta.width, meta.height];
    const ratio = meta.width / meta.height;
    assert.ok(ratio >= 0.8 && ratio <= 1.91, `${id} is ${meta.width}x${meta.height}`);
  }
  assert.deepEqual(shapes.tall, [1170, 1460]);
  assert.deepEqual(shapes.wide, [1440, 758]);
  assert.deepEqual(shapes.square, [1080, 1080]);
  assert.deepEqual(shapes.big, [1440, 1080]);
});

test("a feed link turns a sideways photo upright before cutting it, and keeps a long panorama 1440 wide", async () => {
  // Stored 3000x1000 but marked as lying on its side, so it's 1000x3000 upright.
  const sideways = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 30, g: 90, b: 200 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const panorama = await picture(16000, 2000, "jpeg");
  const { photos } = await setup({ sideways: { bytes: sideways, file: { size: sideways.length, type: "image/jpeg", kind: "image" } }, panorama });
  const shapes = {};
  for (const id of ["sideways", "panorama"]) {
    const res = response();
    await photos.serve({ method: "GET" }, res, new URL(photos.feedLink("u1", id)).pathname);
    assert.equal(res.status, 200, id);
    const meta = await sharp(res.body).metadata();
    shapes[id] = [meta.width, meta.height];
  }
  assert.deepEqual(shapes.sideways, [1000, 1248]);
  assert.deepEqual(shapes.panorama, [1440, 758]);
});

test("a picture with more pixels than any camera makes isn't worked on", async () => {
  // About 100 MP, yet a few hundred KB: one colour packs small.
  const bytes = await sharp({ create: { width: 10_001, height: 10_000, channels: 3, background: { r: 30, g: 90, b: 200 } } })
    .jpeg({ quality: 50 })
    .toBuffer();
  const { photos } = await setup({ huge: { bytes, file: { size: bytes.length, type: "image/jpeg", kind: "image" } } });
  for (const link of [photos.link("u1", "huge"), photos.feedLink("u1", "huge")]) {
    await assert.rejects(photos.serve({ method: "GET" }, response(), new URL(link).pathname), /pixel limit/);
  }
});

test("a feed link and a plain photo link can't be swapped for each other", async () => {
  const { photos } = await setup({ p1: await picture(800, 2000, "jpeg") });
  const feed = new URL(photos.feedLink("u1", "p1")).pathname;
  const plain = new URL(photos.link("u1", "p1")).pathname;
  for (const forged of [feed.replace("/photo/feed/", "/photo/"), plain.replace("/photo/", "/photo/feed/")]) {
    const res = response();
    await photos.serve({ method: "GET" }, res, forged);
    assert.equal(res.status, 404, forged);
  }
  const res = response();
  await photos.serve({ method: "GET" }, res, plain);
  const meta = await sharp(res.body).metadata();
  assert.deepEqual([meta.width, meta.height], [768, 1920], "a Story's picture stays whole");
});
