// Pinterest pulls pictures from signed links to the publisher (photos.mjs) and takes videos by upload. Nothing
// shows until the Pin is made, so an upload can be retried freely, while a Pin whose answer is lost never is.
// A post names its board in words, so the same post can go to several accounts: each looks up its own board,
// and one it doesn't have yet is made rather than the post being missed.

import { randomUUID } from "node:crypto";

import { PublishError } from "../errors.mjs";
import { boardsOf, errorFrom, pinterestFetch } from "../pinterest.mjs";
import { captionOf } from "./text.mjs";

const TITLE_LIMIT = 100;
const DESCRIPTION_LIMIT = 800;
const LINK_LIMIT = 2048;
const MAX_PICTURES = 5;
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const UPLOAD_MS = 25 * 60_000;
const PROCESSING_MS = 60 * 60_000;

const clip = (text, max) => [...text.trim()].slice(0, max).join("");
const sameName = (name) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** People type bare addresses as "shop.example.com". One that can't be a web address goes without. */
export function linkOf(post) {
  const raw = typeof post.link === "string" ? post.link.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return (url.protocol === "https:" || url.protocol === "http:") && url.href.length <= LINK_LIMIT ? url.href : null;
  } catch {
    return null;
  }
}

/** S3 takes the file as the last field of a form, and wants its whole length up front. */
function uploadForm(parameters, file, stream) {
  const boundary = `----planvideo${randomUUID().replaceAll("-", "")}`;
  const fields = Object.entries(parameters ?? {})
    .map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    .join("");
  const head = Buffer.from(`${fields}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="video.mp4"\r\nContent-Type: ${file.type || "video/mp4"}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  async function* parts() {
    yield head;
    yield* stream;
    yield tail;
  }
  return { body: ReadableStream.from(parts()), type: `multipart/form-data; boundary=${boundary}`, length: head.length + file.size + tail.length };
}

export function createPinterest({ photos, app }) {
  if (!photos) throw new Error("Pinterest pulls a post's pictures from the publisher's links.");

  async function boardFor(post, session) {
    const wanted = typeof post.pinterest?.board === "string" ? post.pinterest.board.trim().replace(/\s+/g, " ") : "";
    if (!wanted) throw new PublishError("Pick a board for Pinterest in the post, then post it again.");
    const find = async () => (await boardsOf(app, session)).find((board) => sameName(board.name) === sameName(wanted));
    const found = await find();
    if (found) return found.id;
    const made = await pinterestFetch(app, "/boards", { method: "POST", token: session.accessToken, json: { name: wanted } });
    if (made.ok && made.data?.id) return String(made.data.id);
    // Made by an earlier try whose answer was lost, or by someone else just now.
    if (made.status !== 401 && made.status !== 429) {
      const again = await find();
      if (again) return again.id;
    }
    throw errorFrom(made, `make the board "${wanted}"`);
  }

  function details(post) {
    const title = typeof post.pinterest?.title === "string" ? clip(post.pinterest.title, TITLE_LIMIT) : "";
    const description = clip(captionOf(post, "pinterest"), DESCRIPTION_LIMIT);
    const link = linkOf(post);
    return { ...(title ? { title } : {}), ...(description ? { description } : {}), ...(link ? { link } : {}) };
  }

  /** Only asked once, by a send or a publish the worker claimed. If the answer is lost the Pin may be up, so it isn't made again on its own. */
  async function makePin(post, session, board, media_source) {
    const made = await pinterestFetch(app, "/pins", { method: "POST", token: session.accessToken, json: { board_id: board, ...details(post), media_source } });
    if (made.status === 0 || made.status >= 500) throw new PublishError("Pinterest didn't confirm the Pin. Check the board, and post it again if it isn't there.");
    if (!made.ok) throw errorFrom(made, "make the Pin");
    const id = made.data?.id;
    if (!id) throw new PublishError("Pinterest took the Pin but didn't say where it is.");
    return { state: "sent", publishId: String(id), url: `https://www.pinterest.com/pin/${id}/` };
  }

  async function upload(session, file, media) {
    if (file.size > MAX_VIDEO_BYTES) throw new PublishError("That video is too large for Pinterest. It can be 2 GB.");
    const started = await pinterestFetch(app, "/media", { method: "POST", token: session.accessToken, json: { media_type: "video" } });
    if (!started.ok) throw errorFrom(started, "start the upload");
    const { media_id: mediaId, upload_url: uploadUrl, upload_parameters: parameters } = started.data ?? {};
    if (!mediaId || !uploadUrl) throw new PublishError("Pinterest didn't start the upload. Trying again soon.", { retry: true });
    const form = uploadForm(parameters, file, await media.stream(file.key));
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": form.type, "Content-Length": String(form.length) },
      body: form.body,
      duplex: "half",
      redirect: "error",
      signal: AbortSignal.timeout(UPLOAD_MS),
    }).catch(() => null);
    if (!response?.ok) throw new PublishError("The upload to Pinterest stopped. Trying again soon.", { retry: true });
    return String(mediaId);
  }

  return {
    needsFile: true,

    async send({ post, session, files, media, delivery }) {
      const video = files.find((file) => file.kind === "video");
      const pictures = files.filter((file) => file.kind === "image").slice(0, MAX_PICTURES);
      if (!video && !pictures.length) throw new PublishError("Pinterest needs a video or pictures. Attach them to the post.");
      // Asked before anything is uploaded, so a post that can't go doesn't send its video for nothing.
      const board = await boardFor(post, session);
      if (video) return { state: "processing", publishId: await upload(session, video, media) };
      const links = pictures.map((file) => photos.link(delivery.user_id, file.id));
      if (links.length === 1) return makePin(post, session, board, { source_type: "image_url", url: links[0] });
      return makePin(post, session, board, { source_type: "multiple_image_urls", items: links.map((url) => ({ url })) });
    },

    /** Only asks: the Pin is made in publish. */
    async check({ session, delivery }) {
      const answer = await pinterestFetch(app, `/media/${encodeURIComponent(delivery.publish_id)}`, { token: session.accessToken });
      if (!answer.ok) throw errorFrom(answer, "say how the video is doing");
      if (answer.data?.status === "succeeded") return { state: "ready" };
      if (answer.data?.status === "failed") throw new PublishError("Pinterest couldn't process this video.");
      if (Date.now() - Date.parse(delivery.updated_at) > PROCESSING_MS) throw new PublishError("Pinterest didn't finish processing the video. Try again.");
      return { state: "processing", publishId: delivery.publish_id };
    },

    async publish({ post, session, delivery }) {
      const board = await boardFor(post, session);
      return makePin(post, session, board, {
        source_type: "video_id",
        media_id: delivery.publish_id,
        cover_image_key_frame_time: typeof post.coverTime === "number" && post.coverTime > 0 ? Math.floor(post.coverTime) : 0,
      });
    },
  };
}
