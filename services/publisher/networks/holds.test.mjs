import assert from "node:assert/strict";
import test from "node:test";

import { createBluesky } from "./bluesky.mjs";
import { createFacebook } from "./facebook.mjs";
import { createInstagram } from "./instagram.mjs";
import { linkedin } from "./linkedin.mjs";
import { createThreads } from "./threads.mjs";
import { createTikTok } from "./tiktok.mjs";
import { createX } from "./x.mjs";
import { youtube } from "./youtube.mjs";

const MB = 1024 * 1024;
const video = (size) => ({ id: "v", key: "posts/u1/v", size, type: "video/mp4", kind: "video" });
const picture = (id, size) => ({ id, key: `posts/u1/${id}`, size, type: "image/jpeg", kind: "image" });

test("Bluesky holds each file it sends whole, and a copy", () => {
  const bluesky = createBluesky();
  assert.equal(bluesky.holds([]), 0);
  assert.equal(bluesky.holds([video(90 * MB)]), 180 * MB);
  assert.equal(bluesky.holds([picture("a", 2 * MB), video(10 * MB)]), 20 * MB);
  assert.equal(bluesky.holds([picture("a", 500_000), picture("b", 3 * MB)]), 1_000_000 + 6 * MB);
  assert.equal(bluesky.holds(["a", "b", "c", "d", "e"].map((id) => picture(id, 100))), 800);
});

test("TikTok holds a video's biggest piece; pictures it pulls itself", () => {
  const tiktok = createTikTok();
  assert.equal(tiktok.holds([]), 0);
  assert.equal(tiktok.holds([picture("a", 5 * MB)]), 0);
  // Up to 64 MB goes in one piece.
  assert.equal(tiktok.holds([video(40 * MB)]), 80 * MB);
  // Over that, 10 MB pieces, the last taking what's left over.
  assert.equal(tiktok.holds([video(105 * MB)]), 30 * MB);
  assert.equal(tiktok.holds([video(10_000 * MB)]), 0);
});

test("YouTube and X hold a piece at a time, and nothing without a file", () => {
  assert.equal(youtube.holds([video(2_000 * MB)]), 16 * MB);
  assert.equal(youtube.holds([]), 0);
  const x = createX({ limits: { xAllowed: async () => {}, countX: async () => {} } });
  assert.equal(x.holds([video(400 * MB)]), 15 * MB);
  assert.equal(x.holds([]), 0);
});

test("networks that pull files by link, or stream them, hold nothing to speak of", () => {
  const photos = { link: () => "", feedLink: () => "", videoLink: () => "" };
  for (const network of [linkedin, createInstagram({ photos }), createFacebook({ photos }), createThreads({ photos })]) {
    assert.equal(network.holds, undefined);
  }
});
