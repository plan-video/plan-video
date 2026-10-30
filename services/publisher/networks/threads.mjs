// Posts to a Threads profile: the words alone, with a picture or a video, or
// with up to 20 of the post's pictures and videos as a carousel. Threads
// pulls each file from a signed link to the publisher (photos.mjs). See
// meta-containers.mjs for how a post is made.

import { PublishError } from "../errors.mjs";
import { API } from "../meta.mjs";
import { clipText, containers } from "./meta-containers.mjs";
import { captionOf } from "./text.mjs";

const TEXT_LIMIT = 500;
/** Items one carousel takes. */
const MAX_ITEMS = 20;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

const flow = containers({
  network: "threads",
  api: API.threads,
  create: "threads",
  publishPath: "threads_publish",
  statusFields: "status,error_message",
  statusOf(data) {
    const status = data?.status;
    if (status === "FINISHED" || status === "PUBLISHED") return { state: "ready" };
    if (status === "ERROR") return { state: "failed", why: typeof data.error_message === "string" ? data.error_message.toLowerCase().replaceAll("_", " ") : "" };
    if (status === "EXPIRED") return { state: "expired" };
    return { state: "working" };
  },
  // Threads takes 250 posts a day from an account.
  limitError: (error) => (error?.code === 9 || /limit/i.test(error?.message ?? "") ? Date.now() + 60 * 60_000 : null),
});

/** The post's link, when it has one, for a preview under the words. */
const linkOf = (post) => (typeof post.link === "string" && /^https?:\/\/\S+$/i.test(post.link.trim()) ? post.link.trim() : "");

export function createThreads({ photos }) {
  if (!photos) throw new Error("Threads pulls a post's files from the publisher's links.");

  const fileUrl = (delivery, file) => (file.kind === "image" ? { image_url: photos.link(delivery.user_id, file.id) } : { video_url: photos.videoLink(delivery.user_id, file.id) });
  const textOf = (post) => clipText(captionOf(post, "threads").trim(), TEXT_LIMIT);

  return {
    needsFile: false,

    async send({ post, session, files, delivery }) {
      const text = textOf(post);
      const usable = files.filter((file) => file.kind === "image" || file.kind === "video");
      if (usable.some((file) => file.kind === "video" && file.size > MAX_VIDEO_BYTES)) throw new PublishError("That video is too large for Threads. It can be 1 GB.");

      if (!usable.length) {
        if (!text) throw new PublishError("Write something for Threads, or attach a video or picture.");
        const link = linkOf(post);
        return flow.start({ session, single: { media_type: "TEXT", text, ...(link ? { link_attachment: link } : {}) } });
      }
      if (usable.length === 1) {
        const [file] = usable;
        return flow.start({ session, single: { media_type: file.kind === "image" ? "IMAGE" : "VIDEO", ...fileUrl(delivery, file), ...(text ? { text } : {}) } });
      }
      return flow.start({
        session,
        items: usable.slice(0, MAX_ITEMS).map((file) => ({ media_type: file.kind === "image" ? "IMAGE" : "VIDEO", ...fileUrl(delivery, file), is_carousel_item: "true" })),
        holder: (ids) => ({ media_type: "CAROUSEL", children: ids.join(","), ...(text ? { text } : {}) }),
      });
    },

    check: flow.check,

    async publish({ post, session, delivery }) {
      const { kind, ids } = flow.made(delivery);
      const text = textOf(post);
      return flow.finish({ session, kind, ids, holder: (children) => ({ media_type: "CAROUSEL", children: children.join(","), ...(text ? { text } : {}) }) });
    },
  };
}
