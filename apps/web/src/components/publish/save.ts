/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A post is kept on the posts calendar: a scheduled one at its time, a draft
// wherever it was meant to go. TikTok and YouTube publish from here.

import { calendars, checkEvents, createEvent, hydrateCalendar, keepPostFiles, planPostFiles, setPostCaptions, withThreadFiles, type PostFiles } from "@/components/calendar/store";
import type { EventDraft } from "@/components/calendar/types";
import { isDateKey, localDateKey } from "@/components/calendar/utils";

import { msg } from "@/lib/i18n";
import { clockAt, momentOf, timeZone, zoneCity, zonedFormat, zonedParts, zonedTime } from "@/lib/time-zone";
import type { AccountChoices } from "@/lib/social-connections";
import type { InstagramPostSettings, PinterestPostSettings, PlatformId, TikTokPostSettings, XPostSettings, YouTubePostSettings } from "@/lib/social";
import type { ThreadReply } from "@/lib/thread";

export type PlannedPost = {
  /** Saves over the post with this id. */
  id?: string;
  title: string;
  caption: string;
  platforms: readonly PlatformId[];
  /** The account used on each platform. */
  accounts?: AccountChoices;
  link?: string;
  /** `projectKey` of the project the video comes from. */
  projectId?: string;
  /** Seconds into the video of the cover, when one was picked. */
  coverTime?: number | null;
  /**
   * The files it goes out with, in place of any it had: what every network
   * shares, and what networks with their own get. Needs `id`. Absent: a post
   * saved over keeps its files.
   */
  files?: PostFiles;
  tiktok?: TikTokPostSettings;
  youtube?: YouTubePostSettings;
  instagram?: InstagramPostSettings;
  x?: XPostSettings;
  pinterest?: PinterestPostSettings;
  /** A story rather than a post. */
  story?: boolean;
  /** Follow-ups posted under it once it's out. */
  thread?: ThreadReply[];
  /** The words for networks given their own, by platform, which the publisher sends instead of the caption. */
  captions?: Partial<Record<string, string>>;
  when: Date;
  /** A draft with a day but no time yet. Only the day of `when` is read. */
  untimed?: boolean;
  /** How it repeats from `when`, as the calendar keeps it. */
  repeat?: string;
  /** When the repeats stop: `""` never, `on:YYYY-MM-DD`, or `after:N` posts. */
  repeatEnd?: string;
  status: "draft" | "scheduled" | "posted";
};

/** How long a post sits on the calendar's week grid. */
const SLOT_MINUTES = 15;

/** `HH:MM` in the dashboard's time zone. */
export function timeOf(date: Date): string {
  return clockAt(date);
}

/** A `YYYY-MM-DD` and `HH:MM` pair as the moment it names, in the dashboard's time zone. A day that doesn't exist, like 2026-02-30, names none rather than rolling over. */
export function atLocal(day: string, time: string): Date | null {
  return isDateKey(day) ? momentOf(day, time) : null;
}

/** Now, rounded up to the next quarter hour. */
export function nextSlot(from = new Date(), stepMinutes = SLOT_MINUTES): Date {
  const parts = zonedParts(from);
  const minutes = Math.ceil((parts.minutes + 1) / stepMinutes) * stepMinutes;
  return new Date(zonedTime(parts.year, parts.month, parts.date, parts.hours, minutes));
}

/** The furthest out a post can be scheduled. */
export function latestSchedule(from = new Date()): Date {
  const parts = zonedParts(from);
  return new Date(zonedTime(parts.year, parts.month + 2, parts.date, parts.hours, parts.minutes));
}

/** What is wrong with scheduling for `at`, or null. */
export function scheduleProblem(at: Date | null): string | null {
  if (!at) return msg("Pick a date and a time.");
  if (at.getTime() <= Date.now()) return msg("Pick a time in the future.");
  if (at > latestSchedule()) return msg("Posts can be scheduled up to 2 months ahead.");
  return null;
}

/** The first line of a caption, short enough to read on a calendar chip. */
export function postTitle(caption: string, fallback: string): string {
  const line = caption.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  const title = line || fallback;
  return [...title].length > 80 ? `${[...title].slice(0, 79).join("")}…` : title;
}

/** The calendar entry `post` saves as, without its files. */
function draftOf(post: PlannedPost, calendarId: string): EventDraft {
  return {
    id: post.id,
    allDay: !!post.untimed,
    calendarId,
    day: localDateKey(post.when),
    description: post.caption,
    duration: SLOT_MINUTES,
    link: post.link ?? "",
    platforms: [...post.platforms],
    accounts: post.accounts ?? {},
    projectId: post.projectId,
    coverTime: post.coverTime,
    tiktok: post.tiktok,
    youtube: post.youtube,
    instagram: post.instagram,
    x: post.x,
    pinterest: post.pinterest,
    story: post.story,
    thread: post.thread,
    repeat: post.repeat ?? "",
    repeatEnd: post.repeatEnd ?? "",
    start: timeOf(post.when),
    status: post.status,
    title: post.title,
  };
}

/**
 * Puts the posts on the calendar. Returns what went wrong, for the user, or
 * nothing. Every post is checked before any is written, the plan's limit
 * counting them all, so a batch that can't be saved whole saves nothing. A
 * post given an `id` is saved over the one with it, so saving a batch again
 * after a failure partway doesn't make copies of the posts that got saved.
 */
export async function savePosts(posts: readonly PlannedPost[]): Promise<string | undefined> {
  await hydrateCalendar();
  const calendarId = calendars()[0]?.id;
  if (!calendarId) return msg("The posts calendar could not be opened.");
  if (posts.some((post) => Number.isNaN(post.when.getTime()))) return msg("Choose a valid date and time.");
  const problem = checkEvents(posts.map((post) => draftOf(post, calendarId)));
  if (problem) return problem;

  for (const post of posts) {
    // The post lists its files from the first time it's written, so it can't go out without them while they upload.
    const plan = post.id && post.files ? await planPostFiles(post.id, post.files) : null;
    const draft = draftOf(post, calendarId);
    const error = createEvent({ ...draft, ...(plan ? { files: plan.files, ownFiles: plan.ownFiles, thread: withThreadFiles(draft.thread, plan) } : {}) });
    if (error) return error;
    if (post.id && post.captions) setPostCaptions(post.id, post.captions);
    if (post.id && plan) await keepPostFiles(post.id, plan);
  }
}

const WHEN_FORMAT = zonedFormat({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const DAY_FORMAT = zonedFormat({ weekday: "short", day: "numeric", month: "short" });

export const formatWhen = (date: Date): string => WHEN_FORMAT.format(date);
export const formatDay = (date: Date): string => DAY_FORMAT.format(date);

/** "Amsterdam", for the dashboard's time zone. */
export function timeZoneName(): string {
  return zoneCity(timeZone());
}
