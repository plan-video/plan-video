/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// When an agent's call waits for the signed-in person's yes, and what they're
// shown. Publishing and deleting always ask. For agents connected at
// plan.video/mcp, every call that leaves a post scheduled asks too: the
// publisher sends it later without anyone looking again. The Assistant asks
// when a post goes out within a few minutes, which works like Post now, or
// when it goes to a TikTok profile, where only the person may accept TikTok's
// terms. Plain rules, so the handlers, the Assistant and the hosted connector
// agree on them.

/** The calls that can wait for a yes. */
export type ConfirmTool = "schedule_post" | "copy_post" | "update_post" | "publish_post" | "delete_post";

/** What the person is asked about: the call, and the post as it would go out. */
export type ConfirmRequest = {
  tool: ConfirmTool;
  caption: string;
  /** YYYY-MM-DD and HH:MM in the dashboard time zone; null when it goes out now, or has no day or time. */
  day: string | null;
  time: string | null;
  channels: { platform: string; handle: string }[];
  /** It goes out within CONFIRM_LEAD_MS. */
  soon: boolean;
  /** Set when it goes to a TikTok profile: the person's yes is their yes to TikTok's terms. */
  tiktok: { branded: boolean } | null;
  /** The rest of what goes out, shown in full so nothing rides along unseen. Unset for a delete. */
  details?: ConfirmDetails;
};

/** Everything besides the caption that a scheduled or changed post goes out with. */
export type ConfirmDetails = {
  link: string;
  /** The names of the files this browser has, and how many more are kept in cloud storage. */
  files: string[];
  filesElsewhere: number;
  /** The repeat as stored on the post, from `day`, and its last day. */
  repeat: { recurrence: string; end: string | null } | null;
  youtube: { title: string; privacy: string; madeForKids: boolean; tags: string[] } | null;
  /** Who can watch on TikTok; null when it goes to the TikTok inbox or not to TikTok. */
  tiktokPrivacy: string | null;
  /** Words a network sends instead of the caption. */
  captions: { platform: string; text: string }[];
  /** Follow-ups posted under it, in order: their words, minutes after the one before, and how many files each carries. */
  thread: { text: string; delay: number; files: number }[];
};

/** A post due sooner than this is as good as Post now, so it asks first. */
export const CONFIRM_LEAD_MS = 10 * 60_000;

/** What the agent is told when the person says no, or doesn't answer in time. */
export const NOT_CONFIRMED = "The person didn't confirm in plan.video, so nothing was done. Ask them before trying again.";

/** Whether `at` is in less than CONFIRM_LEAD_MS, or already past. */
export function isSoon(at: Date | null, now = Date.now()): boolean {
  return !!at && at.getTime() - now < CONFIRM_LEAD_MS;
}

/**
 * Whether a call waits for the person. `scheduled` is whether the post ends up
 * with a send time (not a draft), `at` that time, and `tiktokYes` whether it
 * needs a new yes to TikTok's terms. `every` is set for agents connected at
 * plan.video/mcp: then any scheduled post waits, however far out it goes.
 */
export function needsConfirm(input: { tool: ConfirmTool; scheduled?: boolean; at?: Date | null; tiktokYes?: boolean; every?: boolean; now?: number }): boolean {
  if (input.tool === "publish_post" || input.tool === "delete_post") return true;
  if (!input.scheduled) return false;
  return !!input.every || !!input.tiktokYes || isSoon(input.at ?? null, input.now);
}

/** How long the relay (services/mcp/relay.mjs) gives each call before it tells the agent the tab didn't answer. */
const RELAY_MS: Partial<Record<string, number>> = {
  publish_post: 600_000,
  schedule_post: 120_000,
  update_post: 120_000,
  copy_post: 120_000,
};
const RELAY_DEFAULT_MS = 60_000;

/** Kept back for the work after a yes: sending takes longest, a save or a delete far less. */
const AFTER_YES_MS: Partial<Record<string, number>> = {
  publish_post: 300_000,
  schedule_post: 30_000,
  update_post: 30_000,
  copy_post: 30_000,
};
const AFTER_YES_DEFAULT_MS = 15_000;

/** How long a connector call that arrived at `arrived` may still wait for the person, so the answer reaches the agent before the relay gives up. */
export function confirmWaitMs(tool: string, arrived: number, now = Date.now()): number {
  const deadline = arrived + (RELAY_MS[tool] ?? RELAY_DEFAULT_MS) - (AFTER_YES_MS[tool] ?? AFTER_YES_DEFAULT_MS);
  return Math.max(0, deadline - now);
}
