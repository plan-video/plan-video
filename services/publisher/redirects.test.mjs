import assert from "node:assert/strict";
import { test } from "node:test";

import { redirectsFor as linkedin } from "../linkedin/handler.mjs";
import { redirectsFor as tiktok } from "../tiktok/handler.mjs";
import { redirectsFor as x } from "../x/handler.mjs";
import { redirectsFor as youtube } from "../youtube/handler.mjs";

test("without PUBLIC_URL the redirect addresses are plan.video's", () => {
  assert.deepEqual([...tiktok()], ["https://plan.video/tiktok/callback", "https://www.plan.video/tiktok/callback", "http://localhost:5173/tiktok/callback"]);
  assert.deepEqual([...youtube()], ["https://plan.video/youtube/callback", "https://www.plan.video/youtube/callback", "http://localhost:5173/youtube/callback"]);
  assert.deepEqual([...linkedin()], ["https://plan.video/linkedin/callback", "https://www.plan.video/linkedin/callback", "http://localhost:5173/linkedin/callback"]);
  assert.deepEqual([...x()], ["https://plan.video/x/callback", "https://www.plan.video/x/callback", "http://127.0.0.1:5173/x/callback"]);
});

test("a copy hosted elsewhere allows its own addresses, and not plan.video's", () => {
  const allowed = tiktok("https://social.example.com/");
  assert.ok(allowed.has("https://social.example.com/tiktok/callback"));
  assert.ok(allowed.has("https://www.social.example.com/tiktok/callback"));
  assert.ok(!allowed.has("https://plan.video/tiktok/callback"));
  assert.ok(x("https://www.social.example.com").has("https://www.social.example.com/x/callback"));
});
