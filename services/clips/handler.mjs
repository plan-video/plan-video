// Finds the moments of a past Twitch, Kick or YouTube broadcast worth a short clip, and hands over just
// those stretches.
// The speech goes through /api/transcribe and the picking through /api/agent/moments, each under the
// person's own sign-in, so the caption allowance and the agent's spending caps count as they always do.

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { measureLoudness, speechWav } from "./audio.mjs";
import { StreamError } from "./hls.mjs";
import { chatSummary, heat, pickWindows, reactions, usual } from "./signals.mjs";
import { openSource, parseLink, sourceOfId, writeStretch } from "./sources.mjs";

const MIN_SECONDS = 60;
const MAX_SECONDS = 14 * 3600;
const WINDOWS = 36;
const TRANSCRIBE_AT_ONCE = 3;
const MOMENTS = 30;
const MAX_CLIP_SECONDS = 120;
/** A preview only has to be watched in a small player, at about a tenth of the full picture's size. */
const PREVIEW_LINES = 480;
/** Each scan downloads a broadcast's sound and runs ffmpeg over it. */
const SERVER_SCANS = 2;
const RESULT_HOURS = 6;

export class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sessions = new Map();
const windows = new Map();
const scanning = new Set();
const results = new Map();
let scans = 0;

function limit(name, max, seconds, message) {
  const now = Date.now();
  const entry = windows.get(name);
  if (!entry || entry.reset <= now) {
    if (windows.size > 10_000) windows.clear();
    windows.set(name, { count: 1, reset: now + seconds * 1000 });
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw new Refused(429, message);
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
  if (!token || token.length > 4096 || grantedToApp(token)) throw new Refused(401, "Sign in to find clips.");
  const cached = sessions.get(token);
  if (cached && cached.until > Date.now()) return cached.user;
  const res = await supabaseCall(env, "/auth/v1/user", token).catch(() => null);
  if (!res?.ok) throw new Refused(401, "Sign in to find clips.");
  const user = await res.json().catch(() => null);
  if (typeof user?.id !== "string") throw new Refused(401, "Sign in to find clips.");
  if (env.requireInvite) {
    const access = await supabaseCall(env, "/rest/v1/rpc/has_access", token, { method: "POST", body: "{}" }).catch(() => null);
    if (!access?.ok || (await access.json()) !== true) throw new Refused(403, "This account hasn't been let in yet.");
  }
  const known = { id: user.id, token };
  if (sessions.size > 5000) sessions.clear();
  sessions.set(token, { user: known, until: Date.now() + 60_000 });
  return known;
}

function readJson(req, max = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > max) {
        reject(new Refused(413, "That's too long."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(text || "{}"));
      } catch {
        reject(new Refused(400, "Not JSON."));
      }
    });
    req.on("error", reject);
  });
}

/** Headers for the services this one asks on the person's behalf: their sign-in and where they are. */
function onBehalf(req, user, type) {
  return {
    Authorization: `Bearer ${user.token}`,
    "Content-Type": type,
    ...(req.headers["x-forwarded-for"] ? { "X-Forwarded-For": String(req.headers["x-forwarded-for"]) } : {}),
  };
}

async function errorOf(res) {
  const body = await res.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : `It answered ${res.status}.`;
}


/** The window's words on the broadcast's timeline. */
const onTimeline = (words, from) => words.map((word) => ({ text: word.text, start: +(from + word.start).toFixed(3), end: +(from + word.end).toFixed(3) }));

/**
 * The scan itself. `say` sends one progress line. Returns the broadcast and its moments, best first:
 * each with its stretch of the broadcast, a score, a title, a caption and the words said in it.
 */
export async function scan(link, options) {
  const dir = await mkdtemp(join(options.env.tmpDir || tmpdir(), "scan-"));
  try {
    return await scanIn(link, { ...options, dir });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function scanIn(link, { req, user, env, say, language, fetchImpl = fetch, signal, dir, sound = { measureLoudness, speechWav }, open = openSource }) {
  const source = await open(link, { fetchImpl, env, dir, signal });
  const video = source.video;
  if (video.seconds < MIN_SECONDS) throw new Refused(422, "That broadcast is too short to clip.");
  if (video.seconds > MAX_SECONDS) throw new Refused(422, "That broadcast is longer than 14 hours. Pick a shorter one.");
  say({ type: "video", video });

  say({ type: "step", step: "listening" });
  const audio = await source.audio();
  const seconds = Math.min(video.seconds, Math.floor(audio.seconds ?? video.seconds));
  const [clips, messages, loud] = await Promise.all([
    source.clips().catch(() => []),
    source.chat(seconds).catch(() => []),
    sound.measureLoudness(audio, { fetchImpl, ffmpeg: env.ffmpeg, signal }),
  ]);

  const muted = new Uint8Array(seconds);
  for (const piece of audio.pieces ?? []) if (piece.muted) muted.fill(1, Math.floor(piece.start), Math.min(seconds, Math.ceil(piece.start + piece.duration)));
  const mostlyMuted = (window) => muted.subarray(window.start, window.end).reduce((a, b) => a + b, 0) > (window.end - window.start) / 2;
  const found = pickWindows(heat({ seconds, messages, loud, clips }), { count: WINDOWS, clips, muted: mostlyMuted });
  if (!found.length) throw new Refused(422, "Nothing stood out in that broadcast.");

  // Hottest first, so a nearly spent allowance still covers the best stretches.
  const heard = new Array(found.length).fill(null);
  let spent = null;
  let done = 0;
  let next = 0;
  say({ type: "step", step: "transcribing", done, total: found.length });
  const worker = async () => {
    while (next < found.length && !spent && !signal?.aborted) {
      const index = next++;
      const window = found[index];
      try {
        const wav = await sound.speechWav(audio, window.start, window.end, { fetchImpl, ffmpeg: env.ffmpeg, signal });
        if (wav && !spent) {
          const res = await fetchImpl(env.transcribeUrl, { method: "POST", headers: onBehalf(req, user, "audio/wav"), body: wav, signal: AbortSignal.timeout(300_000) });
          if (res.status === 402) spent = await errorOf(res);
          else if (res.ok) heard[index] = ((await res.json()) ?? []).flatMap((segment) => segment?.words ?? []);
          else console.warn(`clips: transcribing a stretch failed: ${await errorOf(res)}`);
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        console.warn("clips: a stretch couldn't be read:", error?.message ?? error);
      }
      say({ type: "step", step: "transcribing", done: ++done, total: found.length });
    }
  };
  await Promise.all(Array.from({ length: TRANSCRIBE_AT_ONCE }, worker));

  const sent = found.map((window, index) => ({ window, words: heard[index] })).filter((entry) => entry.words?.length);
  if (!sent.length) throw new Refused(spent ? 402 : 422, spent ?? "No speech was heard in the parts of the stream that stood out.");

  say({ type: "step", step: "picking" });
  const base = usual({ seconds, messages, loud });
  const body = {
    stream: { title: video.title, channel: video.channel, game: video.game },
    count: MOMENTS,
    language,
    windows: sent.map(({ window, words }) => {
      const summary = chatSummary(messages, window.start, window.end);
      return {
        length: window.end - window.start,
        words,
        chat: summary.lines,
        chatTotal: summary.total,
        ...reactions(window, { messages, loud, clips }, base),
      };
    }),
  };
  const res = await fetchImpl(env.agentUrl, { method: "POST", headers: onBehalf(req, user, "application/json"), body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Refused(res.status === 429 ? 429 : 502, await errorOf(res));
  const picked = (await res.json())?.moments ?? [];

  const moments = picked.flatMap((moment) => {
    const entry = sent[moment.window];
    if (!entry) return [];
    const start = entry.window.start + moment.start;
    const end = entry.window.start + moment.end;
    // The whole stretch that was heard comes along, so the clip can be made longer or shorter and keep its captions.
    return [{
      start: +start.toFixed(2),
      end: +end.toFixed(2),
      score: moment.score,
      marks: moment.marks,
      title: moment.title,
      caption: moment.caption,
      reason: moment.reason,
      window: { start: entry.window.start, end: entry.window.end },
      words: onTimeline(entry.words, entry.window.start),
    }];
  });
  // Streams without a storyboard get a frame of each moment instead.
  if (!video.storyboard && source.thumbs && moments.length) {
    const frames = await source.thumbs(audio, moments.map((moment) => (moment.start + moment.end) / 2));
    frames.forEach((frame, index) => frame && (moments[index].thumb = frame));
  }
  return { video, moments, ...(spent ? { note: spent } : {}) };
}

function ndjson(res) {
  res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no" });
  return (line) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
  };
}

export async function handleScan(req, res, env, fetchImpl = fetch) {
  if (req.method !== "POST") throw new Refused(405, "Use POST.");
  const user = await userFor(req, env);
  const body = await readJson(req);
  const link = parseLink(body?.link);
  if (!link) throw new Refused(400, "Paste the link to a past broadcast on Twitch, Kick or YouTube, or a channel's link for its latest one.");

  const key = `${user.id}:${link.source}:${link.vod ?? link.channel}`;
  const kept = results.get(key);
  if (kept && kept.until > Date.now() && body.again !== true) {
    const say = ndjson(res);
    say({ type: "video", video: kept.result.video });
    say({ type: "done", ...kept.result });
    res.end();
    return;
  }

  if (scanning.has(user.id)) throw new Refused(409, "You're already finding clips in a stream. Wait for it to finish.");
  limit(`scan:${user.id}`, 12, 3600, "That's a lot of streams for one hour. Try again later.");
  if (scans >= SERVER_SCANS) throw new Refused(503, "Lots of people are finding clips right now. Try again in a minute.");

  scans += 1;
  scanning.add(user.id);
  const abort = new AbortController();
  const stop = () => abort.abort(new Error("The page was closed."));
  res.on("close", stop);
  const say = ndjson(res);
  try {
    const result = await scan(link, { req, user, env, say, language: body.language, fetchImpl, signal: abort.signal });
    if (results.size > 1000) results.clear();
    results.set(key, { result, until: Date.now() + RESULT_HOURS * 3600_000 });
    say({ type: "done", ...result });
  } catch (error) {
    if (!abort.signal.aborted) {
      const known = error instanceof Refused || error instanceof StreamError;
      if (!known) console.error("clips:", error);
      say({ type: "error", status: known ? error.status : 500, error: known ? error.message : "Something went wrong finding clips. Try again." });
    }
  } finally {
    res.off("close", stop);
    scans -= 1;
    scanning.delete(user.id);
    res.end();
  }
}

/**
 * [start, end) of a broadcast as an MP4 cut on the pieces around it; `X-Clip-Offset` is where `start` falls in it.
 * `quality=preview` sends a small picture for watching before choosing.
 */
export async function handleVideo(req, res, env, fetchImpl = fetch) {
  if (req.method !== "GET") throw new Refused(405, "Use GET.");
  const user = await userFor(req, env);
  limit(`video:${user.id}`, 120, 3600, "That's a lot of clips for one hour. Try again later.");
  const query = new URL(req.url, "http://clips").searchParams;
  const vod = query.get("vod") ?? "";
  const start = Number(query.get("start"));
  const end = Number(query.get("end"));
  if (!sourceOfId(vod) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Refused(400, "That stretch of the broadcast can't be read.");
  if (end - start > MAX_CLIP_SECONDS) throw new Refused(400, "A clip can be at most two minutes.");
  const lines = query.get("quality") === "preview" ? PREVIEW_LINES : 1080;

  const dir = await mkdtemp(join(env.tmpDir || tmpdir(), "clip-"));
  const abort = new AbortController();
  const stop = () => abort.abort(new Error("The page was closed."));
  res.on("close", stop);
  try {
    const file = join(dir, "clip.mp4");
    const offset = await writeStretch(vod, start, end, lines, file, {
      fetchImpl,
      env,
      signal: abort.signal,
      remux: (chunks, out) => remux(chunks, out, env.ffmpeg, abort.signal),
    });
    const { size } = await stat(file);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": size,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Clip-Offset": offset.toFixed(3),
      "Access-Control-Expose-Headers": "X-Clip-Offset",
    });
    await new Promise((resolve, reject) => createReadStream(file).on("error", reject).on("end", resolve).pipe(res));
  } finally {
    res.off("close", stop);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Joins the pieces into an ordinary MP4 starting at 0, without re-encoding. */
function remux(chunks, file, ffmpeg = "ffmpeg", signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", "pipe:0", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", "-f", "mp4", file], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    let failed = null;
    const kill = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", kill, { once: true });
    child.on("error", (error) => (failed = error.code === "ENOENT" ? new Error("ffmpeg isn't installed on the server.") : error));
    child.stderr.on("data", (data) => (stderr = (stderr + data).slice(-2000)));
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      signal?.removeEventListener("abort", kill);
      if (failed) reject(failed);
      else if (signal?.aborted) reject(signal.reason);
      else if (code !== 0) reject(new Error(`ffmpeg couldn't join the clip: ${stderr.trim().split("\n").at(-1) ?? code}`));
      else resolve();
    });
    (async () => {
      try {
        for await (const chunk of chunks) if (!child.stdin.write(chunk)) await new Promise((done) => child.stdin.once("drain", done));
      } catch (error) {
        failed ??= error;
        kill();
      } finally {
        child.stdin.end();
      }
    })();
  });
}

export function json(res, status, body) {
  if (res.writableEnded) return;
  if (res.headersSent) {
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(payload);
}
