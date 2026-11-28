/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What the Assistant asks the person before it does: publishing and deleting always, and posts due within
// minutes or going to TikTok, where only the person may accept TikTok's terms. Agents at plan.video/mcp are asked
// by their own app instead, which goes by each tool's annotations.

export type ConfirmTool = "schedule_post" | "copy_post" | "update_post" | "publish_post" | "delete_post";

export type ConfirmRequest = {
  tool: ConfirmTool;
  caption: string;
  /** Dashboard time zone; null when it goes out now, or has no day or time. */
  day: string | null;
  time: string | null;
  channels: { platform: string; handle: string }[];
  soon: boolean;
  /** A scheduled post this would stop going out. */
  leavesSchedule?: boolean;
  /** The person's yes is their yes to TikTok's terms. */
  tiktok: { branded: boolean } | null;
  /** Shown in full so nothing rides along unseen. Unset for a delete. */
  details?: ConfirmDetails;
};

export type ConfirmDetails = {
  link: string;
  /** Plus how many more are kept in cloud storage. */
  files: string[];
  filesElsewhere: number;
  repeat: { recurrence: string; end: string | null } | null;
  youtube: { title: string; privacy: string; madeForKids: boolean; tags: string[] } | null;
  /** Null when it goes to the TikTok inbox or not to TikTok. */
  tiktok: { privacy: string; comments: boolean; duet: boolean; stitch: boolean; yourBrand: boolean; brandedContent: boolean } | null;
  captions: { platform: string; text: string }[];
  /** `delay` is minutes after the one before; `files` is how many each carries. */
  thread: { text: string; delay: number; files: number }[];
};

/** A post due sooner than this is as good as Post now, so it asks first. */
export const CONFIRM_LEAD_MS = 10 * 60_000;

export const NOT_CONFIRMED = "The person didn't confirm in plan.video, so nothing was done. Ask them before trying again.";

export function isSoon(at: Date | null, now = Date.now()): boolean {
  return !!at && at.getTime() - now < CONFIRM_LEAD_MS;
}

export function needsConfirm(input: { tool: ConfirmTool; scheduled?: boolean; at?: Date | null; tiktokYes?: boolean; now?: number }): boolean {
  if (input.tool === "publish_post" || input.tool === "delete_post") return true;
  if (!input.scheduled) return false;
  return !!input.tiktokYes || isSoon(input.at ?? null, input.now);
}
