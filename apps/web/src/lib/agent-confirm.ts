/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Publishing and deleting always ask. Agents at plan.video/mcp ask for any scheduled post (the publisher sends it
// unseen later); the Assistant asks for posts due within minutes or going to TikTok, where only the person
// may accept TikTok's terms. The handlers, the Assistant and the hosted connector must agree on these rules.

export type ConfirmTool = "schedule_post" | "copy_post" | "update_post" | "publish_post" | "delete_post";

export type ConfirmRequest = {
  tool: ConfirmTool;
  caption: string;
  /** Dashboard time zone; null when it goes out now, or has no day or time. */
  day: string | null;
  time: string | null;
  channels: { platform: string; handle: string }[];
  soon: boolean;
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
  tiktokPrivacy: string | null;
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

/** `every` is for agents at plan.video/mcp: any scheduled post waits, however far out. */
export function needsConfirm(input: { tool: ConfirmTool; scheduled?: boolean; at?: Date | null; tiktokYes?: boolean; every?: boolean; now?: number }): boolean {
  if (input.tool === "publish_post" || input.tool === "delete_post") return true;
  if (!input.scheduled) return false;
  return !!input.every || !!input.tiktokYes || isSoon(input.at ?? null, input.now);
}

/** Must match the timeouts in services/mcp/relay.mjs. */
const RELAY_MS: Partial<Record<string, number>> = {
  publish_post: 600_000,
  schedule_post: 120_000,
  update_post: 120_000,
  copy_post: 120_000,
};
const RELAY_DEFAULT_MS = 60_000;

/** Kept back for the work after a yes: sending takes longest. */
const AFTER_YES_MS: Partial<Record<string, number>> = {
  publish_post: 300_000,
  schedule_post: 30_000,
  update_post: 30_000,
  copy_post: 30_000,
};
const AFTER_YES_DEFAULT_MS = 15_000;

/** So the answer reaches the agent before the relay gives up. */
export function confirmWaitMs(tool: string, arrived: number, now = Date.now()): number {
  const deadline = arrived + (RELAY_MS[tool] ?? RELAY_DEFAULT_MS) - (AFTER_YES_MS[tool] ?? AFTER_YES_DEFAULT_MS);
  return Math.max(0, deadline - now);
}
