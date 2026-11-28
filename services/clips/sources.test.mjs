import { test } from "node:test";
import assert from "node:assert/strict";

import { chatText, findKickClips, readKickChat } from "./kick.mjs";
import { parseLink, sourceOfId } from "./sources.mjs";
import { chatLine, heatmapClips, refusal, youtubeRenditions, youtubeStoryboard } from "./youtube.mjs";

const UUID = "db689b68-5d13-4eb7-8851-779ff19115ee";

test("a link is read for the platform it's on, and a broadcast's id says which one it was", () => {
  assert.deepEqual(parseLink(`https://kick.com/adinross/videos/${UUID}`), { source: "kick", vod: UUID });
  assert.deepEqual(parseLink(`kick.com/video/${UUID}`), { source: "kick", vod: UUID });
  assert.deepEqual(parseLink("https://kick.com/xQc"), { source: "kick", channel: "xqc" });
  assert.deepEqual(parseLink("https://www.youtube.com/watch?v=NIPrakjLo-U&t=40s"), { source: "youtube", vod: "NIPrakjLo-U" });
  assert.deepEqual(parseLink("https://youtu.be/NIPrakjLo-U"), { source: "youtube", vod: "NIPrakjLo-U" });
  assert.deepEqual(parseLink("youtube.com/live/NIPrakjLo-U"), { source: "youtube", vod: "NIPrakjLo-U" });
  assert.deepEqual(parseLink("https://www.youtube.com/@ludwig/streams"), { source: "youtube", channel: "@ludwig" });
  assert.deepEqual(parseLink("https://www.twitch.tv/videos/2940471411"), { source: "twitch", vod: "2940471411" });
  assert.equal(parseLink("https://example.com/videos/2940471411"), null);
  assert.equal(parseLink("https://kick.com.evil.example/xqc"), null);

  assert.deepEqual(sourceOfId("2940471411"), { source: "twitch", vod: "2940471411" });
  assert.deepEqual(sourceOfId(`kick:${UUID}`), { source: "kick", vod: UUID });
  assert.deepEqual(sourceOfId("yt:NIPrakjLo-U"), { source: "youtube", vod: "NIPrakjLo-U" });
  assert.equal(sourceOfId("yt:../../etc"), null);
  assert.equal(sourceOfId("kick:nope"), null);
});

const started = Date.parse("2026-11-26T18:00:00Z");
const kickVideo = { channelId: 1, startedAt: started, seconds: 600, login: "adinross", livestreamId: 77 };
const at = (seconds) => new Date(started + seconds * 1000).toISOString();

/** Kick's history: `perSecond` messages a second; a page is the 16 after the time asked; the first ask is refused as busy. */
function fakeKick(perSecond, { busyFirst = false } = {}) {
  const asked = [];
  let busy = busyFirst;
  const fetchImpl = async (url) => {
    if (busy) {
      busy = false;
      return { ok: false, status: 429, json: async () => null };
    }
    const from = (Date.parse(new URL(url).searchParams.get("start_time")) - started) / 1000;
    asked.push(from);
    const messages = Array.from({ length: 16 }, (_, i) => ({ created_at: at(from + i / perSecond), content: i % 2 ? "[emote:1:KEKW]" : "hi" }));
    return { ok: true, status: 200, json: async () => ({ data: { messages } }) };
  };
  return { fetchImpl, asked };
}

test("busy Kick chat is sampled, and each sample weighs for the stretch it stands for", async () => {
  const pauses = [];
  const busy = fakeKick(4, { busyFirst: true });
  const messages = await readKickChat(kickVideo, { fetchImpl: busy.fetchImpl, atOnce: 1, pause: async (ms) => pauses.push(ms) });
  assert.deepEqual(pauses, [1000]);
  assert.ok(busy.asked.length <= 31, `${busy.asked.length} pages`);
  // 16 messages over ~4 s stand for a 20 s stretch: 4 a second either way.
  const total = messages.reduce((sum, message) => sum + (message.weight ?? 1), 0);
  assert.ok(Math.abs(total / 600 - 4) < 0.6, `${(total / 600).toFixed(2)} a second`);
  assert.equal(messages[1].text, "KEKW");

  const quiet = fakeKick(0.1);
  const all = await readKickChat(kickVideo, { fetchImpl: quiet.fetchImpl, atOnce: 1, pause: async () => {} });
  assert.ok(all.every((message) => !message.weight), "a quiet chat is read whole");
});

test("a Kick clip is placed by when it was made, when Kick doesn't say where it starts", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      clips: [
        { livestream_id: 77, duration: 30, vod_starts_at: 0, created_at: at(330), views: 900, title: "no way" },
        { livestream_id: 77, duration: 20, vod_starts_at: 100, created_at: at(999), views: 10, title: "given" },
        { livestream_id: 12, duration: 30, created_at: at(200), views: 5000, title: "another stream" },
      ],
    }),
  });
  assert.deepEqual(await findKickClips(kickVideo, fetchImpl), [
    { start: 300, duration: 30, views: 900, title: "no way" },
    { start: 100, duration: 20, views: 10, title: "given" },
  ]);
  assert.equal(chatText("W [emote:2894538:adinW]"), "W adinW");
});

test("YouTube's chat replay, storyboard, heatmap and pieces are read from what yt-dlp gives", () => {
  const line = JSON.stringify({ replayChatItemAction: { videoOffsetTimeMsec: "4890500", actions: [{ addChatItemAction: { item: { liveChatTextMessageRenderer: { message: { runs: [{ text: "gg " }, { emoji: { shortcuts: [":fire:"] } }] } } } } }] } });
  assert.deepEqual(chatLine(line), { t: 4890.5, text: "gg :fire:" });
  assert.equal(chatLine("{}"), null);
  assert.equal(chatLine("not json"), null);

  const board = youtubeStoryboard([
    { format_id: "sb0", width: 320, height: 180, rows: 3, columns: 3, fragments: [{ url: "https://i.ytimg.com/a0.jpg", duration: 90 }] },
    { format_id: "sb1", width: 160, height: 90, rows: 5, columns: 5, fragments: [{ url: "https://i.ytimg.com/b0.jpg", duration: 250 }, { url: "https://i.ytimg.com/b1.jpg", duration: 250 }] },
  ]);
  assert.deepEqual(board, { images: ["https://i.ytimg.com/b0.jpg", "https://i.ytimg.com/b1.jpg"], width: 160, height: 90, cols: 5, rows: 5, interval: 10, count: 50 });

  const peaks = heatmapClips([{ start_time: 0, end_time: 60, value: 0.2 }, { start_time: 60, end_time: 120, value: 1 }, { start_time: 120, end_time: 180, value: 0.6 }]);
  assert.deepEqual(peaks.map((peak) => peak.start), [60, 120]);

  const formats = [
    { format_id: "231", protocol: "m3u8_native", url: "u231", vcodec: "avc1.4D401F", height: 480, fps: 30 },
    { format_id: "312", protocol: "m3u8_native", url: "u312", vcodec: "avc1.64002A", height: 1080, fps: 60 },
    { format_id: "617", protocol: "m3u8_native", url: "u617", vcodec: "vp09", height: 1080 },
    { format_id: "299", protocol: "https", url: "u299", vcodec: "avc1.64002A", height: 1080 },
    { format_id: "233", protocol: "m3u8_native", url: "u233", vcodec: "none", abr: 48 },
    { format_id: "234", protocol: "m3u8_native", url: "u234", vcodec: "none", abr: 128 },
  ];
  assert.deepEqual(Object.values(youtubeRenditions(formats, 1080)).map((format) => format.format_id), ["312", "234"]);
  assert.deepEqual(Object.values(youtubeRenditions(formats, 480)).map((format) => format.format_id), ["231", "234"]);
});

test("yt-dlp's refusals are said in words a person can act on", () => {
  assert.equal(refusal("ERROR: [youtube] x: Sign in to confirm your age.").status, 403);
  assert.match(refusal("ERROR: This live event will begin in 3 hours").message, /still live/);
  assert.match(refusal("ERROR: Sign in to confirm you’re not a bot").message, /asked this server to sign in/);
  assert.equal(refusal("ERROR: Video unavailable").status, 404);
});
