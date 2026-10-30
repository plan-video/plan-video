import { test } from "node:test";
import assert from "node:assert/strict";
import { Agent, createServer, request } from "node:http";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleTranscribe, json, Refused, wavSeconds } from "./handler.mjs";

const SUPABASE = "https://db.test";
const RATE = 16000;

/** A 16-bit mono WAV header for `seconds` of audio at 16 kHz. */
function wavHeader(seconds) {
  const bytes = Math.round(seconds * RATE * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + bytes, 4);
  head.write("WAVE", 8, "ascii");
  head.write("fmt ", 12, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(bytes, 40);
  return { head, bytes };
}

/** A signed-in token for `id`, shaped like Supabase's. */
const tokenFor = (id) => `h.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.s`;
const idOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub;

/**
 * Stands in for Supabase and ElevenLabs. The usage count adds and answers in
 * one step, as add_caption_seconds does. ElevenLabs reads the whole upload as
 * a stream, takes `delay` ms, and answers `status`.
 */
function fakes({ level = 1, delay = 30, status = () => 200 } = {}) {
  const usage = new Map();
  const state = { usage, heard: 0, running: 0, mostRunning: 0, uploaded: [] };
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1")) return real(input, init);
    const token = (init.headers?.Authorization ?? "").replace("Bearer ", "");
    if (url === `${SUPABASE}/auth/v1/user`) return Response.json({ id: idOf(token) });
    if (url.startsWith(`${SUPABASE}/rest/v1/user_data`)) return Response.json([{ access_level: level }]);
    if (url.startsWith(`${SUPABASE}/rest/v1/caption_usage`)) {
      const seconds = usage.get(idOf(token));
      return Response.json(seconds === undefined ? [] : [{ seconds }]);
    }
    if (url === `${SUPABASE}/rest/v1/rpc/add_caption_seconds`) {
      const { amount } = JSON.parse(init.body);
      const total = (usage.get(idOf(token)) ?? 0) + amount;
      usage.set(idOf(token), total);
      return Response.json(total);
    }
    if (url === "https://api.elevenlabs.io/v1/speech-to-text") {
      state.running += 1;
      state.mostRunning = Math.max(state.mostRunning, state.running);
      try {
        let size = 0;
        for await (const chunk of new Request(url, { method: "POST", body: init.body }).body) size += chunk.length;
        state.uploaded.push(size);
        await new Promise((resolve) => setTimeout(resolve, delay));
        state.heard += 1;
        const code = status(state.heard);
        if (code !== 200) return Response.json({ detail: "No." }, { status: code });
        return Response.json({ words: [{ type: "word", text: "Hello.", start: 0, end: 0.5 }] });
      } finally {
        state.running -= 1;
      }
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  state.restore = () => {
    globalThis.fetch = real;
  };
  return state;
}

async function serve(env) {
  const server = createServer((req, res) => {
    handleTranscribe(req, res, env).catch((error) => {
      if (error instanceof Refused) json(res, error.status, { error: error.message });
      else json(res, 500, { error: String(error?.message ?? error) });
    });
  });
  server.requestTimeout = 360_000;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/api/transcribe`,
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Sends `seconds` of silence as a WAV, in 1 MB writes, and resolves with the
 * status and answer. Kept alive, as a browser's are: the server then reads
 * past the rest of an upload it refused instead of resetting the connection.
 */
const agent = new Agent({ keepAlive: true });

function send(url, token, seconds) {
  const { head, bytes } = wavHeader(seconds);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      agent,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "audio/wav", "Content-Length": head.length + bytes },
    });
    req.on("response", (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "null") }));
    });
    req.on("error", (error) => (error.code === "ECONNRESET" || error.code === "EPIPE" ? resolve({ status: 0 }) : reject(error)));
    const block = Buffer.alloc(1024 * 1024);
    let left = bytes;
    const write = () => {
      while (left > 0) {
        const piece = left >= block.length ? block : block.subarray(0, left);
        left -= piece.length;
        if (!req.write(piece)) {
          req.once("drain", write);
          return;
        }
      }
      req.end();
    };
    req.write(head);
    write();
  });
}

/** The temp folder, once the handler has had a moment to clear it after answering. */
async function leftOnDisk(dir) {
  for (let i = 0; i < 40; i++) {
    const files = await readdir(dir);
    if (files.length === 0) return files;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return readdir(dir);
}

async function setup(options) {
  const fake = fakes(options);
  const tmpDir = await mkdtemp(join(tmpdir(), "transcribe-test-"));
  const env = { elevenLabsKey: "key", supabaseUrl: SUPABASE, supabaseAnonKey: "anon", requireInvite: false, tmpDir };
  const app = await serve(env);
  return {
    fake,
    tmpDir,
    url: app.url,
    async close() {
      agent.destroy();
      await app.close();
      fake.restore();
    },
  };
}

test("wavSeconds measures from the header and the file's whole length", () => {
  const { head, bytes } = wavHeader(600);
  assert.equal(wavSeconds(Buffer.concat([head, Buffer.alloc(bytes)])), 600);
  assert.equal(wavSeconds(head, head.length + bytes), 600);
  assert.equal(wavSeconds(Buffer.from("not a wav at all, not a wav at all, not a wav")), null);
});

test("a burst of clips sent at once can't each pass on the same old total", async () => {
  const run = await setup({ delay: 200 });
  try {
    const token = tokenFor("burst");
    // Free has 15 minutes. Ten 10-minute clips at once used to all be heard.
    const results = await Promise.all(Array.from({ length: 10 }, () => send(run.url, token, 600)));
    const heard = results.filter((result) => result.status === 200).length;
    assert.equal(heard, 1, JSON.stringify(results.map((result) => result.status)));
    assert.equal(run.fake.heard, 1);
    assert.equal(results.filter((result) => result.status === 402).length, 9);
    // Refused clips aren't counted: only the one heard is.
    assert.equal(run.fake.usage.get("burst"), 600);
    // The 5 minutes left still take a clip that fits, then nothing more.
    assert.equal((await send(run.url, token, 300)).status, 200);
    assert.equal((await send(run.url, token, 1)).status, 402);
    assert.equal(run.fake.heard, 2);
    assert.equal(run.fake.usage.get("burst"), 900);
  } finally {
    await run.close();
  }
});

test("seconds ElevenLabs never transcribed go back to the person", async () => {
  const run = await setup({ status: (n) => (n === 1 ? 500 : 200) });
  try {
    const token = tokenFor("refund");
    assert.equal((await send(run.url, token, 600)).status, 500);
    // 600 s counted, but given back: the whole 15 minutes are still there.
    assert.equal((await send(run.url, token, 900)).status, 200);
    assert.equal((await send(run.url, token, 1)).status, 402);
  } finally {
    await run.close();
  }
});

test("a clip longer than what's left is refused whole, says what's left, and counts nothing", async () => {
  const run = await setup();
  try {
    const token = tokenFor("long");
    assert.equal((await send(run.url, token, 600)).status, 200);
    const refused = await send(run.url, token, 1200);
    assert.equal(refused.status, 402);
    assert.match(refused.body.error, /^This clip is 20 minutes long, and 5 minutes of captions are left this month\./);
    assert.equal(run.fake.heard, 1);
    assert.equal(run.fake.usage.get("long"), 600);
    // A clip that fits exactly still goes.
    assert.equal((await send(run.url, token, 300)).status, 200);
  } finally {
    await run.close();
  }
});

test("one person runs three at a time, and the rest wait their turn", async () => {
  const run = await setup({ level: 4, delay: 150 });
  try {
    const token = tokenFor("queue");
    const results = await Promise.all(Array.from({ length: 7 }, () => send(run.url, token, 5)));
    assert.deepEqual(results.map((result) => result.status), [200, 200, 200, 200, 200, 200, 200]);
    assert.equal(run.fake.mostRunning, 3);
    assert.equal(run.fake.usage.get("queue"), 35);
  } finally {
    await run.close();
  }
});

test("past the line the server can hold, a clip is told to come back, and nothing is counted", async () => {
  const run = await setup({ level: 4, delay: 400 });
  try {
    // 60 people at once: 12 are heard, 40 wait their turn, 8 are told to retry.
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => send(run.url, tokenFor(`crowd-${i}`), 1)));
    const busy = results.filter((result) => result.status === 503);
    assert.equal(results.filter((result) => result.status === 200).length, 52);
    assert.equal(busy.length, 8);
    for (const result of busy) assert.equal(result.body.retryAfter, 5);
    assert.equal(run.fake.mostRunning, 12);
    assert.equal(run.fake.usage.size, 52);
  } finally {
    await run.close();
  }
});

test("the audio waits on disk, never whole in memory, and is deleted after", async () => {
  const run = await setup({ level: 4 });
  try {
    const token = tokenFor("big");
    globalThis.gc?.();
    const base = process.memoryUsage();
    let peak = 0;
    const sampler = setInterval(() => {
      const now = process.memoryUsage();
      peak = Math.max(peak, now.arrayBuffers - base.arrayBuffers, now.external - base.external);
    }, 5);
    // 50 minutes at 16 kHz: about 96 MB, just under the cap.
    const result = await send(run.url, token, 3000);
    clearInterval(sampler);
    assert.equal(result.status, 200);
    assert.equal(run.fake.uploaded.at(-1) > 96_000_000, true);
    assert.ok(peak < 40 * 1024 * 1024, `held ${Math.round(peak / 1024 / 1024)} MB at once`);
    assert.deepEqual(await leftOnDisk(run.tmpDir), []);
  } finally {
    await run.close();
  }
});

test("audio past 100 MB is refused, counted for nothing and not left on disk", async () => {
  const run = await setup({ level: 4 });
  try {
    const result = await send(run.url, tokenFor("huge"), 3300);
    assert.notEqual(result.status, 200);
    assert.equal(run.fake.heard, 0);
    assert.equal(run.fake.usage.get("huge"), undefined);
    assert.deepEqual(await leftOnDisk(run.tmpDir), []);
  } finally {
    await run.close();
  }
});
