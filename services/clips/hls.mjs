// HLS playlists as Twitch and Kick (both on Amazon IVS) serve them: a master listing each picture, and
// media playlists of pieces.

const TIMEOUT_MS = 15_000;

export class StreamError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Each picture the master lists, with its height; `base` resolves playlists given relative to it. */
export function parseMaster(text, base) {
  const playlists = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const info = lines[i];
    const url = lines[i + 1]?.trim();
    if (!url || url.startsWith("#")) continue;
    const name = /VIDEO="([^"]+)"/.exec(info)?.[1] ?? "";
    const height = Number(/RESOLUTION=\d+x(\d+)/.exec(info)?.[1]) || 0;
    playlists.push({ name, height, url: base ? new URL(url, base).href : url });
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

export async function readPieces(playlistUrl, fetchImpl = fetch, headers = {}) {
  let res;
  try {
    res = await fetchImpl(playlistUrl, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new StreamError(502, "The stream couldn't be reached. Try again in a moment.");
  }
  if (!res.ok) throw new StreamError(502, `The stream's host answered ${res.status}.`);
  return parsePieces(await res.text(), playlistUrl);
}

/** Pieces covering [from, to). */
export function piecesBetween(pieces, from, to) {
  return pieces.filter((piece) => piece.start < to && piece.start + piece.duration > from);
}

