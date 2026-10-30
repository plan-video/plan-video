// Uploads a post's video to YouTube, in 8 MB pieces read from cloud storage,
// the way the browser did through services/youtube, carrying on an upload
// that was cut off rather than starting another.

import { clip, explain, failureText, startUpload } from "../../youtube/handler.mjs";

import { PublishError } from "../errors.mjs";
import { captionOf } from "./text.mjs";

const CHUNK = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

async function videoState(accessToken, videoId) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "status");
  url.searchParams.set("id", videoId);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response) throw new PublishError("Couldn't reach YouTube. Trying again soon.", { retry: true });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new PublishError(explain(payload), { retry: response.status >= 500 });
  const status = payload?.items?.[0]?.status;
  if (!status) return "missing";
  if (["failed", "rejected", "deleted"].includes(status.uploadStatus)) throw new PublishError(failureText(status));
  return "ready";
}

const watchUrl = (videoId, short) => (short ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`);

/**
 * How far YouTube has an upload: `{ done }` with the video when it finished, the
 * bytes it has so far, or null when the upload is gone and has to start again.
 */
async function uploadState(uploadUrl, size) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response) throw new PublishError("Couldn't reach YouTube. Trying again soon.", { retry: true });
  if (response.status === 200 || response.status === 201) return { done: await response.json().catch(() => null) };
  if (response.status === 308) {
    const range = response.headers.get("range")?.match(/bytes=\d+-(\d+)/);
    return { received: range ? Number(range[1]) + 1 : 0 };
  }
  if (response.status === 404 || response.status === 410) return null;
  throw new PublishError("YouTube didn't say how far the upload got. Trying again soon.", { retry: true });
}

/** The privacy a post asks YouTube for. */
const privacyOf = (chosen) => (["public", "unlisted", "private"].includes(chosen.privacy) ? chosen.privacy : "public");

/**
 * The upload as YouTube kept it. YouTube keeps a video private when the app that
 * uploaded it hasn't passed its review, whatever privacy was asked for, so a
 * video that came back private when it wasn't meant to be says so (note
 * "private") rather than passing as posted the way it was asked.
 */
const finished = (payload, short, wanted) => {
  const videoId = typeof payload?.id === "string" ? payload.id : "";
  if (!videoId) throw new PublishError("YouTube took the video but didn't say where it is. Check your channel before posting it again.");
  const locked = wanted !== "private" && payload?.status?.privacyStatus === "private";
  return { state: "sent", publishId: videoId, url: watchUrl(videoId, short), ...(locked ? { note: "private" } : {}) };
};

export const youtube = {
  needsFile: true,

  /** About the memory an upload holds (pool.mjs): a piece of the video at a time, read whole and sent as a copy. */
  holds: (files) => (files.some((file) => file.kind === "video") ? 2 * CHUNK : 0),

  /**
   * The upload's address is kept on the row as soon as YouTube gives it, so a
   * try cut off partway carries on with the same upload, and one whose last
   * answer was lost finds the video already there, rather than sending it twice.
   */
  async send({ post, session, files, media, delivery, progress }) {
    const chosen = post.youtube ?? {};
    const short = chosen.short === true;
    const wanted = privacyOf(chosen);
    const known = delivery.publish_id ?? "";
    // An earlier try finished the upload: only check YouTube still has it.
    if (known && !known.startsWith("upload:") && (await videoState(session.accessToken, known)) === "ready") {
      return { state: "sent", publishId: known, url: watchUrl(known, short) };
    }
    const file = files.find((item) => item.kind === "video");
    if (!file) throw new PublishError("YouTube needs a video. Attach one to the post.");
    if (file.size > MAX_VIDEO_BYTES) throw new PublishError("That video is too large to upload from plan.video.");
    const contentType = file.type.startsWith("video/") ? file.type : "video/mp4";

    let uploadUrl = known.startsWith("upload:") ? known.slice("upload:".length) : "";
    let offset = 0;
    if (uploadUrl) {
      const state = await uploadState(uploadUrl, file.size);
      if (state?.done) return finished(state.done, short, wanted);
      if (state) offset = state.received;
      else uploadUrl = "";
    }
    if (!uploadUrl) {
      const title = clip((chosen.title || post.title || "").trim(), 100);
      if (!title) throw new PublishError("Add a YouTube title to the post.");
      const tags = Array.isArray(chosen.tags) ? chosen.tags.filter((tag) => typeof tag === "string" && tag.trim()).map((tag) => tag.trim()).slice(0, 30) : [];
      const started = await startUpload(session.accessToken, {
        videoSize: file.size,
        contentType,
        title,
        description: clip(chosen.description || captionOf(post, "youtube"), 5000),
        tags,
        privacy: wanted,
        madeForKids: chosen.madeForKids === true,
        short,
      });
      if (started.error) throw new PublishError(started.error);
      uploadUrl = started.uploadUrl;
      await progress(`upload:${uploadUrl}`);
    }

    while (offset < file.size) {
      const end = Math.min(offset + CHUNK, file.size);
      const bytes = await media.bytes(file.key, offset, end - 1);
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Length": String(bytes.length), "Content-Range": `bytes ${offset}-${end - 1}/${file.size}`, "Content-Type": contentType },
        body: bytes,
        signal: AbortSignal.timeout(120_000),
      }).catch(() => null);
      // The next try asks YouTube how far it got, so a lost answer costs nothing.
      if (!response) throw new PublishError("The upload to YouTube stopped. Carrying on soon.", { retry: true });
      if (response.status === 308) {
        const range = response.headers.get("range")?.match(/bytes=\d+-(\d+)/);
        const received = range ? Number(range[1]) + 1 : end;
        if (received <= offset) throw new PublishError("YouTube didn't confirm the upload. Carrying on soon.", { retry: true });
        offset = received;
        continue;
      }
      const payload = await response.json().catch(() => null);
      if (response.status !== 200 && response.status !== 201) throw new PublishError(explain(payload), { retry: response.status >= 500 });
      return finished(payload, short, wanted);
    }
    const state = await uploadState(uploadUrl, file.size);
    if (state?.done) return finished(state.done, short, wanted);
    throw new PublishError("YouTube didn't finish the upload. Carrying on soon.", { retry: true });
  },
};
