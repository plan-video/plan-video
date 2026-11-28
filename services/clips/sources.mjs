// One way in for each platform a stream can come from: its broadcast, sound, chat and viewers' picks,
// and stretches of its picture.

import { spawn } from "node:child_process";

import { StreamError, pickVideo, piecesBetween, readPieces } from "./hls.mjs";
import { curlFetch, findKickClips, findKickVideo, kickHeaders, parseKickLink, readKickChat } from "./kick.mjs";
import { findPlaylists, findVideo, findViewerClips, parseTwitchLink, readChat, readStoryboard } from "./twitch.mjs";
import { findYouTubeVideo, heatmapClips, parseYouTubeLink, youtubeAudio, youtubeChat, youtubeStretch } from "./youtube.mjs";
import { pieceBytes } from "./audio.mjs";
import { parseMaster } from "./hls.mjs";

/** The platform and what the link names there, or null. */
export function parseLink(input) {
  const kick = parseKickLink(input);
  if (kick) return { source: "kick", ...kick };
  const youtube = parseYouTubeLink(input);
  if (youtube) return { source: "youtube", ...youtube };
  const twitch = parseTwitchLink(input);
  if (twitch) return { source: "twitch", ...twitch };
  return null;
}

const KICK_ID = /^kick:([0-9a-f-]{36})$/;
const YOUTUBE_ID = /^yt:([A-Za-z0-9_-]{11})$/;

/** A broadcast's id as the browser keeps it: Twitch's number, or "kick:" / "yt:" and the platform's own id. */
export function sourceOfId(id) {
  if (/^\d{6,12}$/.test(id)) return { source: "twitch", vod: id };
  const kick = KICK_ID.exec(id);
  if (kick) return { source: "kick", vod: kick[1] };
  const youtube = YOUTUBE_ID.exec(id);
  if (youtube) return { source: "youtube", vod: youtube[1] };
  return null;
}

/** What the browser is told about a broadcast. */
const shown = ({ id, source, title, seconds, channel, login, game, createdAt, recording }) => ({ id, source, title, seconds, channel, login, game, createdAt, recording });

async function readText(url, fetchImpl, headers) {
  let res;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new StreamError(502, "The stream couldn't be reached. Try again in a moment.");
  }
  if (!res.ok) throw new StreamError(502, `The stream's host answered ${res.status}.`);
  return res.text();
}

/** A frame of each moment, small, for streams with no storyboard: a data URL or nothing. */
async function frameAt(audio, seconds, { fetchImpl, ffmpeg = "ffmpeg", signal }) {
  const piece = audio.pieces?.find((entry) => entry.start <= seconds && entry.start + entry.duration > seconds);
  if (!piece) return null;
  const chunks = [];
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, seconds - piece.start)), "-i", "pipe:0", "-frames:v", "1", "-vf", "scale=256:-2", "-q:v", "6", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"], { stdio: ["pipe", "pipe", "ignore"] });
    child.stdout.on("data", (data) => chunks.push(data));
    child.on("error", reject);
    child.on("close", resolve);
    child.stdin.on("error", () => {});
    (async () => {
      for await (const chunk of pieceBytes(audio.init, [piece], { fetchImpl, signal, headers: audio.headers })) child.stdin.write(chunk);
      child.stdin.end();
    })().catch(() => child.kill("SIGKILL"));
  });
  const jpeg = Buffer.concat(chunks);
  return jpeg.length ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : null;
}

/**
 * Opens a broadcast for a scan. `dir` is somewhere to keep downloads while it runs. The result's
 * `video` is safe to send; the rest reads the stream.
 */
export async function openSource(link, { fetchImpl = fetch, env = {}, dir, signal }) {
  if (link.source === "kick") {
    const ask = env.kickFetch ?? curlFetch;
    const video = await findKickVideo(link, ask);
    const lists = parseMaster(await readText(video.master, fetchImpl, kickHeaders), video.master);
    // Kick has no sound-only rendition; its smallest picture is the next lightest thing.
    const smallest = lists.filter((entry) => entry.height > 0).sort((a, b) => a.height - b.height)[0];
    if (!smallest) throw new StreamError(502, "Kick didn't offer that broadcast's sound.");
    return {
      video: { ...shown(video), storyboard: null },
      audio: async () => ({ ...(await readPieces(smallest.url, fetchImpl, kickHeaders)), headers: kickHeaders }),
      chat: () => readKickChat(video, { fetchImpl: ask }),
      clips: () => findKickClips(video, ask),
      thumbs: (audio, times) => Promise.all(times.map((time) => frameAt(audio, time, { fetchImpl, ffmpeg: env.ffmpeg, signal }).catch(() => null))),
    };
  }
  if (link.source === "youtube") {
    const video = await findYouTubeVideo(link, env, signal);
    return {
      video: { ...shown(video), storyboard: video.storyboard },
      audio: async () => ({ file: await youtubeAudio(video.videoId, dir, env, signal) }),
      chat: () => (video.hasChat ? youtubeChat(video.videoId, dir, env, signal) : Promise.resolve([])),
      clips: async () => heatmapClips(video.heatmap),
    };
  }
  const video = await findVideo(link, fetchImpl);
  const { previews, ...rest } = video;
  const lists = await findPlaylists(video.id, fetchImpl);
  const audioList = lists.find((entry) => entry.name === "audio_only");
  if (!audioList) throw new StreamError(502, "Twitch didn't offer that broadcast's sound.");
  const storyboard = await readStoryboard(previews, fetchImpl);
  return {
    video: { ...shown({ ...rest, source: "twitch" }), storyboard },
    audio: () => readPieces(audioList.url, fetchImpl),
    chat: (seconds) => readChat(video.id, seconds, { fetchImpl }),
    clips: () => findViewerClips(video.id, fetchImpl),
  };
}

/** The HLS pieces covering [start, end) at up to `lines` tall, for Twitch and Kick. */
async function hlsStretch(lists, start, end, lines, fetchImpl, headers) {
  const picture = pickVideo(lists, lines);
  if (!picture) throw new StreamError(502, "The stream didn't offer its picture.");
  const { init, pieces } = await readPieces(picture.url, fetchImpl, headers);
  const wanted = piecesBetween(pieces, start, end);
  if (!wanted.length) throw new StreamError(416, "That stretch is past the end of the broadcast.");
  return { chunks: pieceBytes(init, wanted, { fetchImpl, headers }), offset: start - wanted[0].start };
}

const playlists = new Map();

async function cachedLists(key, read) {
  const kept = playlists.get(key);
  if (kept && kept.until > Date.now()) return kept.lists;
  const lists = await read();
  if (playlists.size > 500) playlists.clear();
  playlists.set(key, { lists, until: Date.now() + 10 * 60_000 });
  return lists;
}

/**
 * Writes [start, end) of broadcast `id` to `out` as an MP4 starting at 0, and returns where `start`
 * falls in it. `remux` joins HLS pieces into the file without re-encoding.
 */
export async function writeStretch(id, start, end, lines, out, { fetchImpl = fetch, env = {}, remux, signal }) {
  const which = sourceOfId(id);
  if (!which) throw new StreamError(400, "That broadcast can't be read.");
  if (which.source === "youtube") return youtubeStretch(which.vod, start, end, lines, out, env, signal);
  let lists;
  let headers;
  if (which.source === "kick") {
    headers = kickHeaders;
    lists = await cachedLists(id, async () => {
      const video = await findKickVideo({ vod: which.vod }, env.kickFetch ?? curlFetch);
      return parseMaster(await readText(video.master, fetchImpl, kickHeaders), video.master);
    });
  } else lists = await cachedLists(id, () => findPlaylists(which.vod, fetchImpl));
  const { chunks, offset } = await hlsStretch(lists, start, end, lines, fetchImpl, headers);
  await remux(chunks, out);
  return offset;
}
