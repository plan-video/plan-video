/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Must match what services/publisher/replies.mjs sends: replies on X and Bluesky (up to 4 pictures or a video),
// words-only comments on LinkedIn.

import { intlLocale, msg, t } from "./i18n";
import { captionLength, formatDuration, socialPlatform, type MediaSummary, type PlatformId, type PostIssue } from "./social";

export type ThreadReply = {
  id: string;
  text: string;
  /** Minutes after the post, or the follow-up before it. */
  delay: number;
  /** By file id, kept like the post's own files. Absent: words alone. */
  files?: string[];
};

/** In the order they're named. */
export const THREAD_PLATFORMS: readonly PlatformId[] = ["x", "linkedin", "bluesky"];

/** The publisher takes no more. */
export const MAX_REPLIES = 10;

export const REPLY_MEDIA_PLATFORMS: readonly PlatformId[] = ["x", "bluesky"];

/** As X and Bluesky take in a post. */
export const MAX_REPLY_PICTURES = 4;

/** LinkedIn's comments are shorter than its posts. */
const REPLY_LIMITS: Partial<Record<PlatformId, number>> = { x: 280, bluesky: 300, linkedin: 1250 };

export const replyLimit = (id: PlatformId) => REPLY_LIMITS[id] ?? socialPlatform(id).captionLimit;

/** In minutes. */
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

export const hasContent = (reply: Pick<ThreadReply, "text" | "files"> & { media?: readonly unknown[] }) =>
  !!reply.text.trim() || !!reply.files?.length || !!reply.media?.length;

/** At most MAX_REPLIES, the ones with words or media. Their files are kept as given. */
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

/** `media` says what each follow-up carries, by its place in the thread. */
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
