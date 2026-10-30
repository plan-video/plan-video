/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { AccountChoices } from "@/lib/social-connections";
import type { InstagramPostSettings, PinterestPostSettings, TikTokPostSettings, XPostSettings, YouTubePostSettings } from "@/lib/social";
import type { ThreadReply } from "@/lib/thread";

export type CalendarView = "month" | "week" | "list";
export type CalendarColor = string;

export type PostStatus = "draft" | "scheduled" | "posted";
export type PostStatusFilter = "all" | PostStatus | "failed";

/** How a post repeats: `""` for never, `weekday`, or `every:N:unit` from its first day. */
export type RepeatOption = string;

/** When a repeating post stops: `""` never, `on:YYYY-MM-DD`, or `after:N` posts. */
export type RepeatEnd = string;

export type Delivery = {
  state: "sending" | "sent" | "failed";
  error?: string;
  waiting?: string;
  /** The platform's id for the upload. Once set, a retry asks after it before sending the video again. */
  publishId?: string;
  /** How it went out other than asked, e.g. "private" when YouTube kept a video private. */
  note?: string;
  attempts: number;
  at: string;
};

export type Calendar = {
  color: CalendarColor;
  createdAt: string;
  id: string;
  name: string;
};

export type StoredEvent = {
  allDay: boolean;
  calendarId: string;
  createdAt: string;
  day: string;
  description: string | null;
  duration: number;
  id: string;
  link: string | null;
  platforms: string[];
  /** Older posts saved a single id; `readChoices` reads both. */
  accounts?: AccountChoices;
  projectId?: string | null;
  /** Absent: the platform chooses. */
  coverTime?: number | null;
  /**
   * Tells the publisher which files to wait for rather than send the words alone.
   * Absent on old posts: those have at most one, under the post's own id.
   */
  files?: string[];
  ownFiles?: Partial<Record<string, string[]>>;
  tiktok?: TikTokPostSettings;
  /** The description is empty when YouTube goes out with the shared caption. */
  youtube?: YouTubePostSettings;
  instagram?: InstagramPostSettings;
  x?: XPostSettings;
  pinterest?: PinterestPostSettings;
  /** A story: one picture or one video, with no caption. */
  story?: boolean;
  thread?: ThreadReply[];
  recurrence: string | null;
  recurrenceExceptions: string[];
  /** Absent or null: it keeps going. */
  recurrenceEnd?: string | null;
  paused?: boolean;
  /**
   * The publisher doesn't send a run due before this on its own, so a post moved
   * into the past, an old draft scheduled or a series resumed doesn't go out at once.
   */
  sendFrom?: string;
  start: string;
  status: PostStatus;
  /** Kept only where they differ from the shared caption, so a change to that reaches every other network. */
  captions?: Partial<Record<string, string>>;
  deliveries?: Partial<Record<string, Delivery>>;
  /** A small JPEG data URL. */
  thumbnail?: string;
  /** Absent on old posts: those used the device's zone. */
  timeZone?: string;
  title: string;
};

export type CalendarEvent = {
  thumbnail?: string;
  allDay: boolean;
  calendarId: string;
  color: CalendarColor;
  day: string;
  description: string | null;
  duration: number;
  id: string;
  link: string | null;
  platforms: string[];
  accounts?: AccountChoices;
  projectId: string | null;
  recurrence: string | null;
  recurrenceEnd: string | null;
  paused: boolean;
  recurring: boolean;
  firstDay?: string;
  sourceId: string;
  start: string;
  status: PostStatus;
  delivery?: "sending" | "failed" | null;
  waiting?: string;
  title: string;
};

export type EventDraft = {
  id?: string;
  allDay: boolean;
  calendarId: string;
  day: string;
  description: string;
  duration: number;
  link: string;
  platforms: string[];
  accounts: AccountChoices;
  /** Editing a post keeps the one it has. */
  projectId?: string;
  coverTime?: number | null;
  files?: string[];
  ownFiles?: Partial<Record<string, string[]>>;
  tiktok?: TikTokPostSettings;
  youtube?: YouTubePostSettings;
  instagram?: InstagramPostSettings;
  x?: XPostSettings;
  pinterest?: PinterestPostSettings;
  story?: boolean;
  thread?: ThreadReply[];
  /** YouTube's is its description. Absent: the post's stay. */
  captions?: Partial<Record<string, string>>;
  repeat: RepeatOption;
  repeatEnd?: RepeatEnd;
  start: string;
  status: PostStatus;
  title: string;
};

export type SelectedEvent = { anchor: DOMRect | null; event: CalendarEvent };
