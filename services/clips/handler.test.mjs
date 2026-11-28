import { test } from "node:test";
import assert from "node:assert/strict";

import { scan } from "./handler.mjs";

const VOD = "2940471411";
const env = { transcribeUrl: "http://transcribe.test/api/transcribe", agentUrl: "http://agent.test/api/agent/moments" };
const user = { id: "u1", token: "t" };
const req = { headers: { "x-forwarded-for": "203.0.113.9" } };
const seconds = 1800;

/** Twitch with three viewer clips, transcription that spends the allowance after `allowance` stretches, and an agent picking from window 0. */
function fakes({ allowance = Infinity } = {}) {
  const calls = { transcribe: 0, agent: null, headers: [] };
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    if (href === "https://gql.twitch.tv/gql") {
      const body = JSON.parse(init.body);
      const query = Array.isArray(body) ? "" : body.query;
      // A chat with nothing said until after the broadcast ends, so reading it finishes at once.
      if (Array.isArray(body)) return Response.json([{ data: { video: { comments: { edges: [{ node: { id: "x", contentOffsetSeconds: seconds + 60, message: { fragments: [{ text: "gg" }] } } }] } } } }]);
      if (query.includes("videoPlaybackAccessToken")) return Response.json({ data: { videoPlaybackAccessToken: { value: "{}", signature: "s" } } });
      if (query.includes("clips(")) {
        const edges = [700, 1200, 300, 100, 500, 900, 1000, 1400, 1550, 1700, 200, 1300].map((start, i) => ({ node: { title: `clip ${i}`, viewCount: 1000 - i * 50, durationSeconds: 30, videoOffsetSeconds: start } }));
        return Response.json({ data: { video: { clips: { edges } } } });
      }
      return Response.json({ data: { video: { id: VOD, title: "GTA", lengthSeconds: seconds, owner: { login: "lirik", displayName: "LIRIK" }, game: { name: "GTA" } } } });
    }
    if (href.startsWith("https://usher.ttvnw.net/")) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,VIDEO="audio_only"\nhttps://cdn.test/a/audio_only/index.m3u8\n');
    if (href === "https://cdn.test/a/audio_only/index.m3u8") {
      const lines = ["#EXTM3U", '#EXT-X-MAP:URI="init-0.mp4"'];
      for (let i = 0; i < seconds / 10; i++) lines.push("#EXTINF:10.000,", `${i}.mp4`);
      return new Response(lines.join("\n"));
    }
    if (href === env.transcribeUrl) {
      calls.headers.push(init.headers);
      calls.transcribe += 1;
      if (calls.transcribe > allowance) return Response.json({ error: "You've used this month's 15 minutes of captions." }, { status: 402 });
      return Response.json([{ text: "no way", words: [{ text: "no", start: 10, end: 10.4 }, { text: "way!", start: 10.5, end: 11 }, { text: "later", start: 50, end: 51 }] }]);
    }
    if (href === env.agentUrl) {
      calls.agent = JSON.parse(init.body);
      return Response.json({ moments: [{ window: 0, start: 5, end: 30, score: 88, title: "No way", caption: "#gta", reason: "A fail" }] });
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  const sound = {
    measureLoudness: async () => Array.from({ length: seconds }, () => -30),
    speechWav: async () => Buffer.alloc(64),
  };
  return { calls, fetchImpl, sound };
}

test("a moment comes back on the broadcast's timeline, with its words timed from its start", async () => {
  const { calls, fetchImpl, sound } = fakes();
  const lines = [];
  const result = await scan({ vod: VOD }, { req, user, env, say: (line) => lines.push(line), fetchImpl, sound });
  const firstWindow = calls.agent.windows[0];
  assert.equal(calls.agent.windows.length, calls.transcribe);
  assert.deepEqual(firstWindow.clips, [{ title: "clip 0", views: 1000 }]);
  const [moment] = result.moments;
  assert.ok(moment.start >= 640 && moment.start < 700, `starts at ${moment.start}`);
  assert.equal(moment.end - moment.start, 25);
  assert.deepEqual(moment.words, [{ text: "no", start: 5, end: 5.4 }, { text: "way!", start: 5.5, end: 6 }]);
  assert.equal(calls.headers[0].Authorization, "Bearer t");
  assert.equal(calls.headers[0]["X-Forwarded-For"], "203.0.113.9");
  assert.equal(lines.at(-1).step, "picking");
});

test("a spent caption allowance stops transcribing, and the clips come from what was heard", async () => {
  const { calls, fetchImpl, sound } = fakes({ allowance: 2 });
  const result = await scan({ vod: VOD }, { req, user, env, say: () => {}, fetchImpl, sound });
  // Only stretches already under way when the refusal came are sent, not the other seven.
  assert.ok(calls.transcribe <= 5, `${calls.transcribe} sent`);
  assert.equal(calls.agent.windows.length, 2);
  assert.match(result.note, /15 minutes of captions/);
  assert.equal(result.moments.length, 1);
});

test("with no allowance left at all, the scan says so instead of asking the agent", async () => {
  const { calls, fetchImpl, sound } = fakes({ allowance: 0 });
  await assert.rejects(scan({ vod: VOD }, { req, user, env, say: () => {}, fetchImpl, sound }), (error) => error.status === 402 && /captions/.test(error.message));
  assert.equal(calls.agent, null);
});
