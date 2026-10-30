// TikTok processes a post after it has it, so a sent post is `processing` until TikTok says it's up.
// TikTok shows a video's first frame whatever cover time it's sent, and the server has no encoder, so
// it gets the cover time alone. Photos must be pulled from links on a domain verified for the app (photos.mjs).

import { chunkPlan, postInfoFor, tiktok as call } from "../../tiktok/handler.mjs";

import { PublishError } from "../errors.mjs";
import { captionOf } from "./text.mjs";

const PROCESSING_MS = 2 * 60 * 60_000;
const MAX_PHOTOS = 35;
/** A photo post's caption, in UTF-16 code units as TikTok counts them. */
const PHOTO_CAPTION_LIMIT = 4000;

const allows = (scope, name) => String(scope ?? "").split(/[,\s]+/).includes(name);

function clipUnits(text, max) {
  let out = "";
  for (const char of text) {
    if (out.length + char.length > max) break;
    out += char;
  }
  return out;
}

/** A failed lookup throws, to try again later. */
async function statusOf(accessToken, publishId) {
  const result = await call(accessToken, "POST", "/v2/post/publish/status/fetch/", { publish_id: publishId });
  if (result.error) throw new PublishError(result.error, { retry: true });
  return result.data ?? {};
}

async function status(accessToken, publishId) {
  const data = await statusOf(accessToken, publishId);
  if (data.status === "FAILED") throw new PublishError(data.fail_reason ? `TikTok rejected the post: ${data.fail_reason}.` : "TikTok rejected the post.");
  return data.status ?? "";
}

/**
 * An upload TikTok never got all of, which it can't post: starting again is safe.
 * One whose count is missing may be complete, so it's waited for instead.
 */
function cutShort(known, file) {
  const got = Number(known?.uploaded_bytes);
  return known?.status === "PROCESSING_UPLOAD" && known.uploaded_bytes !== undefined && known.uploaded_bytes !== null && Number.isFinite(got) && got < file.size;
}

async function sendVideo({ post, session, file, media, progress }) {
  const inbox = post.tiktok?.inbox === true;
  const plan = chunkPlan(file.size);
  if (!plan) throw new PublishError("That video is too large for TikTok. It can be 200 MB.");
  const source = { source: "FILE_UPLOAD", video_size: file.size, chunk_size: plan.chunkSize, total_chunk_count: plan.total };

  let started;
  if (inbox) {
    if (!allows(session.scope, "video.upload")) throw new PublishError("Disconnect TikTok in Connections and connect it again, so it can send a draft to your inbox.");
    started = await call(session.accessToken, "POST", "/v2/post/publish/inbox/video/init/", { source_info: source });
  } else {
    const chosen = post.tiktok ?? {};
    const postInfo = postInfoFor({
      title: captionOf(post, "tiktok"),
      privacy: chosen.privacy,
      disableComment: !chosen.comments,
      disableDuet: !chosen.duet,
      disableStitch: !chosen.stitch,
      brandOrganic: chosen.yourBrand === true,
      brandContent: chosen.brandedContent === true,
      coverTimeMs: typeof post.coverTime === "number" ? Math.round(post.coverTime * 1000) : undefined,
    });
    if (!postInfo) throw new PublishError("Pick who can watch on TikTok in the post.");
    started = await call(session.accessToken, "POST", "/v2/post/publish/video/init/", { post_info: postInfo, source_info: source });
  }
  // Nothing goes out before every piece is up, so an init whose answer was lost is safe to repeat.
  if (started.unreachable) throw new PublishError("TikTok didn't answer. Trying again soon.", { retry: true });
  if (started.error) throw new PublishError(started.error);
  const uploadUrl = started.data?.upload_url;
  const publishId = started.data?.publish_id;
  if (!uploadUrl || !publishId) throw new PublishError("TikTok didn't start the upload. Trying again soon.", { retry: true });
  // Kept before the first piece: a try after a lost answer asks TikTok how far this
  // upload got, rather than starting a second one TikTok would post as well.
  await progress?.(publishId);

  for (let index = 0; index < plan.total; index++) {
    const offset = index * plan.chunkSize;
    const end = index === plan.total - 1 ? file.size : offset + plan.chunkSize;
    const bytes = await media.bytes(file.key, offset, end - 1);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.length), "Content-Range": `bytes ${offset}-${end - 1}/${file.size}` },
      body: bytes,
      signal: AbortSignal.timeout(180_000),
    }).catch(() => null);
    if (!response || !(response.ok || response.status === 206)) {
      throw new PublishError("The upload to TikTok stopped. Trying again soon.", { retry: true });
    }
  }
  return { state: "processing", publishId };
}

async function sendPhotos({ post, session, pictures, delivery, photos }) {
  if (!photos) throw new PublishError("TikTok photo posts aren't switched on for plan.video yet. Post a video, or leave TikTok off this post.");
  const inbox = post.tiktok?.inbox === true;
  const description = clipUnits(captionOf(post, "tiktok").trim(), PHOTO_CAPTION_LIMIT);
  const source = { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: pictures.map((file) => photos.link(delivery.user_id, file.id)) };

  let body;
  if (inbox) {
    if (!allows(session.scope, "video.upload")) throw new PublishError("Disconnect TikTok in Connections and connect it again, so it can send a draft to your inbox.");
    body = { media_type: "PHOTO", post_mode: "MEDIA_UPLOAD", post_info: { ...(description ? { description } : {}) }, source_info: source };
  } else {
    const chosen = post.tiktok ?? {};
    const postInfo = postInfoFor({
      privacy: chosen.privacy,
      disableComment: !chosen.comments,
      brandOrganic: chosen.yourBrand === true,
      brandContent: chosen.brandedContent === true,
    });
    if (!postInfo) throw new PublishError("Pick who can watch on TikTok in the post.");
    body = {
      media_type: "PHOTO",
      post_mode: "DIRECT_POST",
      post_info: {
        ...(description ? { description } : {}),
        privacy_level: postInfo.privacy_level,
        disable_comment: postInfo.disable_comment,
        auto_add_music: true,
        brand_content_toggle: postInfo.brand_content_toggle,
        brand_organic_toggle: postInfo.brand_organic_toggle,
      },
      source_info: source,
    };
  }
  const started = await call(session.accessToken, "POST", "/v2/post/publish/content/init/", body);
  // This is the call that makes the post, and TikTok pulls the pictures on its own, so
  // without its answer the post may be up already: it isn't made a second time.
  if (started.unreachable) {
    throw new PublishError("TikTok didn't answer, so the photo post may have gone out. Check your TikTok profile before posting it again.");
  }
  if (started.error) throw new PublishError(started.error);
  const publishId = started.data?.publish_id;
  if (!publishId) throw new PublishError("TikTok didn't start the post. Trying again soon.", { retry: true });
  return { state: "processing", publishId };
}

/** Without `photos`, TikTok takes videos only. */
export function createTikTok({ photos } = {}) {
  return {
    needsFile: true,

    /** About the memory a send with these files holds (pool.mjs): a video's biggest piece, read whole and sent as a copy. Pictures TikTok pulls itself. */
    holds(files) {
      const video = files.find((file) => file.kind === "video");
      const plan = video && chunkPlan(video.size);
      return plan ? 2 * (plan.total === 1 ? video.size : video.size - (plan.total - 1) * plan.chunkSize) : 0;
    },

    async send({ post, session, files, media, delivery, progress }) {
      const video = files.find((file) => file.kind === "video");
      // An earlier try got the post to TikTok, or started its upload: ask after it rather than
      // sending it twice. If TikTok can't be asked, it waits to ask again rather than sending blind.
      // One TikTok turned down, or an upload it never got all of, is gone, so the post goes again as a new one.
      if (delivery.publish_id) {
        const known = await statusOf(session.accessToken, delivery.publish_id);
        if (known.status !== "FAILED" && !(video && cutShort(known, video))) return { state: "processing", publishId: delivery.publish_id };
      }
      if (video) return sendVideo({ post, session, file: video, media, progress });
      const pictures = files.filter((file) => file.kind === "image").slice(0, MAX_PHOTOS);
      if (!pictures.length) throw new PublishError("TikTok needs a video or pictures. Attach them to the post.");
      return sendPhotos({ post, session, pictures, delivery, photos });
    },

    async check({ post, session, delivery }) {
      const inbox = post?.tiktok?.inbox === true;
      const now = await status(session.accessToken, delivery.publish_id);
      if (now === "PUBLISH_COMPLETE" || (inbox && now === "SEND_TO_USER_INBOX")) {
        return { state: "sent", publishId: delivery.publish_id, ...(inbox && now !== "PUBLISH_COMPLETE" ? { note: "inbox" } : {}) };
      }
      if (Date.now() - Date.parse(delivery.updated_at) > PROCESSING_MS) {
        throw new PublishError(inbox ? "TikTok didn't send the draft to your inbox. Check TikTok, then try again." : "TikTok didn't finish processing the post. Check your profile, then try again.");
      }
      return { state: "processing", publishId: delivery.publish_id };
    },
  };
}
