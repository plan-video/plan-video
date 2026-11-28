import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePieces, pickVideo } from "./hls.mjs";
import { parseStoryboard, parseTwitchLink, readChat } from "./twitch.mjs";

test("links to a broadcast or a channel are read, anything else isn't", () => {
  assert.deepEqual(parseTwitchLink("https://www.twitch.tv/videos/2940471411?t=1h2m3s"), { vod: "2940471411" });
  assert.deepEqual(parseTwitchLink("m.twitch.tv/videos/2940471411"), { vod: "2940471411" });
  assert.deepEqual(parseTwitchLink("twitch.tv/lirik/v/2940471411"), { vod: "2940471411" });
  assert.deepEqual(parseTwitchLink("https://twitch.tv/Lirik"), { channel: "lirik" });
  assert.deepEqual(parseTwitchLink("https://twitch.tv/lirik/videos?filter=archives"), { channel: "lirik" });
  assert.equal(parseTwitchLink("https://twitch.tv/directory"), null);
  assert.equal(parseTwitchLink("https://clips.twitch.tv/SomeClip"), null);
  assert.equal(parseTwitchLink("https://evil.example/twitch.tv/videos/2940471411"), null);
  assert.equal(parseTwitchLink("https://twitch.tv.evil.example/videos/2940471411"), null);
});

test("pieces keep their place in the broadcast, and muted ones are marked", () => {
  const text = ["#EXTM3U", '#EXT-X-MAP:URI="init-0.mp4"', "#EXTINF:10.000,", "0.mp4", "#EXTINF:10.000,", "1-muted.mp4", "#EXTINF:10.000,", "2-unmuted.mp4", "#EXTINF:4.500,", "3.mp4", "#EXT-X-ENDLIST"].join("\n");
  const { init, pieces, seconds } = parsePieces(text, "https://cdn.test/abc/audio_only/index-muted-X.m3u8");
  assert.equal(init, "https://cdn.test/abc/audio_only/init-0.mp4");
  assert.deepEqual(pieces.map((piece) => [piece.start, piece.muted]), [[0, false], [10, true], [20, false], [30, false]]);
  assert.equal(pieces[1].url, "https://cdn.test/abc/audio_only/1-muted.mp4");
  assert.equal(seconds, 34.5);
});

test("the storyboard is the sharper set, with its sheets' full addresses", () => {
  const info = "https://cdn.test/abc/storyboards/1-info.json";
  const board = parseStoryboard(
    [
      { quality: "low", width: 160, height: 90, cols: 5, rows: 40, interval: 16, count: 200, images: ["1-low-0.jpg"] },
      { quality: "high", width: 220, height: 124, cols: 5, rows: 10, interval: 16, count: 200, images: ["1-high-0.jpg", "1-high-1.jpg"] },
    ],
    info,
  );
  assert.deepEqual(board, { images: ["https://cdn.test/abc/storyboards/1-high-0.jpg", "https://cdn.test/abc/storyboards/1-high-1.jpg"], width: 220, height: 124, cols: 5, rows: 10, interval: 16, count: 200 });
  assert.equal(parseStoryboard([{ quality: "high", images: [] }], info), null);
  assert.equal(parseStoryboard(null, info), null);
});

test("the picture is the sharpest up to 1080 lines", () => {
  const lists = [{ name: "chunked", height: 1440, url: "a" }, { name: "1080p60", height: 1080, url: "b" }, { name: "720p60", height: 720, url: "c" }, { name: "audio_only", height: 0, url: "d" }];
  assert.equal(pickVideo(lists).name, "1080p60");
  assert.equal(pickVideo([lists[0], lists[3]]).name, "chunked");
  assert.equal(pickVideo(lists, 480).name, "720p60");
  assert.equal(pickVideo([...lists, { name: "480p30", height: 480, url: "e" }], 480).name, "480p30");
});

/** A fake chat: `messages` by second; Twitch's page is the ~50 messages from a bit before the offset. */
function fakeChat(messages, { emptyFirst = new Set() } = {}) {
  const asked = [];
  const fetchImpl = async (_url, init) => {
    const offset = JSON.parse(init.body)[0].variables.contentOffsetSeconds;
    asked.push(offset);
    if (emptyFirst.delete(offset)) return Response.json([{ data: { video: { comments: { edges: [] } } } }]);
    const from = messages.findIndex((message) => message.t >= offset - 2);
    const page = from === -1 ? [] : messages.slice(from, from + 50);
    return Response.json([{ data: { video: { comments: { edges: page.map((message) => ({ node: { id: message.id, contentOffsetSeconds: message.t, message: { fragments: [{ text: message.text }] } } })) } } } }]);
  };
  return { fetchImpl, asked };
}

test("chat is read whole by time, and an empty page from a busy Twitch is asked again", async () => {
  const messages = Array.from({ length: 900 }, (_, i) => ({ id: `m${i}`, t: Math.floor(i / 3), text: i % 7 ? "hi" : "KEKW" }));
  const { fetchImpl, asked } = fakeChat(messages, { emptyFirst: new Set([0, 150]) });
  const pauses = [];
  const read = await readChat("1", 300, { parts: 2, fetchImpl, pause: async (ms) => pauses.push(ms) });
  assert.equal(read.length, 900);
  assert.ok(read.every((message, i) => i === 0 || read[i - 1].t <= message.t));
  assert.deepEqual(pauses, [500, 500]);
  assert.ok(asked.length < 60, `${asked.length} requests`);
});
