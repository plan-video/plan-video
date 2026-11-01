// Makes pictures for the publisher, in a process that holds no logins or keys, can reach nothing outside this
// server, and can be killed by a bad file without stopping a send. See plan-video-photos.service.

import sharp from "sharp";

/** Above the 8 MB the storage service lets a picture be. */
const MAX_BYTES = 32 * 1024 * 1024;
/** The most pixels a picture may have: above any phone camera's 48 to 50 MP, and well under sharp's own limit, so two at once fit in this service's memory. */
const PIXEL_LIMIT = 100_000_000;
const LIMITS = { limitInputPixels: PIXEL_LIMIT };

// Each picture on one thread, as a thread holds lines of a wide picture at a time.
sharp.concurrency(1);

/** A picture as TikTok takes it: upright, a JPEG, and no bigger than 1080 by 1920 either way round. */
async function forTikTok(bytes) {
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
/** Shrinking to a long side takes memory by its length; this still leaves a 1440-wide cut of a 10:1 panorama. */
const FEED_LONGEST = 7680;

/** The Instagram app cuts an out-of-range picture from its middle too. */
function feedCrop(width, height) {
  const ratio = width / height;
  return ratio < FEED_TALLEST
    ? { width, height: Math.floor(width / FEED_TALLEST) }
    : ratio > FEED_WIDEST
      ? { width: Math.floor(height * FEED_WIDEST), height }
      : { width, height };
}

async function forFeed(bytes) {
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

const BLUESKY_LIMIT = 1_000_000;

/** A JPEG under Bluesky's 1 MB, no wider or taller than 2000 pixels. */
async function forBluesky(bytes) {
  for (const side of [2000, 1600, 1200]) {
    for (const quality of [90, 80, 70]) {
      const out = await sharp(bytes, LIMITS).rotate().resize({ width: side, height: side, fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();
      if (out.length <= BLUESKY_LIMIT) return out;
    }
  }
  throw new Error("Too large for Bluesky, even made smaller.");
}

const MAKERS = { "/tiktok": forTikTok, "/feed": forFeed, "/bluesky": forBluesky };

function answer(res, status, body, type = "text/plain; charset=utf-8") {
  // One connection a picture, so the publisher never reuses one as it closes and takes that for an outage.
  res.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body), Connection: "close" });
  res.end(body);
}

/** Null when it's over MAX_BYTES. */
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Read to its end all the same: leaving early closes the connection under the answer.
    if (size <= MAX_BYTES) chunks.push(chunk);
  }
  return size > MAX_BYTES ? null : Buffer.concat(chunks);
}

/** 422 means the picture can't be made, now or later; anything else says nothing about the picture. */
export async function handlePhotos(req, res) {
  const path = (req.url || "").split("?")[0];
  const make = MAKERS[path];
  if (req.method !== "POST" || (!make && path !== "/size")) return answer(res, 404, "Not found.");
  const bytes = await readBody(req);
  if (!bytes) return answer(res, 422, "Over the size a picture can be.");
  let made;
  try {
    if (make) made = await make(bytes);
    else {
      const { width, height } = await sharp(bytes, LIMITS).metadata();
      made = JSON.stringify({ width, height });
    }
  } catch (error) {
    return answer(res, 422, error instanceof Error ? error.message : "That picture can't be made.");
  }
  answer(res, 200, made, make ? "image/jpeg" : "application/json");
}
