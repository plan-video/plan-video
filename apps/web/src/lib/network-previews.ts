/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { PlatformId } from "./social";

/** Shares of the screen's width (left, right) and height (top, bottom) that the app draws over. */
export type Insets = { top: number; right: number; bottom: number; left: number };

export type PreviewChrome = "tiktok" | "reels" | "story" | "facebook-reels" | "shorts" | "youtube" | "post" | "pin";

export type NetworkPreview = {
  id: string;
  network: PlatformId;
  /** In place of the network's own name. */
  name?: string;
  group: "screen" | "feed";
  /** Width over height of the app's screen, the video fitted inside it; null: the video keeps its own shape, inside a post. */
  screen: number | null;
  safe: Insets;
  chrome: PreviewChrome;
};

const VERTICAL = 9 / 16;
const POST_SAFE: Insets = { top: 0.03, right: 0.03, bottom: 0.08, left: 0.03 };

// What each app's own buttons and words cover on a 1080×1920 phone, with a little room to spare.
export const NETWORK_PREVIEWS: readonly NetworkPreview[] = [
  { id: "tiktok", network: "tiktok", group: "screen", screen: VERTICAL, chrome: "tiktok", safe: { top: 0.07, right: 0.13, bottom: 0.15, left: 0.04 } },
  { id: "instagram-reels", network: "instagram", name: "Instagram Reels", group: "screen", screen: VERTICAL, chrome: "reels", safe: { top: 0.07, right: 0.12, bottom: 0.15, left: 0.04 } },
  { id: "instagram-story", network: "instagram", name: "Instagram Stories", group: "screen", screen: VERTICAL, chrome: "story", safe: { top: 0.1, right: 0.04, bottom: 0.1, left: 0.04 } },
  { id: "youtube-shorts", network: "youtube", name: "YouTube Shorts", group: "screen", screen: VERTICAL, chrome: "shorts", safe: { top: 0.07, right: 0.13, bottom: 0.17, left: 0.04 } },
  { id: "facebook-reels", network: "facebook", name: "Facebook Reels", group: "screen", screen: VERTICAL, chrome: "facebook-reels", safe: { top: 0.07, right: 0.13, bottom: 0.15, left: 0.04 } },
  { id: "youtube-video", network: "youtube", group: "feed", screen: 16 / 9, chrome: "youtube", safe: { top: 0.1, right: 0.03, bottom: 0.13, left: 0.03 } },
  { id: "facebook-post", network: "facebook", group: "feed", screen: null, chrome: "post", safe: POST_SAFE },
  { id: "x-post", network: "x", name: "X", group: "feed", screen: null, chrome: "post", safe: POST_SAFE },
  { id: "threads-post", network: "threads", group: "feed", screen: null, chrome: "post", safe: POST_SAFE },
  { id: "linkedin-post", network: "linkedin", group: "feed", screen: null, chrome: "post", safe: POST_SAFE },
  { id: "bluesky-post", network: "bluesky", group: "feed", screen: null, chrome: "post", safe: POST_SAFE },
  { id: "pinterest-pin", network: "pinterest", group: "feed", screen: null, chrome: "pin", safe: POST_SAFE },
];

type Rect = { x: number; y: number; width: number; height: number };

/** How far a post reaches past its video on each side, in units of `previewUnit`. */
export function postFrame(preview: NetworkPreview): Insets {
  if (preview.chrome === "pin") return { top: 0, right: 0, bottom: 15, left: 0 };
  // X, Threads and Bluesky indent the media under the name; Facebook and LinkedIn run it edge to edge.
  const indented = preview.network === "x" || preview.network === "threads" || preview.network === "bluesky";
  return indented ? { top: 16, right: 4, bottom: 12, left: 16 } : { top: 22, right: 4, bottom: 12, left: 4 };
}

/**
 * What the app's buttons and words are sized in: a hundredth of its screen's width.
 * A feed shows a tall video narrower than a wide one, so a post goes by the longer side.
 */
export function previewUnit(video: Rect, preview: NetworkPreview): number {
  if (preview.screen !== null) return previewScreen(video, preview.screen).width / 100;
  return Math.max(video.width, video.height) * 0.0075;
}

/** Everything the preview draws, to fit the view to. */
export function previewBounds(video: Rect, preview: NetworkPreview): Rect {
  if (preview.screen !== null) return previewScreen(video, preview.screen);
  const frame = postFrame(preview);
  const unit = previewUnit(video, preview);
  return {
    x: video.x - frame.left * unit,
    y: video.y - frame.top * unit,
    width: video.width + (frame.left + frame.right) * unit,
    height: video.height + (frame.top + frame.bottom) * unit,
  };
}

/** The app's screen around the video: the smallest box of that shape holding it, centred on it, as the app letterboxes. */
export function previewScreen(video: Rect, aspect: number | null): Rect {
  if (aspect === null || video.width <= 0 || video.height <= 0) return video;
  const width = Math.max(video.width, video.height * aspect);
  const height = width / aspect;
  return { x: video.x + (video.width - width) / 2, y: video.y + (video.height - height) / 2, width, height };
}
