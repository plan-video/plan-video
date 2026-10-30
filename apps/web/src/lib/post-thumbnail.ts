/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A post's picture, kept on the post itself: a small JPEG that travels with
// the account, so every browser and the desktop app can show it without the
// video. A few kilobytes each.

import { readMedia, releaseMedia, videoStill } from "@/lib/social-media";

/** The longest side, in pixels. Twice the largest place it is shown. */
const SIZE = 160;

/** A picture at `src` made small enough to keep on the post. */
export async function shrinkToThumbnail(src: string): Promise<string | null> {
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const scale = Math.min(1, SIZE / Math.max(image.naturalWidth, image.naturalHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

/** The thumbnail of a post's file: the picture, or the video at its cover (or its first frames). */
export async function thumbnailFromFile(file: File, coverTime?: number | null): Promise<string | null> {
  try {
    const media = await readMedia(file);
    try {
      const src = media.kind === "image" ? media.url : typeof coverTime === "number" ? await videoStill(media, coverTime) : media.poster;
      return await shrinkToThumbnail(src);
    } finally {
      releaseMedia(media);
    }
  } catch {
    return null;
  }
}
