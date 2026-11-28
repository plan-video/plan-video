// Reads public Twitch broadcasts the way twitch.tv's own player does, so no Twitch app or keys are needed.
// None of this is an official API: Twitch can change it, and the errors say so in plain words.

const GQL = "https://gql.twitch.tv/gql";
// twitch.tv's own web client id, the one its player sends without a login.
const WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const COMMENTS_QUERY = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a";
const TIMEOUT_MS = 15_000;
const EMPTY_RETRIES = 3;
const EMPTY_SKIP = 30;

export class TwitchError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const LOGIN = /^[a-zA-Z0-9_]{2,25}$/;
const NOT_CHANNELS = new Set(["videos", "directory", "settings", "downloads", "jobs", "p", "search", "subscriptions", "inventory", "wallet", "drops", "turbo", "prime"]);

/** `{ vod }` for a past broadcast, `{ channel }` for a channel's latest one, or null. */
export function parseTwitchLink(input) {
  const text = String(input ?? "").trim();
  if (/^\d{6,12}$/.test(text)) return { vod: text };
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/^(www\.|m\.)?twitch\.tv$/i.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "videos" && /^\d{6,12}$/.test(parts[1] ?? "")) return { vod: parts[1] };
  if (parts.length >= 3 && parts[1] === "v" && /^\d{6,12}$/.test(parts[2])) return { vod: parts[2] };
  if (parts.length === 1 && LOGIN.test(parts[0]) && !NOT_CHANNELS.has(parts[0].toLowerCase())) return { channel: parts[0].toLowerCase() };
  if (parts.length === 2 && parts[1] === "videos" && LOGIN.test(parts[0])) return { channel: parts[0].toLowerCase() };
  return null;
}

async function gql(body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(GQL, {
      method: "POST",
      headers: { "Client-ID": WEB_CLIENT_ID, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new TwitchError(502, "Twitch couldn't be reached. Try again in a moment.");
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok || !payload) throw new TwitchError(502, `Twitch answered ${res.status}. Try again in a moment.`);
  return payload;
}

const VIDEO_FIELDS = "id title lengthSeconds status broadcastType createdAt seekPreviewsURL owner { login displayName } game { name }";

function toVideo(video) {
  if (!video?.id) return null;
  return {
    id: String(video.id),
    title: String(video.title ?? ""),
    seconds: Number(video.lengthSeconds) || 0,
    channel: video.owner?.displayName || video.owner?.login || "",
    login: video.owner?.login || "",
    game: video.game?.name || "",
    createdAt: video.createdAt || null,
    recording: video.status === "RECORDING",
    previews: typeof video.seekPreviewsURL === "string" ? video.seekPreviewsURL : null,
  };
}

/**
 * Twitch's seek-bar storyboard: sheets of small frames, one every `interval` seconds. The sharper set is
 * picked; null when the broadcast has none.
 */
export function parseStoryboard(list, infoUrl) {
  const sets = Array.isArray(list) ? list : [];
  const set = sets.find((entry) => entry?.quality === "high") ?? sets[0];
  if (!set || !Array.isArray(set.images) || !set.images.length) return null;
  const numbers = ["width", "height", "cols", "rows", "interval", "count"].map((key) => Number(set[key]));
  if (numbers.some((value) => !(value > 0))) return null;
  const [width, height, cols, rows, interval, count] = numbers;
  const base = infoUrl.slice(0, infoUrl.lastIndexOf("/") + 1);
  return { images: set.images.map((name) => new URL(String(name), base).href), width, height, cols, rows, interval, count };
}

export async function readStoryboard(infoUrl, fetchImpl = fetch) {
  if (!infoUrl) return null;
  try {
    const res = await fetchImpl(infoUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? parseStoryboard(await res.json(), infoUrl) : null;
  } catch {
    return null;
  }
}

export async function findVideo(link, fetchImpl = fetch) {
  if (link.vod) {
    const payload = await gql({ query: `{ video(id: ${JSON.stringify(link.vod)}) { ${VIDEO_FIELDS} } }` }, fetchImpl);
    const video = toVideo(payload.data?.video);
    if (!video) throw new TwitchError(404, "That broadcast isn't on Twitch any more, or it's private.");
    return video;
  }
  const payload = await gql(
    { query: `{ user(login: ${JSON.stringify(link.channel)}) { videos(first: 1, type: ARCHIVE, sort: TIME) { edges { node { ${VIDEO_FIELDS} } } } } }` },
    fetchImpl,
  );
  const user = payload.data?.user;
  if (!user) throw new TwitchError(404, "There's no Twitch channel with that name.");
  const video = toVideo(user.videos?.edges?.[0]?.node);
  if (!video) throw new TwitchError(404, "That channel has no past broadcasts. Twitch only keeps them if the streamer turns that on.");
  return video;
}

/** The broadcast's playlists by name ("audio_only", "1080p60"…), with each's height. */
export async function findPlaylists(vod, fetchImpl = fetch) {
  const payload = await gql(
    {
      query: `{ videoPlaybackAccessToken(id: ${JSON.stringify(vod)}, params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) { value signature } }`,
    },
    fetchImpl,
  );
  const token = payload.data?.videoPlaybackAccessToken;
  if (!token?.value) throw new TwitchError(404, "That broadcast can't be played.");
  try {
    if (JSON.parse(token.value)?.authorization?.forbidden) throw new TwitchError(403, "That broadcast is for subscribers only.");
  } catch (error) {
    if (error instanceof TwitchError) throw error;
  }
  const query = new URLSearchParams({ nauth: token.value, nauthsig: token.signature, allow_source: "true", allow_audio_only: "true", player: "twitchweb" });
  let res;
  try {
    res = await fetchImpl(`https://usher.ttvnw.net/vod/${vod}.m3u8?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new TwitchError(502, "Twitch couldn't be reached. Try again in a moment.");
  }
  if (res.status === 403) throw new TwitchError(403, "That broadcast is for subscribers only.");
  if (!res.ok) throw new TwitchError(502, `Twitch answered ${res.status} for the broadcast.`);
  return parseMaster(await res.text());
}

export function parseMaster(text) {
  const playlists = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const info = lines[i];
    const url = lines[i + 1]?.trim();
    if (!url || url.startsWith("#")) continue;
    const name = /VIDEO="([^"]+)"/.exec(info)?.[1] ?? "";
    const height = Number(/RESOLUTION=\d+x(\d+)/.exec(info)?.[1]) || 0;
    playlists.push({ name, height, url });
  }
  return playlists;
}

/** The sharpest picture up to `lines` tall, or the smallest above it. */
export function pickVideo(playlists, lines = 1080) {
  const videos = playlists.filter((entry) => entry.name !== "audio_only" && entry.height > 0);
  const fits = videos.filter((entry) => entry.height <= lines).sort((a, b) => b.height - a.height);
  return fits[0] ?? videos.sort((a, b) => a.height - b.height)[0] ?? null;
}

/** Pieces in order, with their place in the broadcast. Twitch names a piece it silenced for music `N-muted.mp4`. */
export function parsePieces(text, playlistUrl) {
  const base = playlistUrl.slice(0, playlistUrl.lastIndexOf("/") + 1);
  const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(text)?.[1];
  const pieces = [];
  let at = 0;
  let duration = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) duration = Number.parseFloat(line.slice(8));
    else if (line && !line.startsWith("#") && duration !== null) {
      pieces.push({ url: new URL(line, base).href, start: at, duration, muted: /-muted\.\w+$/.test(line) });
      at += duration;
      duration = null;
    }
  }
  return { init: init ? new URL(init, base).href : null, pieces, seconds: at };
}

export async function readPieces(playlistUrl, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(playlistUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new TwitchError(502, "Twitch couldn't be reached. Try again in a moment.");
  }
  if (!res.ok) throw new TwitchError(502, `Twitch answered ${res.status} for the broadcast.`);
  return parsePieces(await res.text(), playlistUrl);
}

/** Pieces covering [from, to). */
export function piecesBetween(pieces, from, to) {
  return pieces.filter((piece) => piece.start < to && piece.start + piece.duration > from);
}

/** Viewers' clips of this broadcast: their stretch of it, title and views. */
export async function findViewerClips(vod, fetchImpl = fetch) {
  const payload = await gql(
    { query: `{ video(id: ${JSON.stringify(vod)}) { clips(first: 100) { edges { node { title viewCount durationSeconds videoOffsetSeconds } } } } }` },
    fetchImpl,
  );
  return (payload.data?.video?.clips?.edges ?? []).flatMap(({ node }) => {
    const start = Number(node?.videoOffsetSeconds);
    const duration = Number(node?.durationSeconds);
    if (!Number.isFinite(start) || !(duration > 0)) return [];
    return [{ start, duration, views: Number(node.viewCount) || 0, title: String(node.title ?? "").slice(0, 120) }];
  });
}

async function commentsAt(vod, offset, fetchImpl) {
  const payload = await gql(
    [{ operationName: "VideoCommentsByOffsetOrCursor", variables: { videoID: vod, contentOffsetSeconds: offset }, extensions: { persistedQuery: { version: 1, sha256Hash: COMMENTS_QUERY } } }],
    fetchImpl,
  );
  const comments = payload?.[0]?.data?.video?.comments;
  return (comments?.edges ?? []).map(({ node }) => ({
    id: node?.id,
    t: Number(node?.contentOffsetSeconds) || 0,
    text: (node?.message?.fragments ?? []).map((part) => part?.text ?? "").join("").slice(0, 200),
  }));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Chat replay for [from, to). Twitch locks paging by cursor, so each request asks again from the last
 * message's second; a second with more messages than one page holds keeps only that page's. A busy
 * Twitch answers some requests with an empty page, so an empty one is asked again before moving on.
 */
async function chatBetween(vod, from, to, fetchImpl, pause) {
  const seen = new Set();
  const messages = [];
  let at = from;
  while (at < to) {
    let page = await commentsAt(vod, at, fetchImpl);
    for (let retry = 0; !page.length && retry < EMPTY_RETRIES; retry++) {
      await pause(500 * 2 ** retry);
      page = await commentsAt(vod, at, fetchImpl);
    }
    if (!page.length) {
      at += EMPTY_SKIP;
      continue;
    }
    let last = at;
    let fresh = 0;
    for (const message of page) {
      if (message.t >= to) break;
      // Twitch's page starts a little before the second asked for, which the stretch before this one read.
      if (message.t < from) continue;
      last = Math.max(last, message.t);
      if (!message.id || seen.has(message.id)) continue;
      seen.add(message.id);
      fresh += 1;
      messages.push({ t: message.t, text: message.text });
    }
    if (page.at(-1).t >= to) break;
    at = fresh && last > at ? last : at + 1;
  }
  return messages;
}

/** The whole broadcast's chat, read in `parts` stretches at once. */
export async function readChat(vod, seconds, { parts = 4, fetchImpl = fetch, pause = wait } = {}) {
  const size = Math.ceil(seconds / parts);
  const stretches = Array.from({ length: parts }, (_, i) => [i * size, Math.min(seconds, (i + 1) * size)]).filter(([a, b]) => b > a);
  const results = await Promise.all(stretches.map(([a, b]) => chatBetween(vod, a, b, fetchImpl, pause)));
  return results.flat().sort((a, b) => a.t - b.t);
}
