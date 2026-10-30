// The words a post goes out with on each network: the caption saved for that
// network when there is one, then the post's shared caption. The title only
// names the post on the calendar, often after its file, so it never goes out:
// a post with no caption goes out with none.

export function captionOf(post, platform) {
  const own = post.captions?.[platform];
  if (typeof own === "string" && own.trim()) return own;
  return typeof post.description === "string" ? post.description : "";
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Characters as people count them, which is how Bluesky counts its limit. */
export const graphemes = (text) => [...segmenter.segment(text)].length;
