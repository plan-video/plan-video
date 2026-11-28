// Reads public YouTube videos and past livestreams with yt-dlp, which keeps up with YouTube's changes;
// update it on the server now and then. A server YouTube asks to sign in can be given a cookies file.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { pieceBytes } from "./audio.mjs";
import { StreamError, parsePieces, piecesBetween } from "./hls.mjs";

const ID = /^[A-Za-z0-9_-]{11}$/;
const INFO_MINUTES = 30;
const infos = new Map();

/** `{ vod }` for a video, `{ channel }` (a path such as "@name") for a channel's latest stream, or null. */
export function parseYouTubeLink(input) {
  const text = String(input ?? "").trim();
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") return ID.test(parts[0] ?? "") ? { vod: parts[0] } : null;
  if (host !== "youtube.com") return null;
  const watched = url.searchParams.get("v");
  if (parts[0] === "watch" && ID.test(watched ?? "")) return { vod: watched };
  if (["live", "embed", "shorts", "v"].includes(parts[0]) && ID.test(parts[1] ?? "")) return { vod: parts[1] };
  if (parts[0]?.startsWith("@") && parts[0].length > 1) return { channel: parts[0] };
  if ((parts[0] === "channel" || parts[0] === "c" || parts[0] === "user") && parts[1]) return { channel: `${parts[0]}/${parts[1]}` };
  return null;
}

function run(command, args, { timeout = 120_000, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const kill = () => child.kill("SIGKILL");
    const timer = setTimeout(kill, timeout);
    signal?.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (data) => (out += data));
    child.stderr.on("data", (data) => (err = (err + data).slice(-4000)));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error.code === "ENOENT" ? new StreamError(503, `${command} isn't installed on the server.`) : error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      if (signal?.aborted) reject(signal.reason ?? new Error("Stopped."));
      else if (code === 0) resolve(out);
      else reject(refusal(err));
    });
  });
}

/** yt-dlp's complaint in words a person can act on. */
export function refusal(stderr) {
  const text = String(stderr);
  if (/confirm your age|age-restricted/i.test(text)) return new StreamError(403, "That video is age-restricted, so it can't be read without a YouTube sign-in.");
  if (/members-only|join this channel|members only/i.test(text)) return new StreamError(403, "That video is for channel members only.");
  if (/private video/i.test(text)) return new StreamError(404, "That video is private.");
  if (/not a bot|sign in to confirm/i.test(text)) return new StreamError(503, "YouTube asked this server to sign in. Try again later.");
  if (/will begin|is live|live event/i.test(text)) return new StreamError(422, "That stream is still live. Try again once it has ended.");
  if (/unavailable|does not exist|not found|404/i.test(text)) return new StreamError(404, "That video isn't on YouTube any more.");
  return new StreamError(502, "YouTube couldn't be read. Try again in a moment.");
}

// The service has no home folder for yt-dlp's cache.
const ytArgs = (env) => ["--no-update", "--no-warnings", "--no-cache-dir", ...(env.ytdlpCookies ? ["--cookies", env.ytdlpCookies] : [])];

async function info(id, env, signal) {
  const kept = infos.get(id);
  if (kept && kept.until > Date.now()) return kept.info;
  const text = await run(env.ytdlp || "yt-dlp", [...ytArgs(env), "-J", "--no-playlist", `https://www.youtube.com/watch?v=${id}`], { timeout: 60_000, signal });
  const parsed = JSON.parse(text);
  if (infos.size > 200) infos.clear();
  infos.set(id, { info: parsed, until: Date.now() + INFO_MINUTES * 60_000 });
  return parsed;
}

/** YouTube's seek-bar sheets as the browser shows them: the sharpest set that has them. */
export function youtubeStoryboard(formats) {
  const sheets = (Array.isArray(formats) ? formats : [])
    .filter((format) => /^sb\d$/.test(format?.format_id ?? "") && Array.isArray(format.fragments) && format.fragments.length)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const set = sheets.find((format) => (format.width ?? 0) <= 160) ?? sheets[0];
  if (!set) return null;
  const cols = Number(set.columns);
  const rows = Number(set.rows);
  const first = Number(set.fragments[0]?.duration);
  if (!(cols > 0 && rows > 0 && first > 0)) return null;
  const interval = first / (cols * rows);
  const images = set.fragments.map((fragment) => String(fragment.url ?? "")).filter(Boolean);
  return { images, width: Number(set.width) || 160, height: Number(set.height) || 90, cols, rows, interval, count: images.length * cols * rows };
}

/** "Most replayed" peaks as if viewers had clipped them, the busiest first. */
export function heatmapClips(heatmap) {
  return (Array.isArray(heatmap) ? heatmap : [])
    .filter((point) => Number.isFinite(point?.start_time) && Number.isFinite(point?.end_time) && point.value > 0.35)
    .sort((a, b) => b.value - a.value)
    .slice(0, 15)
    .map((point) => ({ start: point.start_time, duration: Math.max(5, point.end_time - point.start_time), views: Math.round(point.value * 10_000), title: "" }));
}

async function latest(channel, env, signal) {
  const text = await run(env.ytdlp || "yt-dlp", [...ytArgs(env), "--flat-playlist", "-I", "1:15", "--print", "%(id)s %(live_status)s", `https://www.youtube.com/${channel}/streams`], { timeout: 60_000, signal }).catch(() => "");
  const rows = text.split("\n").map((line) => line.trim().split(" ")).filter(([id]) => ID.test(id ?? ""));
  const done = rows.find(([, status]) => status === "was_live" || status === "not_live");
  if (!done) throw new StreamError(404, "That channel has no past livestreams on YouTube.");
  return done[0];
}

export async function findYouTubeVideo(link, env, signal) {
  const id = link.vod ?? (await latest(link.channel, env, signal));
  const data = await info(id, env, signal);
  if (data.is_live || data.live_status === "is_live" || data.live_status === "is_upcoming") throw new StreamError(422, "That stream is still live. Try again once it has ended.");
  const stamp = Number(data.release_timestamp ?? data.timestamp);
  return {
    id: `yt:${id}`,
    source: "youtube",
    title: String(data.title ?? ""),
    seconds: Math.round(Number(data.duration) || 0),
    channel: String(data.channel ?? data.uploader ?? ""),
    login: String(data.uploader_id ?? data.channel_id ?? ""),
    game: String(data.categories?.[0] ?? ""),
    createdAt: Number.isFinite(stamp) ? new Date(stamp * 1000).toISOString() : null,
    recording: false,
    storyboard: youtubeStoryboard(data.formats),
    heatmap: data.heatmap ?? null,
    hasChat: !!data.subtitles?.live_chat,
    videoId: id,
  };
}

/** The whole soundtrack, small, into `dir`; returns its path. */
export async function youtubeAudio(id, dir, env, signal) {
  const out = await run(
    env.ytdlp || "yt-dlp",
    [...ytArgs(env), "-q", "-f", "139/140/bestaudio[ext=m4a]/bestaudio", "-N", "8", "-o", join(dir, "audio.%(ext)s"), "--print", "after_move:filepath", "--no-simulate", `https://www.youtube.com/watch?v=${id}`],
    { timeout: 900_000, signal },
  );
  const path = out.trim().split("\n").pop();
  if (!path) throw new StreamError(502, "YouTube didn't send the video's sound.");
  return path;
}

/** One line of yt-dlp's live chat file as a message, or null. */
export function chatLine(line) {
  let item;
  try {
    item = JSON.parse(line);
  } catch {
    return null;
  }
  const action = item?.replayChatItemAction;
  const t = Number(action?.videoOffsetTimeMsec) / 1000;
  if (!Number.isFinite(t)) return null;
  for (const entry of action.actions ?? []) {
    const renderer = entry?.addChatItemAction?.item?.liveChatTextMessageRenderer;
    if (!renderer) continue;
    const text = (renderer.message?.runs ?? []).map((run) => run.text ?? run.emoji?.shortcuts?.[0] ?? "").join("").slice(0, 200);
    if (text) return { t, text };
  }
  return null;
}

/** Chat replay, when the video was a livestream that kept it. */
export async function youtubeChat(id, dir, env, signal) {
  const base = join(dir, "chat");
  try {
    await run(env.ytdlp || "yt-dlp", [...ytArgs(env), "-q", "--skip-download", "--write-subs", "--sub-langs", "live_chat", "-o", base, `https://www.youtube.com/watch?v=${id}`], { timeout: 600_000, signal });
    const text = await readFile(`${base}.live_chat.json`, "utf8");
    return text.split("\n").map(chatLine).filter(Boolean);
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  } finally {
    await rm(`${base}.live_chat.json`, { force: true }).catch(() => {});
  }
}

/**
 * YouTube's HLS renditions: the sharpest H.264 picture up to `lines` tall and the best sound. They come in
 * six-second pieces whose lists line up, so a stretch is read piece by piece like Twitch's.
 */
export function youtubeRenditions(formats, lines) {
  const list = (Array.isArray(formats) ? formats : []).filter((format) => format?.protocol === "m3u8_native" && format.url);
  const picture = list
    .filter((format) => String(format.vcodec ?? "").startsWith("avc1") && (format.height ?? 0) <= lines)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0))[0];
  const sound = list.filter((format) => format.vcodec === "none" || !format.vcodec).sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))[0];
  return picture && sound ? { picture, sound } : null;
}

async function piecesOf(format, signal) {
  const res = await fetch(format.url, { headers: format.http_headers, signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]) }).catch(() => null);
  if (!res?.ok) throw new StreamError(502, "YouTube didn't send that video's picture.");
  return parsePieces(await res.text(), format.url).pieces;
}

async function writePieces(pieces, file, headers, signal) {
  const out = createWriteStream(file);
  try {
    for await (const chunk of pieceBytes(null, pieces, { signal, headers })) if (!out.write(chunk)) await new Promise((done) => out.once("drain", done));
  } finally {
    await new Promise((done) => out.end(done));
  }
}

/** [start, end) as an MP4 at `out`, without re-encoding; returns where `start` falls in it. */
export async function youtubeStretch(id, start, end, lines, out, env, signal) {
  const data = await info(id, env, signal);
  const chosen = youtubeRenditions(data.formats, lines);
  if (!chosen) throw new StreamError(502, "YouTube didn't offer that video's picture.");
  const [pictures, sounds] = await Promise.all([piecesOf(chosen.picture, signal), piecesOf(chosen.sound, signal)]);
  const wanted = piecesBetween(pictures, start, end);
  if (!wanted.length) throw new StreamError(416, "That stretch is past the end of the video.");
  const first = wanted[0].start;
  const heard = sounds.filter((piece) => piece.start >= first - 0.01 && piece.start < wanted[wanted.length - 1].start + wanted[wanted.length - 1].duration - 0.01);
  const picture = `${out}.picture.ts`;
  const sound = `${out}.sound.aac`;
  try {
    await Promise.all([writePieces(wanted, picture, chosen.picture.http_headers, signal), writePieces(heard, sound, chosen.sound.http_headers, signal)]);
    await run(env.ffmpeg || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", picture, "-i", sound, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", "-f", "mp4", out], { timeout: 120_000, signal });
    return start - first;
  } finally {
    await Promise.all([rm(picture, { force: true }), rm(sound, { force: true })]).catch(() => {});
  }
}
