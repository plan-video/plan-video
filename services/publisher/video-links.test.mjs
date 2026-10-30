import { test } from "node:test";
import assert from "node:assert/strict";

import { VIDEO_PATH, createPhotos } from "./photos.mjs";

const KEY = Buffer.alloc(32, 9).toString("base64");
const BYTES = Buffer.from("0123456789abcdef");

function setup(now = () => Date.parse("2026-10-19T12:00:00Z")) {
  const asked = [];
  const media = {
    postFile: async (user, id) => (id === "clip" ? { id, key: `posts/${user}/clip`, size: BYTES.length, type: "video/mp4", kind: "video" } : id === "pic" ? { id, key: "k", size: 4, type: "image/png", kind: "image" } : null),
    stream: async (_key, range) => {
      asked.push(range);
      const part = range ? BYTES.subarray(range[0], range[1] + 1) : BYTES;
      return new ReadableStream({ start: (controller) => (controller.enqueue(new Uint8Array(part)), controller.close()) });
    },
  };
  return { photos: createPhotos({ key: KEY, publicUrl: "https://plan.video", media, now }), asked };
}

async function fetchVideo(photos, path, { method = "GET", range } = {}) {
  const { PassThrough } = await import("node:stream");
  const res = new PassThrough();
  let status = 0;
  let headers = {};
  res.writeHead = (code, values) => ((status = code), (headers = values ?? {}), res);
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve) => res.on("finish", resolve));
  await photos.serveVideo({ method, headers: range ? { range } : {} }, res, path);
  await finished;
  return { status, headers, body: Buffer.concat(chunks).toString() };
}

const pathOf = (link) => new URL(link).pathname;

test("a video link serves the file as it is, whole or in part", async () => {
  const { photos, asked } = setup();
  const path = pathOf(photos.videoLink("u1", "clip"));
  assert.ok(path.startsWith(VIDEO_PATH) && path.endsWith(".mp4"));
  const whole = await fetchVideo(photos, path);
  assert.equal(whole.status, 200);
  assert.equal(whole.body, "0123456789abcdef");
  assert.equal(whole.headers["Content-Type"], "video/mp4");
  assert.equal(whole.headers["Accept-Ranges"], "bytes");
  const part = await fetchVideo(photos, path, { range: "bytes=4-7" });
  assert.equal(part.status, 206);
  assert.equal(part.body, "4567");
  assert.equal(part.headers["Content-Range"], "bytes 4-7/16");
  const tail = await fetchVideo(photos, path, { range: "bytes=-3" });
  assert.equal(tail.body, "def");
  assert.deepEqual(asked, [undefined, [4, 7], [13, 15]]);
  assert.equal((await fetchVideo(photos, path, { range: "bytes=40-50" })).status, 416);
  const head = await fetchVideo(photos, path, { method: "HEAD" });
  assert.equal(head.headers["Content-Length"], 16);
  assert.equal(head.body, "");
});

test("a video link is refused when it's for another file, a picture, forged, or run out", async () => {
  let now = Date.parse("2026-10-19T12:00:00Z");
  const { photos } = setup(() => now);
  const link = pathOf(photos.videoLink("u1", "clip"));
  assert.equal((await fetchVideo(photos, link.replace("/clip/", "/other/"))).status, 404);
  assert.equal((await fetchVideo(photos, pathOf(photos.videoLink("u1", "pic")))).status, 404);
  const picture = pathOf(photos.link("u1", "clip")).replace("/photo/", "/video/").replace(/\.jpg$/, ".mp4");
  assert.equal((await fetchVideo(photos, picture)).status, 404);
  assert.equal((await fetchVideo(photos, link.replace(/\/[^/]+\.mp4$/, "/forged.mp4"))).status, 404);
  now += 25 * 60 * 60_000;
  assert.equal((await fetchVideo(photos, link)).status, 404);
});
