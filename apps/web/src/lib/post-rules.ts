/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The rules a post an agent makes has to keep, in the tab (dapi/handlers/posts.ts) and on the
// server (dapi/server/posts.ts) alike. No stores and no browser: services/mcp bundles this file.

import { chooseAccounts, DapiError, promotionFlags, PROMOTION_QUESTION, type TikTokPromotion } from "@plan.video/dapi";
import { everyRecurrence, isDateKey, newId, parseRecurrence, resolveRepeatEnd } from "@/components/calendar/utils";
import { inEnglish, msg } from "@/lib/i18n";
import {
  PLATFORM_IDS,
  PUBLISHING_PLATFORMS,
  SOCIAL_PLATFORMS,
  YOUTUBE_TAGS_LIMIT,
  captionLength,
  checkPost,
  defaultPlatformSettings,
  socialPlatform,
  youtubeFormat,
  youtubePostSettings,
  youtubeTag,
  youtubeTagsLength,
  type MediaSummary,
  type PlatformId,
  type PostKind,
  type SocialPlatform,
  type TikTokPostSettings,
  type YouTubePostSettings,
} from "@/lib/social";
import { REPLY_DELAYS, threadIssues, type ThreadReply } from "@/lib/thread";
import { timeZone, zonedParts, zonedTime } from "@/lib/time-zone";

import type { StoredEvent } from "@/components/calendar/types";
import type { AccountChoices } from "@/lib/social-connections";

export function postTitle(caption: string, fallback: string): string {
  const line = caption.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  const title = line || fallback;
  return [...title].length > 80 ? `${[...title].slice(0, 79).join("")}…` : title;
}

export function latestSchedule(from = new Date(), zone = timeZone()): Date {
  const parts = zonedParts(from, zone);
  return new Date(zonedTime(parts.year, parts.month + 2, parts.date, parts.hours, parts.minutes, zone));
}

export function scheduleProblem(at: Date | null, zone = timeZone(), now = Date.now()): string | null {
  if (!at) return msg("Pick a date and a time.");
  if (at.getTime() <= now) return msg("Pick a time in the future.");
  if (at > latestSchedule(new Date(now), zone)) return msg("Posts can be scheduled up to 2 months ahead.");
  return null;
}

export const CAPTION_NOTE =
  "One caption is stored for every platform on a post. If it is over a platform's limit, shorten it or leave that platform off.";

export const PUBLISHES = new Set<string>(PUBLISHING_PLATFORMS);
// YouTube needs a video, TikTok and Instagram a video or pictures; the others can post words alone.
export const NEEDS_FILE = new Set<string>(["tiktok", "youtube", "instagram"]);

export type RepeatInput = {
  every?: number;
  unit: "day" | "week" | "month" | "weekday";
  until?: string;
  times?: number;
};

export type YouTubeInput = {
  title?: string;
  privacy?: YouTubePostSettings["privacy"];
  madeForKids?: boolean;
  tags?: string[];
};

export type TikTokInput = {
  privacy?: TikTokPostSettings["privacy"];
  comments?: boolean;
  duet?: boolean;
  stitch?: boolean;
  promotion?: TikTokPromotion;
  agreed?: boolean;
  inbox?: boolean;
};

export function threadOf(input: readonly { text: string; delayMinutes?: number }[] | undefined, platforms: readonly PlatformId[]): ThreadReply[] | undefined {
  if (input === undefined) return undefined;
  const thread = input
    .filter((reply) => reply.text.trim())
    .map((reply) => {
      const wanted = reply.delayMinutes ?? 0;
      const nearest = REPLY_DELAYS.reduce((best, option) => (Math.abs(option.minutes - wanted) < Math.abs(best - wanted) ? option.minutes : best), 0);
      return { id: newId(), text: reply.text.trim(), delay: nearest };
    });
  const problem = inEnglish(() => threadIssues(thread, platforms)[0]);
  if (problem) throw new DapiError("invalid-input", `${socialPlatform(problem.platform).name}: ${problem.message}`);
  return thread;
}

// Only the fields that were passed, so they don't wipe the ones they'd sit over.
export function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, item]) => item !== undefined)) as Partial<T>;
}

export function isPlatform(id: string): id is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(id);
}

export function clock(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 23 || minutes > 59) throw new DapiError("invalid-input", "Time is HH:MM, 24-hour, such as 09:00.");
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** One already on a post can stay, as a person can take it off in their own time. */
export function refuseSoon(platforms: readonly PlatformId[], existing: readonly string[] = []) {
  const soon = platforms.filter((id) => !PUBLISHES.has(id) && !existing.includes(id)).map((id) => socialPlatform(id).name);
  if (soon.length) throw new DapiError("unsupported", `${soon.join(", ")} ${soon.length === 1 ? "is" : "are"} coming soon, so Plan Video can't post there yet. Leave ${soon.length === 1 ? "it" : "them"} off the post.`);
}

export function repeatOf(repeat: RepeatInput | undefined, day: string): { repeat: string; repeatEnd: string } {
  if (!repeat) return { repeat: "", repeatEnd: "" };
  if (repeat.until && repeat.times) throw new DapiError("invalid-input", "A repeat ends on a day or after a number of posts, not both.");
  if (repeat.until && !isDateKey(repeat.until)) throw new DapiError("invalid-input", "The repeat end needs a day as YYYY-MM-DD.");
  const recurrence = repeat.unit === "weekday" ? "weekday" : everyRecurrence(repeat.every ?? 0, repeat.unit);
  if (!parseRecurrence(recurrence)) throw new DapiError("invalid-input", "Say how often it repeats, for example every 1 week.");
  const repeatEnd = repeat.until ? `on:${repeat.until}` : repeat.times ? `after:${repeat.times}` : "";
  const end = resolveRepeatEnd(repeatEnd || undefined, recurrence, day);
  if (end && end < day) throw new DapiError("invalid-input", "Pick an end on or after the first post.");
  return { repeat: recurrence, repeatEnd };
}

export function cleanTags(tags: readonly string[]): string[] {
  const cleaned = tags.map((tag) => youtubeTag(tag)).filter((tag): tag is string => !!tag);
  if (cleaned.some((tag) => captionLength(tag) > 30)) throw new DapiError("invalid-input", "A YouTube tag can be 30 characters.");
  if (youtubeTagsLength(cleaned) > YOUTUBE_TAGS_LIMIT) {
    throw new DapiError("invalid-input", `YouTube tags are over the ${YOUTUBE_TAGS_LIMIT} character limit.`);
  }
  return cleaned;
}

export function youtubeOf(
  input: YouTubeInput | undefined,
  existing: YouTubePostSettings | undefined,
  platforms: readonly PlatformId[],
  caption: string,
  media: MediaSummary | null,
  fallbackTitle = existing?.title,
): YouTubePostSettings | undefined {
  if (!platforms.includes("youtube")) return undefined;
  const settings = defaultPlatformSettings();
  settings.youtube.privacy = input?.privacy ?? existing?.privacy ?? "public";
  settings.youtube.madeForKids = input?.madeForKids ?? existing?.madeForKids ?? false;
  settings.youtube.tags = input?.tags ? cleanTags(input.tags) : (existing?.tags ?? []);
  const title = input?.title?.trim() || fallbackTitle || postTitle(caption, "Untitled post");
  settings.youtube.title = title;
  const next = youtubePostSettings(settings, caption, { title, short: media ? youtubeFormat(media) === "short" : existing?.short === true });
  if (!(media ? youtubeFormat(media) === "short" : existing?.short === true)) delete next.short;
  return next;
}

export function tiktokOf(input: TikTokInput | undefined, existing?: TikTokPostSettings): TikTokPostSettings | undefined {
  const inbox = input?.inbox ?? existing?.inbox ?? false;
  if (inbox) {
    return {
      privacy: input?.privacy ?? existing?.privacy ?? "private",
      comments: false,
      duet: false,
      stitch: false,
      yourBrand: false,
      brandedContent: false,
      inbox: true,
    };
  }
  const answered = existing && !existing.inbox ? existing : undefined;
  const privacy = input?.privacy ?? answered?.privacy;
  if (!privacy) return undefined;
  // Who can watch and whether it promotes something are picked together, as on the post screen.
  if (!answered && !input?.promotion) throw new DapiError("invalid-input", PROMOTION_QUESTION);
  const promotion = input?.promotion
    ? promotionFlags(input.promotion)
    : { yourBrand: answered?.yourBrand ?? false, brandedContent: answered?.brandedContent ?? false };
  if (promotion.brandedContent && privacy === "private") {
    throw new DapiError("invalid-input", "Branded content can't be private on TikTok. Ask the user for another privacy, or to take branded content off.");
  }
  return {
    privacy,
    comments: input?.comments ?? answered?.comments ?? false,
    duet: input?.duet ?? answered?.duet ?? false,
    stitch: input?.stitch ?? answered?.stitch ?? false,
    ...promotion,
  };
}

export function requireTikTok(platforms: readonly PlatformId[], tiktok: TikTokPostSettings | undefined, scheduling: boolean) {
  if (!scheduling || !platforms.includes("tiktok") || tiktok?.inbox || tiktok?.privacy) return;
  throw new DapiError(
    "invalid-input",
    "TikTok needs who can watch. Call tiktok_creator for the choices this account has, ask the user, and pass tiktok.privacy with tiktok.promotion. Or set tiktok.inbox so it goes to the TikTok app as a draft. Save with draft true if you don't know yet.",
  );
}

// TikTok wants the person's yes before posting to the profile; the inbox is finished in TikTok.
export const toProfile = (platforms: readonly string[], tiktok: TikTokPostSettings | undefined): tiktok is TikTokPostSettings =>
  platforms.includes("tiktok") && !!tiktok && !tiktok.inbox;

// Networks with words of their own (`own`) are checked by those instead of the caption.
export function assertFits(input: {
  kind: PostKind;
  platforms: readonly PlatformId[];
  caption: string;
  own?: Partial<Record<string, string>>;
  title: string;
  media: (platform: PlatformId) => MediaSummary | null;
}): string[] {
  // The checks also speak to people in the app's language; the agent reads them in English.
  const issues = inEnglish(() =>
    checkPost({
      kind: input.kind,
      platforms: input.platforms,
      caption: (id) => input.own?.[id] ?? input.caption,
      title: (id) => (id === "youtube" || id === "pinterest" ? input.title : ""),
      media: input.media,
    }),
  );
  const errors = issues.filter((issue) => issue.level === "error");
  if (errors.length > 0) {
    throw new DapiError("invalid-input", errors.map((issue) => `${socialPlatform(issue.platform).name}: ${issue.message}`).join(" "));
  }
  return issues.filter((issue) => issue.level === "warning").map((issue) => `${socialPlatform(issue.platform).name}: ${issue.message}`);
}

export function platformNotes(platform: SocialPlatform): string {
  const pictures = Math.min(platform.maxImages, platform.publishedImages ?? platform.maxImages);
  const parts = [
    PUBLISHES.has(platform.id)
      ? platform.id === "youtube"
        ? "Plan Video can upload a video here."
        : platform.id === "tiktok"
          ? `Plan Video can post here: a video, or up to ${pictures} pictures as a photo post.`
          : `Plan Video can post here: the words, with the post's video or up to ${pictures} of its pictures.`
      : "Kept on the calendar. Plan Video doesn't send to this platform yet.",
  ];
  if (platform.title?.required) parts.push("A title is required.");
  if (!platform.kinds.includes("text")) parts.push("Needs a picture or a video.");
  if (platform.id === "tiktok") {
    parts.push(
      "Before scheduling or publishing to the profile, call tiktok_creator, ask the user who can watch and whether the post promotes something, and have them accept TikTok's terms. Or pass inbox true to finish it in TikTok.",
    );
  }
  return parts.join(" ");
}

export function socialSchemaView(platform?: string) {
  return {
    caption: CAPTION_NOTE,
    platforms: SOCIAL_PLATFORMS.filter((item) => !platform || item.id === platform).map((item) => ({
      id: item.id,
      name: item.name,
      captionLimit: item.captionLimit,
      maxVideoSeconds: item.maxVideoSeconds,
      maxImages: item.maxImages,
      hashtagLimit: item.maxHashtags ?? null,
      kinds: [...item.kinds],
      publishes: PUBLISHES.has(item.id),
      media: item.kinds.includes("text") ? ("optional" as const) : ("required" as const),
      notes: platformNotes(item),
    })),
  };
}

/** An account an agent may see: never its login. */
export type AccountName = { id: string; platform: string; handle: string };

/** Including older ones that held a single id per platform. */
export function readChoices(value: unknown): AccountChoices {
  const next: AccountChoices = {};
  if (!value || typeof value !== "object") return next;
  for (const [platform, ids] of Object.entries(value)) {
    const list = typeof ids === "string" ? [ids] : Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
    if (list.length) next[platform] = [...new Set(list)];
  }
  return next;
}

export function pickAccounts(connections: readonly AccountName[], platforms: readonly PlatformId[], requested: readonly string[] | undefined): AccountChoices {
  const result = chooseAccounts(
    platforms,
    requested,
    connections.map(({ id, platform, handle }) => ({ id, platform, handle })),
    (id) => (isPlatform(id) ? socialPlatform(id).name : id),
  );
  if (!result.ok) throw new DapiError("invalid-input", result.message);
  return result.choices;
}

export function keptAccountIds(connections: readonly AccountName[], platform: PlatformId, ids: readonly string[]): string[] {
  return ids.filter((id) => connections.some((account) => account.id === id && account.platform === platform));
}

// A platform with no account named is chosen only when it has exactly one.
// One whose accounts were all disconnected keeps naming them, so the post goes
// out from none there rather than from another account.
export function mergeAccountChoices(
  connections: readonly AccountName[],
  platforms: readonly PlatformId[],
  requested: readonly string[] | undefined,
  existing: AccountChoices | undefined,
): AccountChoices {
  if (requested && requested.length > 0) return pickAccounts(connections, platforms, requested);
  const previous = readChoices(existing);
  const missing: PlatformId[] = [];
  const keeping: PlatformId[] = [];
  const keptIds: string[] = [];
  const removed: AccountChoices = {};
  for (const platform of platforms) {
    const named = previous[platform] ?? [];
    const kept = keptAccountIds(connections, platform, named);
    if (kept.length > 0) {
      keeping.push(platform);
      keptIds.push(...kept);
    } else if (named.length > 0) removed[platform] = named;
    else missing.push(platform);
  }
  const kept = keeping.length > 0 ? pickAccounts(connections, keeping, keptIds) : {};
  const added = missing.length > 0 ? pickAccounts(connections, missing, undefined) : {};
  return { ...kept, ...added, ...removed };
}

export function removedAccountNotes(connections: readonly AccountName[], platforms: readonly PlatformId[], choices: AccountChoices): string[] {
  return platforms
    .filter((platform) => (choices[platform]?.length ?? 0) > 0 && keptAccountIds(connections, platform, choices[platform] ?? []).length === 0)
    .map((platform) => {
      const name = socialPlatform(platform).name;
      return `${name}: The account it named was removed, so it won't go out on ${name} until you pass accounts with a ${name} id from social_accounts.`;
    });
}

export function postViewOf(post: StoredEvent, scope: { connections: readonly AccountName[]; timeZone: string }, warnings: string[] = []) {
  const platforms = [];
  for (const id of post.platforms) {
    if (!isPlatform(id)) continue;
    const chosen = readChoices(post.accounts)[id] ?? [];
    const ids = chosen.length > 0 ? chosen : [""];
    for (const accountId of ids) {
      const found = scope.connections.find((account) => account.id === accountId);
      platforms.push({ platform: id, accountId, handle: found?.handle ?? "", publishes: PUBLISHES.has(id) });
    }
  }
  const deliveries = Object.entries(post.deliveries ?? {}).flatMap(([id, delivery]) => {
    if (!delivery || !isPlatform(id)) return [];
    return [{ platform: id, state: delivery.state, ...(delivery.error ? { error: delivery.error } : {}) }];
  });
  return {
    id: post.id,
    status: post.status,
    title: post.title,
    caption: post.description ?? "",
    day: post.day,
    time: post.allDay ? null : post.start,
    timeZone: post.timeZone || scope.timeZone,
    platforms,
    repeat: post.recurrence,
    link: post.link,
    thread: (post.thread ?? []).map((reply) => ({ text: reply.text, delayMinutes: reply.delay })),
    warnings,
    deliveries,
  };
}
