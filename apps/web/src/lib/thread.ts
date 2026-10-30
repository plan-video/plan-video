/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A post's thread: follow-ups the publisher posts under it once it's out,
// each a while after the one before. X and Bluesky make each a reply to the
// one before; LinkedIn makes each a comment on the post. The other networks
// get the post alone. A follow-up can carry up to 4 pictures or a video on X
// and Bluesky; LinkedIn's comments take its words alone.
// services/publisher/replies.mjs sends them.

import { intlLocale, msg, t } from "./i18n";
import { captionLength, formatDuration, socialPlatform, type MediaSummary, type PlatformId, type PostIssue } from "./social";

export type ThreadReply = {
  id: string;
  text: string;
  /** Minutes after the post, or the follow-up before it, that this one goes out. */
  delay: number;
  /** The pictures or video it carries, by file id, kept like the post's own files. Absent: words alone. */
  files?: string[];
};

/** Networks that post a thread, in the order they're named. */
export const THREAD_PLATFORMS: readonly PlatformId[] = ["x", "linkedin", "bluesky"];

/** Follow-ups one post can have. The publisher takes no more. */
export const MAX_REPLIES = 10;

/** Networks whose follow-ups carry media. */
export const REPLY_MEDIA_PLATFORMS: readonly PlatformId[] = ["x", "bluesky"];

/** Pictures one follow-up can carry, as X and Bluesky take in a post. */
export const MAX_REPLY_PICTURES = 4;

/** The longest follow-up each network takes. LinkedIn's comments are shorter than its posts. */
const REPLY_LIMITS: Partial<Record<PlatformId, number>> = { x: 280, bluesky: 300, linkedin: 1250 };

export const replyLimit = (id: PlatformId) => REPLY_LIMITS[id] ?? socialPlatform(id).captionLimit;

/** The waits a follow-up can have, in minutes. */
export const REPLY_DELAYS: readonly { minutes: number; label: string }[] = [
  { minutes: 0, label: msg("Right away") },
  { minutes: 1, label: msg("1 minute") },
  { minutes: 5, label: msg("5 minutes") },
  { minutes: 15, label: msg("15 minutes") },
  { minutes: 30, label: msg("30 minutes") },
  { minutes: 60, label: msg("1 hour") },
  { minutes: 180, label: msg("3 hours") },
  { minutes: 360, label: msg("6 hours") },
  { minutes: 720, label: msg("12 hours") },
  { minutes: 1440, label: msg("1 day") },
];

export const threadPlatforms = (platforms: readonly PlatformId[]) => THREAD_PLATFORMS.filter((id) => platforms.includes(id));

/** Whether a follow-up has anything to post: words, or media. */
export const hasContent = (reply: Pick<ThreadReply, "text" | "files"> & { media?: readonly unknown[] }) =>
  !!reply.text.trim() || !!reply.files?.length || !!reply.media?.length;

/** The follow-ups worth keeping, in order, at most MAX_REPLIES: the ones with words or media. Their files are kept as given. */
export function keptThread<T extends Pick<ThreadReply, "id" | "text" | "delay" | "files"> & { media?: readonly unknown[] }>(thread: readonly T[] | undefined): ThreadReply[] {
  return (thread ?? [])
    .filter(hasContent)
    .slice(0, MAX_REPLIES)
    .map((reply) => ({
      id: reply.id,
      text: reply.text.trim(),
      delay: REPLY_DELAYS.some((option) => option.minutes === reply.delay) ? reply.delay : 0,
      ...(reply.files?.length ? { files: [...reply.files] } : {}),
    }));
}

/**
 * Follow-ups a network the thread goes out on can't take: too long, too much
 * media, a video too long, or nothing it can post. `media` says what each
 * follow-up carries, by its place in the thread.
 */
export function threadIssues(thread: readonly ThreadReply[], platforms: readonly PlatformId[], media: (index: number) => MediaSummary | null = () => null): PostIssue[] {
  const issues: PostIssue[] = [];
  thread.forEach((reply, index) => {
    const number = index + 1;
    const length = captionLength(reply.text.trim());
    const carries = media(index);
    for (const id of threadPlatforms(platforms)) {
      const add = (level: PostIssue["level"], message: string) => issues.push({ platform: id, level, message });
      const limit = replyLimit(id);
      if (length > limit) add("error", t("Follow-up {number} is over the {limit} character limit.", { number, limit: limit.toLocaleString(intlLocale()) }));
      if (!carries) continue;
      if (!REPLY_MEDIA_PLATFORMS.includes(id)) {
        if (!length) add("warning", t("Follow-up {number} has no words, so {network} skips it.", { number, network: socialPlatform(id).name }));
        continue;
      }
      const most = socialPlatform(id).maxVideoSeconds;
      if (carries.kind === "video" && carries.duration > most) {
        add("error", t("Follow-up {number}'s video is over {network}'s {duration}.", { number, network: socialPlatform(id).name, duration: formatDuration(most) }));
      }
    }
  });
  return issues;
}
