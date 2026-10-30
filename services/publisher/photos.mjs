// Pictures for TikTok photo posts. TikTok takes photos only by pulling them
// from links on a domain verified for the app, so the publisher hands it links
// to itself, under /api/publisher/photo/, which serve a post's picture from
// cloud storage the way TikTok takes it: an upright JPEG, 1080p at most.
// Instagram, Threads and Facebook pull pictures the same way, and Instagram
// and Threads pull videos too, from /api/publisher/video/, as they are.
// Instagram's feed turns down a picture taller than 4:5 or wider than 1.91:1,
// so its links, under /api/publisher/photo/feed/, crop one into that range.
//
// A link names the account and the file, stops working after two hours (a
// video's after a day, as Instagram may fetch it again while it works on it),
// and is signed with the server's key, so nobody can make one for another file.

import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";

export const PHOTO_PATH = "/api/publisher/photo/";
export const VIDEO_PATH = "/api/publisher/video/";
/** Meta works on a video for a while, and fetches it while it does. */
const VIDEO_LINK_MS = 24 * 60 * 60_000;
/** TikTok pulls a post's pictures within an hour of starting it. */
const LINK_MS = 2 * 60 * 60_000;
const ID = /^[A-Za-z0-9_-]{1,100}$/;
/** Pictures made at once. A large one takes a few hundred MB while it's worked on. */
const AT_ONCE = 2;
/** The most pixels a picture may have: above any phone camera's 48 to 50 MP, and well under sharp's own limit, so two at once fit in the publisher's memory. */
const PIXEL_LIMIT = 100_000_000;
const LIMITS = { limitInputPixels: PIXEL_LIMIT };

let sharp;

/** sharp, if it's installed. It works each picture on one thread, as a thread holds lines of a wide picture at a time. Pictures are made AT_ONCE at a time anyway. */
async function loadSharp() {
  sharp ??= await import("sharp")
    .then((module) => {
      module.default.concurrency(1);
      return module.default;
    })
    .catch(() => null);
  return sharp;
}

/** A picture as TikTok takes it: upright, a JPEG, and no bigger than 1080 by 1920 either way round. */
export async function forTikTok(bytes) {
  if (!(await loadSharp())) return null;
  const meta = await sharp(bytes, LIMITS).metadata();
  // Orientations 5 to 8 lie on their side, so width and height swap once it's upright.
  const sideways = (meta.orientation ?? 1) >= 5;
  const wide = (sideways ? meta.height : meta.width) > (sideways ? meta.width : meta.height);
  return sharp(bytes, LIMITS)
    .rotate()
    .resize({ width: wide ? 1920 : 1080, height: wide ? 1080 : 1920, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** The tallest and the widest an Instagram feed picture can be, a little inside its limits. */
const FEED_TALLEST = 0.801;
const FEED_WIDEST = 1.9;
/** The widest picture Instagram keeps. */
const FEED_WIDTH = 1440;
/**
 * The longest side a feed picture is shrunk to before it's cut. Shrinking to a
 * long side takes memory by its length, and this still leaves a 1440-wide cut
 * of a panorama up to 10:1.
 */
const FEED_LONGEST = 7680;

/** The middle of a `width` by `height` picture that's in Instagram's feed range. The Instagram app cuts one that's out of range from its middle too. */
function feedCrop(width, height) {
  const ratio = width / height;
  return ratio < FEED_TALLEST
    ? { width, height: Math.floor(width / FEED_TALLEST) }
    : ratio > FEED_WIDEST
      ? { width: Math.floor(height * FEED_WIDEST), height }
      : { width, height };
}

/** A picture as Instagram's feed takes it: upright, a JPEG, and cut from the middle to 4:5 to 1.91:1. */
export async function forFeed(bytes) {
  if (!(await loadSharp())) return null;
  const meta = await sharp(bytes, LIMITS).metadata();
  // Orientations 5 to 8 lie on their side, so width and height swap once it's upright.
  const sideways = (meta.orientation ?? 1) >= 5;
  const [across, upright] = sideways ? [meta.height, meta.width] : [meta.width, meta.height];
  // Shrunk only as far as still leaves the cut 1440 wide, with no side longer than FEED_LONGEST.
  const scale = Math.min(1, FEED_WIDTH / feedCrop(across, upright).width, FEED_LONGEST / Math.max(across, upright));
  // Turned upright and shrunk in one go, so a large JPEG is shrunk as it loads and its full size is never held.
  const { data, info } = await sharp(bytes, LIMITS)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: Math.max(1, Math.round(across * scale)), height: Math.max(1, Math.round(upright * scale)), fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const crop = feedCrop(width, height);
  return sharp(data, { raw: { width, height, channels } })
    .extract({ left: Math.floor((width - crop.width) / 2), top: Math.floor((height - crop.height) / 2), ...crop })
    .resize({ width: Math.min(crop.width, FEED_WIDTH), withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export function createPhotos({ key, publicUrl, media, now = () => Date.now() }) {
  const secret = createHmac("sha256", key).update("tiktok photo links").digest();
  const sign = (userId, fileId, until) => createHmac("sha256", secret).update(`${userId}/${fileId}/${until}`).digest("base64url");

  let running = 0;
  const waiting = [];
  async function inTurn(work) {
    if (running >= AT_ONCE) await new Promise((resolve) => waiting.push(resolve));
    running++;
    try {
      return await work();
    } finally {
      running--;
      waiting.shift()?.();
    }
  }

  // A video's links, and a feed picture's, are signed apart from a picture's, so one can't be read as another.
  const signVideo = (userId, fileId, until) => createHmac("sha256", secret).update(`video/${userId}/${fileId}/${until}`).digest("base64url");
  const signFeed = (userId, fileId, until) => createHmac("sha256", secret).update(`feed/${userId}/${fileId}/${until}`).digest("base64url");
  const FEED_PATH = `${PHOTO_PATH}feed/`;

  /** The account and file a link is for, while it lasts and its signature holds. */
  function read(path, prefix = PHOTO_PATH, signer = sign, ending = /\.jpg$/) {
    const parts = path.slice(prefix.length).replace(ending, "").split("/");
    if (parts.length !== 4) return null;
    const [userId, fileId, until, signature] = parts;
    if (!ID.test(userId) || !ID.test(fileId) || !/^\d{1,15}$/.test(until) || Number(until) <= now()) return null;
    const given = Buffer.from(signature);
    const wanted = Buffer.from(signer(userId, fileId, until));
    return given.length === wanted.length && timingSafeEqual(given, wanted) ? { userId, fileId } : null;
  }

  const notFound = (res) => {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Not found.");
  };

  return {
    /** A link TikTok can pull the picture from for the next two hours. */
    link(userId, fileId) {
      const until = String(now() + LINK_MS);
      return `${publicUrl}${PHOTO_PATH}${userId}/${fileId}/${until}/${sign(userId, fileId, until)}.jpg`;
    },

    /** The same, with the picture cut to a shape Instagram's feed takes. */
    feedLink(userId, fileId) {
      const until = String(now() + LINK_MS);
      return `${publicUrl}${FEED_PATH}${userId}/${fileId}/${until}/${signFeed(userId, fileId, until)}.jpg`;
    },

    /** A link a network can pull the video from, as it is, for the next day. */
    videoLink(userId, fileId) {
      const until = String(now() + VIDEO_LINK_MS);
      return `${publicUrl}${VIDEO_PATH}${userId}/${fileId}/${until}/${signVideo(userId, fileId, until)}.mp4`;
    },

    /** Answers a link made by `videoLink`, whole or a range of it. Anything else, or a link that ran out, isn't found. */
    async serveVideo(req, res, path) {
      const target = req.method === "GET" || req.method === "HEAD" ? read(path, VIDEO_PATH, signVideo, /\.mp4$/) : null;
      const file = target ? await media.postFile(target.userId, target.fileId) : null;
      if (!file || file.kind !== "video") return notFound(res);
      const headers = {
        "Content-Type": file.type.startsWith("video/") ? file.type : "video/mp4",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      };
      const asked = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      let start = 0;
      let end = file.size - 1;
      if (asked && (asked[1] || asked[2])) {
        // "bytes=-500" is the last 500.
        start = asked[1] ? Number(asked[1]) : Math.max(0, file.size - Number(asked[2]));
        end = asked[1] && asked[2] ? Math.min(Number(asked[2]), file.size - 1) : file.size - 1;
        if (start > end || start >= file.size) {
          res.writeHead(416, { ...headers, "Content-Range": `bytes */${file.size}` });
          res.end();
          return;
        }
      }
      const partial = !!asked && (start !== 0 || end !== file.size - 1);
      res.writeHead(partial ? 206 : 200, {
        ...headers,
        "Content-Length": end - start + 1,
        ...(partial ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const body = Readable.fromWeb(await media.stream(file.key, partial ? [start, end] : undefined));
      body.on("error", () => res.destroy());
      body.pipe(res);
    },

    /** Answers a link made by `link` or `feedLink`. Anything else, or a link that ran out, isn't found. */
    async serve(req, res, path) {
      const feed = path.startsWith(FEED_PATH);
      const target = req.method === "GET" || req.method === "HEAD" ? (feed ? read(path, FEED_PATH, signFeed) : read(path)) : null;
      const file = target ? await media.postFile(target.userId, target.fileId) : null;
      const shape = feed ? forFeed : forTikTok;
      const jpeg = file?.kind === "image" ? await inTurn(async () => shape(await media.bytes(file.key, 0, file.size - 1))) : null;
      if (!jpeg) return notFound(res);
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": jpeg.length,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : jpeg);
    },
  };
}
