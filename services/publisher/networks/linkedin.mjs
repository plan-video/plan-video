// A post with files is `processing` until LinkedIn has them ready; publish makes the post only after
// the publisher has claimed the row, so it's made once. Several pictures need LinkedIn's versioned API,
// whose uploads can't be asked after with this login, so they're given a minute before posting.
// Follow-ups go as comments, in words alone.

import { COMMENT_LIMIT, assetState, clip, createComment, createImagesPost, createPost, register, registerImage } from "../../linkedin/handler.mjs";

import { PublishError } from "../errors.mjs";
import { captionOf } from "./text.mjs";

const TEXT_LIMIT = 3000;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PICTURES = 20;
const PROCESSING_MS = 60 * 60_000;
/** Several pictures can't be asked after, so they're given this long after their upload before the post is made. */
export const PICTURES_WAIT_MS = 60_000;
/** How the row keeps the pictures of a post with several, which it uploaded: this, then their ids. */
const PICTURES = "images:";

const postUrl = (id) => `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`;

/** Makes the post. When LinkedIn's answer is lost, it may have made it anyway, so that's never tried again on its own. */
async function makePost(session, text, media) {
  const made = await (media?.pictures
    ? createImagesPost(session.accessToken, session.personId, text, media.pictures)
    : createPost(session.accessToken, session.personId, text, media)
  ).catch(() => ({ lost: true }));
  if (made.lost) throw new PublishError("LinkedIn didn't confirm the post. Check your profile, and post it again if it isn't there.");
  if (made.error) throw new PublishError(made.error);
  return { state: "sent", publishId: made.id, url: postUrl(made.id) };
}

async function put(session, media, file, uploadUrl) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": file.type, "Content-Length": String(file.size) },
    body: await media.stream(file.key),
    duplex: "half",
    signal: AbortSignal.timeout(600_000),
  }).catch(() => null);
  if (!response) throw new PublishError("The upload to LinkedIn stopped. Trying again soon.", { retry: true });
  if (response.status === 401) throw new PublishError("LinkedIn login expired. Connect the account again in Connections.", { expired: true });
  if (response.status !== 200 && response.status !== 201) throw new PublishError("LinkedIn didn't take the file. Trying again soon.", { retry: true });
}

/** The row keeps a post's one file as `kind:asset`. */
function uploaded(delivery) {
  if (delivery.publish_id.startsWith(PICTURES)) return { pictures: delivery.publish_id.slice(PICTURES.length).split(",") };
  const at = delivery.publish_id.indexOf(":");
  return { kind: delivery.publish_id.slice(0, at), asset: delivery.publish_id.slice(at + 1) };
}

export const linkedin = {
  needsFile: false,

  async send({ post, session, files, media }) {
    const text = clip(captionOf(post, "linkedin").trim(), TEXT_LIMIT);
    const video = files.find((file) => file.kind === "video");
    const chosen = video ? [video] : files.filter((file) => file.kind === "image").slice(0, MAX_PICTURES);
    if (!chosen.length) {
      if (!text) throw new PublishError("Write something for LinkedIn, or attach a video or picture.");
      return makePost(session, text);
    }
    if (video && video.size > MAX_VIDEO_BYTES) throw new PublishError("That video is too large for LinkedIn. It can be 200 MB.");
    if (chosen.some((file) => file.kind === "image" && file.size > MAX_IMAGE_BYTES)) {
      throw new PublishError(chosen.length === 1 ? "That picture is too large for LinkedIn. It can be 10 MB." : "A picture is too large for LinkedIn. Each can be 10 MB.");
    }

    if (chosen.length > 1) {
      const pictures = [];
      for (const file of chosen) {
        const plan = await registerImage(session.accessToken, session.personId);
        if (plan.error) throw new PublishError(plan.error);
        await put(session, media, file, plan.uploadUrl);
        pictures.push(plan.image);
      }
      return { state: "processing", publishId: `${PICTURES}${pictures.join(",")}` };
    }

    const [file] = chosen;
    const plan = await register(session.accessToken, session.personId, file.kind);
    if (plan.error) throw new PublishError(plan.error);
    await put(session, media, file, plan.uploadUrl);
    return { state: "processing", publishId: `${file.kind}:${plan.asset}` };
  },

  /** Whether LinkedIn has the files ready. Only asks: the post is made in publish. */
  async check({ session, delivery }) {
    // Pictures LinkedIn can't be asked about. They're ready in seconds, and are given a minute from their upload, when processing started.
    if (uploaded(delivery).pictures) return Date.now() - Date.parse(delivery.updated_at) >= PICTURES_WAIT_MS ? { state: "ready" } : { state: "processing", publishId: delivery.publish_id };
    const state = await assetState(session.accessToken, uploaded(delivery).asset);
    if (state.error) throw new PublishError(state.error, { retry: true });
    if (state.state === "ready") return { state: "ready" };
    if (Date.now() - Date.parse(delivery.updated_at) > PROCESSING_MS) throw new PublishError("LinkedIn didn't finish processing the file. Try again.");
    return { state: "processing", publishId: delivery.publish_id };
  },

  async publish({ post, session, delivery }) {
    return makePost(session, clip(captionOf(post, "linkedin").trim(), TEXT_LIMIT), uploaded(delivery));
  },

  /** When LinkedIn's answer is lost it may have made the comment anyway, so that's never tried again on its own. */
  async reply({ session, text, root }) {
    const body = text.trim();
    // A comment takes words alone: a follow-up with only media has nothing for LinkedIn, and the thread carries on without it.
    if (!body) return { state: "sent", publishId: root, url: postUrl(root), note: "LinkedIn comments take words only, so this follow-up was left off LinkedIn." };
    if ([...body].length > COMMENT_LIMIT) throw new PublishError(`A comment on LinkedIn can be ${COMMENT_LIMIT} characters. Shorten the follow-up in the post's thread.`);
    const made = await createComment(session.accessToken, session.personId, root, body).catch(() => ({ lost: true }));
    if (made.lost) throw new PublishError("LinkedIn didn't confirm the follow-up. Check the post's comments, and add it there if it isn't.");
    if (made.error) throw new PublishError(made.error);
    return { state: "sent", publishId: made.id || root, url: postUrl(root) };
  },
};
