// The ElevenLabs key stays on the server.

import { createWriteStream, openAsBlob } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const SCRIBE = "https://api.elevenlabs.io/v1/speech-to-text";
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

const PAUSE_SECONDS = 0.45;

const HOUR = 3600;
/** Hours of audio a month, by user_data.access_level. A clip longer than what's left is refused, so no plan runs over. */
const MONTHLY_HOURS = { 1: 0.25, 2: 10, 3: 20, 4: 40 };
const allowanceFor = (level) => (MONTHLY_HOURS[level] ?? MONTHLY_HOURS[level > 4 ? 4 : 1]) * HOUR;

// Per person and server-wide. Each holds up to 100 MB of audio on disk while ElevenLabs
// works on it: 1.2 GB at most.
const PERSON_SLOTS = 3;
const SERVER_SLOTS = 12;
const QUEUE_MAX = 40;
const HEADER_BYTES = 64 * 1024;

const sessions = new Map();
const windows = new Map();
const counting = new Map();
// Seconds counted that ElevenLabs never transcribed (refused or unreachable) go back here:
// caption_usage only ever adds.
const unheard = new Map();

export class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class Slots {
  constructor(size) {
    this.size = size;
    this.busy = 0;
    this.waiting = [];
  }

  async take() {
    if (this.busy < this.size) {
      this.busy += 1;
      return;
    }
    if (this.waiting.length >= QUEUE_MAX) throw new Busy(503, "Captions are busy. Try again in a moment.");
    await new Promise((resolve) => this.waiting.push(resolve));
  }

  give() {
    const next = this.waiting.shift();
    if (next) next();
    else this.busy -= 1;
  }

  get idle() {
    return this.busy === 0 && this.waiting.length === 0;
  }
}

const server = new Slots(SERVER_SLOTS);
const people = new Map();

/** Clips waiting in a person's line, or with no one named, in the server's. */
export const queued = (userId) => (userId === undefined ? server.waiting.length : (people.get(userId)?.waiting.length ?? 0));

async function inTurn(userId, work) {
  let mine = people.get(userId);
  if (!mine) {
    mine = new Slots(PERSON_SLOTS);
    people.set(userId, mine);
  }
  try {
    await mine.take();
    try {
      await server.take();
      try {
        return await work();
      } finally {
        server.give();
      }
    } finally {
      mine.give();
    }
  } finally {
    if (mine.idle) people.delete(userId);
  }
}

/** The editor waits a few seconds and sends the clip again. */
class Busy extends Refused {}

function limit(name, max, seconds) {
  const now = Date.now();
  const entry = windows.get(name);
  if (!entry || entry.reset <= now) {
    windows.set(name, { count: 1, reset: now + seconds * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw new Refused(429, "Too many captions at once. Wait a few minutes and try again.");
}

// OAuth-client tokens (Claude's connector, say) carry `client_id` and only work at /mcp.
function grantedToApp(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))?.client_id != null;
  } catch {
    return false;
  }
}

async function supabaseCall(env, path, token, init = {}) {
  return fetch(`${env.supabaseUrl}${path}`, {
    ...init,
    headers: { apikey: env.supabaseAnonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(5000),
  });
}

async function userFor(req, env) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length > 4096 || grantedToApp(token)) throw new Refused(401, "Sign in to generate captions.");

  const cached = sessions.get(token);
  if (cached && cached.until > Date.now()) return cached.user;

  const res = await supabaseCall(env, "/auth/v1/user", token);
  if (!res.ok) throw new Refused(401, "Sign in to generate captions.");
  const user = await res.json();
  if (typeof user?.id !== "string") throw new Refused(401, "Sign in to generate captions.");

  if (env.requireInvite) {
    const access = await supabaseCall(env, "/rest/v1/rpc/has_access", token, { method: "POST", body: "{}" });
    if (!access.ok || (await access.json()) !== true) throw new Refused(403, "This account hasn't been let in yet.");
  }

  const known = { id: user.id, token, level: await levelOf(env, user.id, token) };
  if (sessions.size > 5000) sessions.clear();
  sessions.set(token, { user: known, until: Date.now() + 60_000 });
  return known;
}

/** An unreadable row counts as Free, so an outage never grants hours. */
async function levelOf(env, userId, token) {
  const res = await supabaseCall(env, `/rest/v1/user_data?select=access_level&id=eq.${userId}`, token).catch(() => null);
  if (!res?.ok) return 1;
  const [row] = await res.json().catch(() => []);
  return Number(row?.access_level) || 1;
}

/** UTC, as caption_usage keys it. */
function thisMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

const unheardKey = (user) => `${user.id}:${thisMonth()}`;

/** Refuses when the count can't be read, since every caption costs. */
async function usedSeconds(env, user) {
  const res = await supabaseCall(env, `/rest/v1/caption_usage?select=seconds&user_id=eq.${user.id}&month=eq.${thisMonth()}`, user.token).catch(() => null);
  if (!res?.ok) throw new Refused(503, "Captions aren't available right now. Try again in a moment.");
  const [row] = await res.json().catch(() => []);
  return (Number(row?.seconds) || 0) - (unheard.get(unheardKey(user)) ?? 0);
}

// One clip per person at a time, so checking what's left and counting a clip can't
// interleave: a burst of clips would otherwise all pass on the same old total.
async function oneAtATime(userId, work) {
  const previous = counting.get(userId) ?? Promise.resolve();
  let release;
  const mine = new Promise((resolve) => (release = resolve));
  const tail = previous.then(() => mine);
  counting.set(userId, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (counting.get(userId) === tail) counting.delete(userId);
  }
}

async function countSeconds(env, user, amount) {
  const res = await supabaseCall(env, "/rest/v1/rpc/add_caption_seconds", user.token, {
    method: "POST",
    body: JSON.stringify({ amount }),
  }).catch(() => null);
  const total = res?.ok ? Number(await res.json().catch(() => NaN)) : NaN;
  if (!Number.isFinite(total)) {
    console.error(`transcribe: couldn't count ${amount}s of captions for ${user.id} (${res?.status ?? "no answer"})`);
    throw new Refused(503, "Captions aren't available right now. Try again in a moment.");
  }
  return total - amount - (unheard.get(unheardKey(user)) ?? 0);
}

function giveBack(user, amount) {
  const key = unheardKey(user);
  if (unheard.size > 5000) unheard.clear();
  unheard.set(key, (unheard.get(key) ?? 0) + amount);
}

function span(seconds, round) {
  const minutes = round(seconds / 60);
  if (minutes < 1) return "less than a minute";
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${round(minutes / 60)} hours`;
}

function hours(seconds) {
  if (seconds < HOUR) return `${Math.round(seconds / 60)} minutes`;
  const value = seconds / HOUR;
  return `${value} hour${value === 1 ? "" : "s"}`;
}

function resetDay() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
}

// The editor only sends 16-bit PCM mono, so anything else is refused rather than measured.
// `audio` can be the start of the file, with `total` its whole length in bytes.
export function wavSeconds(audio, total = audio.length) {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") return null;
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= audio.length) {
    const id = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && body + 16 <= audio.length) {
      const format = audio.readUInt16LE(body);
      const channels = audio.readUInt16LE(body + 2);
      const sampleRate = audio.readUInt32LE(body + 4);
      const bits = audio.readUInt16LE(body + 14);
      if ((format !== 1 && format !== 0xfffe) || channels !== 1 || bits !== 16 || sampleRate < 8000 || sampleRate > 192000) return null;
      byteRate = sampleRate * 2;
    } else if (id === "data") {
      if (!byteRate) return null;
      // A streamed WAV can leave the size at 0 or all ones: count what arrived.
      const bytes = Math.min(size || Infinity, total - body);
      return bytes / byteRate;
    }
    offset = body + size + (size % 2);
  }
  return null;
}

export async function handleTranscribe(req, res, env) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Use POST." });
    return;
  }
  if (!env.elevenLabsKey) {
    json(res, 503, { error: "Captions aren't set up on the server yet." });
    return;
  }

  const user = await userFor(req, env);
  // A scene is sent once per audible clip, and once more as a mix if a clip can't be read.
  limit(`transcribe:${user.id}`, 60, 600);
  try {
    await inTurn(user.id, () => transcribe(req, res, env, user));
  } catch (error) {
    if (!(error instanceof Busy)) throw error;
    // Nothing was counted; `retryAfter` makes the editor resend on its own.
    json(res, 503, { error: error.message, retryAfter: 5 });
  }
}

async function transcribe(req, res, env, user) {
  const allowance = allowanceFor(user.level);
  const refuseSpent = () => {
    throw new Refused(402, `You've used this month's ${hours(allowance)} of captions. They come back on ${resetDay()}.`);
  };
  // Checked before the audio is read, so a spent allowance doesn't take an upload.
  if ((await usedSeconds(env, user)) >= allowance) refuseSpent();

  // The audio waits on disk, not in memory: a few uploads at once would fill the server's.
  const dir = await mkdtemp(join(env.tmpDir || tmpdir(), "transcribe-"));
  try {
    const file = join(dir, "audio.wav");
    const size = await saveBody(req, file, MAX_AUDIO_BYTES);
    if (size === 0) {
      json(res, 400, { error: "There was no audio to transcribe." });
      return;
    }
    const seconds = wavSeconds(await readHead(file, HEADER_BYTES), size);
    if (seconds === null) {
      json(res, 415, { error: "Captions need the scene's audio as 16-bit mono WAV." });
      return;
    }

    // Counted by the file's length before ElevenLabs is asked, so it can't be heard for free.
    const amount = Math.min(7200, Math.max(1, Math.ceil(seconds)));
    await oneAtATime(user.id, async () => {
      const used = await usedSeconds(env, user);
      if (used >= allowance) refuseSpent();
      if (used + amount > allowance) {
        throw new Refused(
          402,
          `This clip is ${span(amount, Math.ceil)} long, and ${span(allowance - used, Math.floor)} of captions ${allowance - used < 60 ? "is" : "are"} left this month. Shorten it, or wait until ${resetDay()}.`,
        );
      }
      // Another server on the same database could have counted a clip in between.
      if ((await countSeconds(env, user, amount)) + amount > allowance) {
        giveBack(user, amount);
        refuseSpent();
      }
    });

    const form = new FormData();
    form.set("model_id", "scribe_v2");
    form.set("file", await openAsBlob(file, { type: req.headers["content-type"] || "audio/wav" }), "audio");
    form.set("timestamps_granularity", "word");
    // Captions show what was said. "(gunshots)" is not a word.
    form.set("tag_audio_events", "false");

    let scribe;
    try {
      scribe = await fetch(SCRIBE, {
        method: "POST",
        headers: { "xi-api-key": env.elevenLabsKey },
        body: form,
        signal: AbortSignal.timeout(300_000),
      });
    } catch {
      giveBack(user, amount);
      json(res, 502, { error: "Couldn't reach the transcription service. Try again in a moment." });
      return;
    }

    const payload = await scribe.json().catch(() => null);
    if (!scribe.ok) {
      giveBack(user, amount);
      console.error(`transcribe: ElevenLabs answered ${scribe.status}: ${errorOf(payload) ?? "no detail"}`);
      // 401 from ElevenLabs is our key, not the user's sign-in.
      if (scribe.status === 401 || scribe.status === 403) {
        json(res, 502, { error: "Captions aren't available right now. Try again in a moment." });
        return;
      }
      json(res, scribe.status, { error: errorOf(payload) || `The transcription service refused the audio (${scribe.status}).` });
      return;
    }

    json(res, 200, toTranscript(payload));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function toTranscript(payload) {
  const words = wordsOf(payload?.words);
  const segments = [];
  let current = [];
  const flush = () => {
    if (current.length === 0) return;
    segments.push({ text: current.map((word) => word.text).join(" "), words: current });
    current = [];
  };

  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous && word.start - previous.end > PAUSE_SECONDS) flush();
    current.push(word);
    if (/[.!?]$/.test(word.text)) flush();
  }
  flush();
  return segments;
}

function wordsOf(words) {
  return (Array.isArray(words) ? words : []).flatMap((word) => {
    const text = typeof word?.text === "string" ? word.text.trim() : "";
    if (word?.type !== "word" || !text || typeof word.start !== "number" || typeof word.end !== "number") return [];
    return [{ text, start: word.start, end: word.end }];
  });
}

function errorOf(payload) {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => item?.msg).filter(Boolean).join("; ") || undefined;
  return typeof detail?.message === "string" ? detail.message : undefined;
}

async function saveBody(req, file, max) {
  let size = 0;
  const cap = new Transform({
    transform(chunk, _encoding, done) {
      size += chunk.length;
      if (size > max) done(new Refused(413, "The scene audio is too large to transcribe."));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(req, cap, createWriteStream(file));
  } catch (error) {
    req.destroy();
    if (error instanceof Refused) throw error;
    throw new Refused(400, "The audio didn't arrive in full. Try again.");
  }
  return size;
}

async function readHead(file, bytes) {
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(head, 0, bytes, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export function json(res, status, body) {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(payload);
}
