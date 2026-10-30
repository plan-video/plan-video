// Instagram pulls each file from a signed link to the publisher (photos.mjs): pictures as JPEGs, which is
// all it takes, and videos as they are. See meta-containers.mjs for how a post is made.

import { PublishError } from "../errors.mjs";
import { API } from "../meta.mjs";
import { clipText, containers } from "./meta-containers.mjs";
import { captionOf } from "./text.mjs";

const CAPTION_LIMIT = 2200;
const MAX_ITEMS = 10;
const MAX_COLLABORATORS = 3;
const MAX_REEL_BYTES = 300 * 1024 * 1024;
const MAX_STORY_VIDEO_BYTES = 100 * 1024 * 1024;

/** Instagram's code for an account that has posted its most for the day. */
const OVER_LIMIT = new Set([2207042]);

const flow = containers({
  network: "instagram",
  api: API.instagram,
  create: "media",
  publishPath: "media_publish",
  statusFields: "status_code,status",
  statusOf(data) {
    const code = data?.status_code;
    if (code === "FINISHED" || code === "PUBLISHED") return { state: "ready" };
    if (code === "ERROR") return { state: "failed", why: typeof data.status === "string" ? data.status : "" };
    if (code === "EXPIRED") return { state: "expired" };
    return { state: "working" };
  },
  limitError: (error) => (error?.code === 9 || OVER_LIMIT.has(error?.subcode) ? Date.now() + 60 * 60_000 : null),
});

/** Up to three, by username. */
function collaboratorsOf(post) {
  const named = Array.isArray(post.instagram?.collaborators) ? post.instagram.collaborators : [];
  const clean = named.map((name) => (typeof name === "string" ? name.trim().replace(/^@+/, "") : "")).filter((name) => /^[\w.]{1,30}$/.test(name));
  return clean.slice(0, MAX_COLLABORATORS);
}

export function createInstagram({ photos }) {
  if (!photos) throw new Error("Instagram pulls a post's files from the publisher's links.");

  /** A feed picture is cut to a shape the feed takes; a Story's stays whole. */
  const linkOf = (delivery, file, { story = false } = {}) =>
    file.kind === "video" ? photos.videoLink(delivery.user_id, file.id) : story ? photos.link(delivery.user_id, file.id) : photos.feedLink(delivery.user_id, file.id);

  function details(post) {
    const caption = clipText(captionOf(post, "instagram").trim(), CAPTION_LIMIT);
    const collaborators = collaboratorsOf(post);
    return { ...(caption ? { caption } : {}), ...(collaborators.length ? { collaborators: JSON.stringify(collaborators) } : {}) };
  }

  return {
    needsFile: true,

    async send({ post, session, files, delivery }) {
      const usable = files.filter((file) => file.kind === "image" || file.kind === "video");
      if (!usable.length) throw new PublishError("Instagram posts need a video or pictures. Attach one, then post it again.");

      if (post.story === true) {
        const [file] = usable;
        if (file.kind === "video" && file.size > MAX_STORY_VIDEO_BYTES) throw new PublishError("That video is too large for an Instagram Story. It can be 100 MB.");
        return flow.start({
          session,
          single: { media_type: "STORIES", ...(file.kind === "image" ? { image_url: linkOf(delivery, file, { story: true }) } : { video_url: linkOf(delivery, file) }) },
        });
      }

      if (usable.some((file) => file.kind === "video" && file.size > MAX_REEL_BYTES)) throw new PublishError("That video is too large for Instagram. It can be 300 MB.");

      if (usable.length === 1) {
        const [file] = usable;
        if (file.kind === "image") return flow.start({ session, single: { image_url: linkOf(delivery, file), ...details(post) } });
        return flow.start({
          session,
          single: {
            media_type: "REELS",
            video_url: linkOf(delivery, file),
            share_to_feed: post.instagram?.shareToFeed === false ? "false" : "true",
            ...(typeof post.coverTime === "number" && post.coverTime > 0 ? { thumb_offset: String(Math.round(post.coverTime * 1000)) } : {}),
            ...details(post),
          },
        });
      }

      const chosen = usable.slice(0, MAX_ITEMS);
      return flow.start({
        session,
        items: chosen.map((file) =>
          file.kind === "image"
            ? { image_url: linkOf(delivery, file), is_carousel_item: "true" }
            : { media_type: "VIDEO", video_url: linkOf(delivery, file), is_carousel_item: "true" },
        ),
        holder: (ids) => ({ media_type: "CAROUSEL", children: ids.join(","), ...details(post) }),
      });
    },

    check: flow.check,

    async publish({ post, session, delivery }) {
      const { kind, ids } = flow.made(delivery);
      return flow.finish({ session, kind, ids, holder: (children) => ({ media_type: "CAROUSEL", children: children.join(","), ...details(post) }) });
    },
  };
}
