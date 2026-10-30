import assert from "node:assert/strict";
import test from "node:test";

import { captionOf } from "./text.mjs";

test("a network's own words go out over the shared caption", () => {
  const post = { title: "launch-cut", description: "Shared words", captions: { x: "Words for X" } };
  assert.equal(captionOf(post, "x"), "Words for X");
  assert.equal(captionOf(post, "bluesky"), "Shared words");
});

test("blank own words give way to the shared caption", () => {
  assert.equal(captionOf({ title: "launch-cut", description: "Shared words", captions: { tiktok: "  " } }, "tiktok"), "Shared words");
});

test("a post with no caption goes out with none, never its title or file name", () => {
  assert.equal(captionOf({ title: "IMG_2041", description: null }, "tiktok"), "");
  assert.equal(captionOf({ title: "IMG_2041", description: "" }, "bluesky"), "");
  assert.equal(captionOf({ title: "IMG_2041", description: "", captions: {} }, "linkedin"), "");
});
