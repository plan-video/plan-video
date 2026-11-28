/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { StreamSource } from "@/lib/stream-clips";

export const SOURCE_NAMES: Record<StreamSource, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };

/** Where to watch a broadcast on its own platform. */
export function sourceUrl(id: string, source: StreamSource | undefined): string {
  if (source === "kick") return `https://kick.com/video/${id.replace(/^kick:/, "")}`;
  if (source === "youtube") return `https://www.youtube.com/watch?v=${id.replace(/^yt:/, "")}`;
  return `https://www.twitch.tv/videos/${id}`;
}
