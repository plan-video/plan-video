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

/** How sending a post to one platform went. */
export type Delivery = {
  state: "sending" | "sent" | "failed";
  /** What went wrong, for the user. */
  error?: string;
  /** While sending: why the publisher is holding it for now, such as today's YouTube uploads being used. It goes on its own later. */
  waiting?: string;
  /** The platform's id for the upload. Once set, a retry asks after it before sending the video again. */
  publishId?: string;
  /** Once sent: how it went out other than asked, such as "private" for a video YouTube kept private. */
  note?: string;
  attempts: number;
  /** When it last changed, as an ISO string. */
  at: string;
};

export type Calendar = {
  color: CalendarColor;
  createdAt: string;
  id: string;
  name: string;
};

/** A post as it is kept on record: one row, however often it repeats. */
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
  /** The accounts it goes out from on each platform, by connection id. Older posts saved a single id; `readChoices` reads both. */
  accounts?: AccountChoices;
  /** The project the post's video comes from. Absent on posts made before projects could be linked. */
  projectId?: string | null;
  /** Seconds into the video of the cover, when one was picked. Absent: the platform chooses. */
  coverTime?: number | null;
  /**
   * The files it goes out with, in order, by the id each is kept under, in
   * this browser and in cloud storage. The files themselves are kept apart,
   * so this tells the publisher which to wait for rather than send the words
   * alone. Empty: none. Absent on posts saved before posts could carry
   * several: those have at most one, under the post's own id.
   */
  files?: string[];
  /** Networks that go out with files of their own instead, by platform id. */
  ownFiles?: Partial<Record<string, string[]>>;
  /** Who can watch, and the other TikTok choices. Absent until they were picked. */
  tiktok?: TikTokPostSettings;
  /**
   * Title, caption, and who can watch on YouTube. Absent until the post
   * includes YouTube. The description is empty when YouTube goes out with the shared caption.
   */
  youtube?: YouTubePostSettings;
  /** Shared to the feed too, and collaborators. Absent until the post includes Instagram. */
  instagram?: InstagramPostSettings;
  /** Who can reply, and the community. Absent until the post includes X. */
  x?: XPostSettings;
  /** The pin's title and board; its link is `link`. Absent until the post includes Pinterest. */
  pinterest?: PinterestPostSettings;
  /** A story: one picture or one video, with no caption. Absent on other posts. */
  story?: boolean;
  /** Follow-ups posted under it once it's out, on the networks that take them (lib/thread.ts). Absent: none. */
  thread?: ThreadReply[];
  recurrence: string | null;
  recurrenceExceptions: string[];
  /** The last day a repeating post can go out on. Absent or null: it keeps going. */
  recurrenceEnd?: string | null;
  /** A paused series stays on the calendar and goes out nowhere until it is resumed. */
  paused?: boolean;
  /**
   * When it was last given its time, or let go out, as an ISO string. The
   * publisher doesn't send a run that came due before this on its own, so a
   * post moved into the past, an old draft scheduled or a series resumed
   * doesn't go out at once. Post now still sends it. Absent on older posts.
   */
  sendFrom?: string;
  start: string;
  status: PostStatus;
  /**
   * The words it goes out with on networks given their own, by platform id:
   * TikTok's caption, Bluesky's and LinkedIn's posts, signature included.
   * Kept only where they differ from the shared caption, so a change to that
   * reaches every other network. The publisher sends these at the post's time.
   */
  captions?: Partial<Record<string, string>>;
  /** Sending to each platform, by platform id. Absent until the post is sent somewhere. */
  deliveries?: Partial<Record<string, Delivery>>;
  /** A small JPEG of the post's picture or video, as a data URL. Absent until one was made. */
  thumbnail?: string;
  /** The zone `day` and `start` are read in. Absent on posts made before zones could be picked: those used the device's. */
  timeZone?: string;
  title: string;
};

/** A post as the calendar draws it: one occurrence, on one day. */
export type CalendarEvent = {
  /** The post's thumbnail, when it has one. */
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
  /** The day a repeating post first goes out, which its cadence counts from. */
  firstDay?: string;
  sourceId: string;
  start: string;
  status: PostStatus;
  /** Going out, or failed to, on any platform. */
  delivery?: "sending" | "failed" | null;
  /** Why it's held while sending, when every network it's going to is waiting. */
  waiting?: string;
  title: string;
};

/** What the create and edit forms hold while the user fills them in. */
export type EventDraft = {
  /** Given when the post is saved over one with this id. */
  id?: string;
  allDay: boolean;
  calendarId: string;
  day: string;
  description: string;
  duration: number;
  link: string;
  platforms: string[];
  accounts: AccountChoices;
  /** Set when the post is made from a project; editing a post keeps the one it has. */
  projectId?: string;
  /** Seconds into the video of the cover, when one was picked. */
  coverTime?: number | null;
  /** The files it goes out with, and those of networks with their own, as `planPostFiles` lays them out. */
  files?: string[];
  ownFiles?: Partial<Record<string, string[]>>;
  tiktok?: TikTokPostSettings;
  youtube?: YouTubePostSettings;
  instagram?: InstagramPostSettings;
  x?: XPostSettings;
  pinterest?: PinterestPostSettings;
  story?: boolean;
  thread?: ThreadReply[];
  /** Words networks have of their own, by platform; YouTube's is its description. Absent: the post's stay. */
  captions?: Partial<Record<string, string>>;
  repeat: RepeatOption;
  /** When a repeating post stops: `""` never, `on:YYYY-MM-DD`, or `after:N` posts. */
  repeatEnd?: RepeatEnd;
  start: string;
  status: PostStatus;
  title: string;
};

export type SelectedEvent = { anchor: DOMRect | null; event: CalendarEvent };
