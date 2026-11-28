// Reads public Kick broadcasts through kick.com's own API, the one its site uses; no keys needed.
// Kick's video is Amazon IVS, the same HLS as Twitch's, so the pieces are read the same way.

import { spawn } from "node:child_process";

import { StreamError } from "./hls.mjs";

const SITE = "https://kick.com";
const TIMEOUT_MS = 15_000;
// kick.com answers browsers; a bare client is often turned away by its firewall.
const HEADERS = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-zA-Z0-9_-]{2,30}$/;
const NOT_CHANNELS = new Set(["video", "videos", "categories", "category", "browse", "following", "search", "dashboard", "clips", "terms", "privacy"]);
/** When chat is busy, one page a this-many-seconds stretch stands for it, longer streams spreading wider. */
const CHAT_STEP = 20;
/** Kick slows down a client that asks much more than this for one broadcast. */
const CHAT_PAGES = 150;
const CHAT_AT_ONCE = 4;
const BUSY_TRIES = 4;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `{ vod }` for a past broadcast (its uuid), `{ channel }` for a channel's latest, or null. */
export function parseKickLink(input) {
  let url;
  try {
    const text = String(input ?? "").trim();
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/^(www\.)?kick\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const uuid = parts.find((part) => UUID.test(part));
  if (uuid && (parts[0] === "video" || parts[1] === "videos")) return { vod: uuid.toLowerCase() };
  if (parts.length === 1 && SLUG.test(parts[0]) && !NOT_CHANNELS.has(parts[0].toLowerCase())) return { channel: parts[0].toLowerCase() };
  if (parts.length === 2 && parts[1] === "videos" && SLUG.test(parts[0])) return { channel: parts[0].toLowerCase() };
  return null;
}

/**
 * kick.com's firewall turns away Node's own HTTP client by how it connects, but lets curl through, so
 * its API is asked with curl. Answers like fetch, as far as this file uses it.
 */
export function curlFetch(url, { headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-s", "--compressed", "--max-time", String(TIMEOUT_MS / 1000), "-w", "\n%{http_code}"];
    for (const [name, value] of Object.entries(headers)) args.push("-H", `${name}: ${value}`);
    const child = spawn("curl", [...args, url], { stdio: ["ignore", "pipe", "ignore"] });
    const kill = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", kill, { once: true });
    let out = "";
    child.stdout.on("data", (data) => (out += data));
    child.on("error", (error) => reject(error.code === "ENOENT" ? new StreamError(503, "curl isn't installed on the server.") : error));
    child.on("close", () => {
      signal?.removeEventListener("abort", kill);
      const cut = out.lastIndexOf("\n");
      const status = Number(out.slice(cut + 1)) || 0;
      const body = out.slice(0, Math.max(0, cut));
      resolve({ ok: status >= 200 && status < 300, status, text: async () => body, json: async () => JSON.parse(body) });
    });
  });
}

/** kick.com's JSON at `path`; null when it isn't there. A "slow down" is waited out a few times. */
async function kickJson(path, fetchImpl, pause = wait) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(`${SITE}${path}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new StreamError(502, "Kick couldn't be reached. Try again in a moment.");
    }
    if (res.status === 429 && attempt < BUSY_TRIES) {
      await pause(1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 429) throw new StreamError(503, "Kick is busy. Try again in a few minutes.");
    if (!res.ok) throw new StreamError(502, `Kick answered ${res.status}. Try again in a moment.`);
    return res.json().catch(() => null);
  }
}

/** Kick writes an emote as `[emote:123:name]`; the name is what people mean by it. */
export const chatText = (content) => String(content ?? "").replace(/\[emote:\d+:([^\]]+)\]/g, "$1").slice(0, 200);

const toTime = (value) => {
  const ms = Date.parse(String(value ?? "").replace(" ", "T").replace(/(T[\d:.]+)$/, "$1Z"));
  return Number.isFinite(ms) ? ms : null;
};

/** The broadcast, with what the scan needs to read it. */
export async function findKickVideo(link, fetchImpl = curlFetch) {
  let uuid = link.vod;
  if (!uuid) {
    const list = await kickJson(`/api/v2/channels/${encodeURIComponent(link.channel)}/videos`, fetchImpl);
    if (!Array.isArray(list)) throw new StreamError(404, "There's no Kick channel with that name.");
    const latest = list.find((entry) => entry?.video?.uuid && !entry.is_live);
    if (!latest) throw new StreamError(404, "That channel has no past broadcasts on Kick.");
    uuid = latest.video.uuid;
  }
  const video = await kickJson(`/api/v1/video/${encodeURIComponent(uuid)}`, fetchImpl);
  const stream = video?.livestream;
  if (!video?.source || !stream) throw new StreamError(404, "That broadcast isn't on Kick any more, or it's private.");
  const channel = stream.channel ?? {};
  const started = toTime(stream.start_time) ?? toTime(stream.created_at);
  return {
    id: `kick:${String(video.uuid ?? uuid).toLowerCase()}`,
    source: "kick",
    title: String(stream.session_title ?? ""),
    seconds: Math.round((Number(stream.duration) || 0) / 1000),
    channel: channel.user?.username || channel.slug || "",
    login: channel.slug || "",
    game: stream.categories?.[0]?.name || "",
    createdAt: started ? new Date(started).toISOString() : null,
    recording: !!stream.is_live,
    // For the scan, not the browser.
    master: String(video.source),
    channelId: channel.id ?? stream.channel_id ?? null,
    livestreamId: stream.id ?? null,
    startedAt: started,
  };
}

/**
 * Chat by time from Kick's history, which comes about sixteen messages a page. Every page is read while
 * chat is quiet; when a page covers less than `CHAT_STEP` seconds the rest of that stretch is skipped,
 * and its messages weigh for the whole stretch so busy stretches still read as busy.
 */
export async function readKickChat(video, { fetchImpl = curlFetch, step = CHAT_STEP, atOnce = CHAT_AT_ONCE, pause = wait } = {}) {
  if (video.channelId === null || video.startedAt === null || !video.seconds) return [];
  step = Math.max(step, Math.ceil(video.seconds / CHAT_PAGES));
  const stretches = [];
  const part = Math.ceil(video.seconds / atOnce);
  for (let from = 0; from < video.seconds; from += part) stretches.push([from, Math.min(video.seconds, from + part)]);
  const read = async ([from, to]) => {
    const out = [];
    let at = from;
    let quiet = 0;
    while (at < to && quiet < 3) {
      const when = new Date(video.startedAt + at * 1000).toISOString();
      let page;
      try {
        page = await kickJson(`/api/v2/channels/${video.channelId}/messages?start_time=${encodeURIComponent(when)}`, fetchImpl, pause);
      } catch {
        quiet += 1;
        at += step;
        continue;
      }
      const answered = (page?.data?.messages ?? []).flatMap((message) => {
        const ms = toTime(message?.created_at);
        return ms === null ? [] : [{ t: (ms - video.startedAt) / 1000, text: chatText(message.content) }];
      });
      const messages = answered.filter((message) => message.t >= at && message.t < to);
      // A page that runs past the stretch read it to the end: what's left of it was all there was.
      if (answered.some((message) => message.t >= to)) {
        out.push(...messages);
        break;
      }
      if (!messages.length) {
        at += step;
        continue;
      }
      const last = messages[messages.length - 1].t;
      const covered = Math.max(1, last - at);
      const next = Math.max(last + 0.5, at + step);
      const weight = (next - at) / covered;
      for (const message of messages) out.push(weight > 1.05 ? { ...message, weight } : message);
      at = next;
    }
    return out;
  };
  const results = await Promise.all(stretches.map(read));
  return results.flat().sort((a, b) => a.t - b.t);
}

/**
 * Viewers' clips of this broadcast. Kick gives a clip's start in the broadcast only sometimes, so a
 * clip's end is taken from when it was made.
 */
export async function findKickClips(video, fetchImpl = curlFetch) {
  if (!video.login || video.livestreamId === null) return [];
  const page = await kickJson(`/api/v2/channels/${encodeURIComponent(video.login)}/clips?sort=view&time=all`, fetchImpl).catch(() => null);
  return (page?.clips ?? []).flatMap((clip) => {
    if (String(clip?.livestream_id) !== String(video.livestreamId)) return [];
    const duration = Number(clip.duration) || 0;
    if (!(duration > 0)) return [];
    let start = Number(clip.vod_starts_at) || 0;
    if (!start && video.startedAt !== null) {
      const made = toTime(clip.created_at);
      if (made !== null) start = (made - video.startedAt) / 1000 - duration;
    }
    if (!(start > 0) || start > video.seconds) return [];
    return [{ start, duration, views: Number(clip.views ?? clip.view_count) || 0, title: String(clip.title ?? "").slice(0, 120) }];
  });
}

export const kickHeaders = HEADERS;
