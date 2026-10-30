// Posts to a Facebook Page: the words alone (with the post's link, if it has
// one), a picture, up to 10 pictures together, a video, or one picture or
// video as a Story. Facebook pulls each file from a signed link to the
// publisher (photos.mjs). Its posts are made in one go, so nothing is left
// `processing`: Facebook works on a video after the post is made.

import { PublishError } from "../errors.mjs";
import { API, GRAPH_VERSION, metaFetch, publishError } from "../meta.mjs";
import { captionOf } from "./text.mjs";

/** Pictures one post takes. */
const MAX_PICTURES = 10;
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;
/** Videos are uploaded through Facebook's own address for them. */
const VIDEO_API = `https://graph-video.facebook.com/${GRAPH_VERSION}`;

/** The post's link, when it has one, for a preview under the words. */
const linkOf = (post) => (typeof post.link === "string" && /^https?:\/\/\S+$/i.test(post.link.trim()) ? post.link.trim() : "");

/** Where a post or video is, once made: Facebook's own address when it gives one. */
async function urlOf(session, id, fallback) {
  const found = await metaFetch(`${API.facebook}/${id}?fields=permalink_url`, { token: session.accessToken });
  const url = found.ok && typeof found.data?.permalink_url === "string" ? found.data.permalink_url : fallback;
  return url.startsWith("/") ? `https://www.facebook.com${url}` : url;
}

/** Makes something on the Page. A lost answer may have made it anyway, so that's never tried again on its own. */
async function make(session, url, fields, what, { json = false } = {}) {
  const made = await metaFetch(url, { method: "POST", token: session.accessToken, ...(json ? { json: fields } : { form: fields }), timeout: 600_000 });
  if (made.error?.lost) throw new PublishError("Facebook didn't confirm the post. Check the Page, and post it again if it isn't there.");
  if (!made.ok) throw publishError("facebook", made.error, what);
  return made.data;
}

/** Hands Facebook a video for a Story through its upload address, from the link it pulls the file from. */
async function storyVideo(session, link) {
  const page = session.accountId;
  const started = await metaFetch(`${API.facebook}/${page}/video_stories`, { method: "POST", token: session.accessToken, form: { upload_phase: "start" } });
  if (!started.ok || !started.data?.video_id) throw publishError("facebook", started.error, "start the Story's video");
  const videoId = String(started.data.video_id);
  const uploadUrl = typeof started.data.upload_url === "string" ? started.data.upload_url : `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}/${videoId}`;
  const sent = await metaFetch(uploadUrl, { method: "POST", headers: { Authorization: `OAuth ${session.accessToken}`, file_url: link }, timeout: 600_000 });
  if (!sent.ok) throw publishError("facebook", sent.error, "take the Story's video");
  const done = await make(session, `${API.facebook}/${page}/video_stories`, { upload_phase: "finish", video_id: videoId }, "post the Story");
  return { state: "sent", publishId: String(done.post_id ?? videoId), url: `https://www.facebook.com/${page}` };
}

export function createFacebook({ photos }) {
  if (!photos) throw new Error("Facebook pulls a post's files from the publisher's links.");

  return {
    needsFile: false,

    async send({ post, session, files, delivery }) {
      const page = session.accountId;
      const message = captionOf(post, "facebook").trim();
      const pictures = files.filter((file) => file.kind === "image");
      const video = files.find((file) => file.kind === "video");
      if (pictures.some((file) => file.size > MAX_PICTURE_BYTES)) throw new PublishError(pictures.length === 1 ? "That picture is too large for Facebook. It can be 10 MB." : "A picture is too large for Facebook. Each can be 10 MB.");

      if (post.story === true) {
        if (video) return storyVideo(session, photos.videoLink(delivery.user_id, video.id));
        if (!pictures.length) throw new PublishError("A Facebook Story needs a picture or a video.");
        const photo = await make(session, `${API.facebook}/${page}/photos`, { url: photos.link(delivery.user_id, pictures[0].id), published: "false" }, "take the Story's picture");
        const done = await make(session, `${API.facebook}/${page}/photo_stories`, { photo_id: String(photo.id) }, "post the Story");
        return { state: "sent", publishId: String(done.post_id ?? photo.id), url: `https://www.facebook.com/${page}` };
      }

      if (video) {
        const made = await make(session, `${VIDEO_API}/${page}/videos`, { file_url: photos.videoLink(delivery.user_id, video.id), ...(message ? { description: message } : {}) }, "take the video");
        const id = String(made.id);
        return {
          state: "sent",
          publishId: id,
          url: await urlOf(session, id, `https://www.facebook.com/${page}/videos/${id}`),
          ...(pictures.length ? { note: "Facebook got the video. A Page post takes a video or pictures, not both." } : {}),
        };
      }

      if (pictures.length === 1) {
        const made = await make(session, `${API.facebook}/${page}/photos`, { url: photos.link(delivery.user_id, pictures[0].id), ...(message ? { caption: message } : {}) }, "post the picture");
        const id = String(made.post_id ?? made.id);
        return { state: "sent", publishId: id, url: await urlOf(session, id, `https://www.facebook.com/${id}`) };
      }

      if (pictures.length > 1) {
        // Each picture goes up unpublished, and one post shows them together. Pictures not posted are dropped by Facebook within a day.
        const attached = [];
        for (const file of pictures.slice(0, MAX_PICTURES)) {
          const photo = await metaFetch(`${API.facebook}/${page}/photos`, { method: "POST", token: session.accessToken, form: { url: photos.link(delivery.user_id, file.id), published: "false" }, timeout: 120_000 });
          if (!photo.ok || !photo.data?.id) throw publishError("facebook", photo.error, "take the post's pictures");
          attached.push({ media_fbid: String(photo.data.id) });
        }
        const made = await make(session, `${API.facebook}/${page}/feed`, { ...(message ? { message } : {}), attached_media: attached }, "post the pictures", { json: true });
        const id = String(made.id);
        return { state: "sent", publishId: id, url: await urlOf(session, id, `https://www.facebook.com/${id}`) };
      }

      const link = linkOf(post);
      if (!message && !link) throw new PublishError("Write something for Facebook, or attach a video or picture.");
      const made = await make(session, `${API.facebook}/${page}/feed`, { ...(message ? { message } : {}), ...(link ? { link } : {}) }, "make the post");
      const id = String(made.id);
      return { state: "sent", publishId: id, url: await urlOf(session, id, `https://www.facebook.com/${id}`) };
    },
  };
}
