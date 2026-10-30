/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { isUrlSource } from "@plan.video/assets";
import {
  checkTikTokCreator,
  chooseAccounts,
  DapiError,
  promotionFlags,
  PROMOTION_QUESTION,
  tiktokConsent,
  type TikTokPromotion,
  type ToolArgs,
} from "@plan.video/dapi";
import { getAssetFile } from "@plan.video/runtime";
import { allPosts, deleteEvent, hydrateCalendar, loadError, loadPostFiles, ownCaptions, postFileIds, postFiles, revisePost, setPostFiles } from "@/components/calendar/store";
import { everyRecurrence, isDateKey, localDateKey, newId, parseRecurrence, resolveRepeatEnd } from "@/components/calendar/utils";
import { atLocal, postTitle, savePosts, scheduleProblem, timeOf } from "@/components/publish/save";
import { hasFailed, PUBLISHING_PLATFORMS, sendPost } from "@/components/publish/publisher";
import { resolveAsset } from "../lib/assets";
import { accountsFor, loadSocialConnections, readChoices, socialConnections } from "@/lib/social-connections";
import {
  PLATFORM_IDS,
  SOCIAL_PLATFORMS,
  YOUTUBE_TAGS_LIMIT,
  captionLength,
  checkPost,
  defaultPlatformSettings,
  isAspect,
  listNames,
  socialPlatform,
  sortPlatforms,
  youtubeFormat,
  youtubePostSettings,
  youtubeTag,
  youtubeTagsLength,
} from "@/lib/social";
import { inEnglish } from "@/lib/i18n";
import { loadTikTokCreator, type TikTokCreator } from "@/lib/tiktok";
import { timeZone } from "@/lib/time-zone";
import { REPLY_DELAYS, threadIssues, threadPlatforms, type ThreadReply } from "@/lib/thread";
import { isSoon, needsConfirm, NOT_CONFIRMED, type ConfirmDetails, type ConfirmRequest, type ConfirmTool } from "@/lib/agent-confirm";

import type { ToolHandler, ToolContext } from "../handler";
import type { PostPatch } from "@/components/calendar/store";
import type { StoredEvent } from "@/components/calendar/types";
import type { AccountChoices, SocialConnection } from "@/lib/social-connections";
import type { MediaSummary, PlatformId, PostKind, SocialPlatform, TikTokPostSettings, YouTubePostSettings } from "@/lib/social";

const SIGN_IN = "Sign in to Plan Video before scheduling posts.";

const CAPTION_NOTE =
  "One caption is stored for every platform on a post. If it is over a platform's limit, shorten it or leave that platform off.";

const PUBLISHES = new Set<string>(PUBLISHING_PLATFORMS);
// YouTube needs a video, TikTok and Instagram a video or pictures; the others can post words alone.
const NEEDS_FILE = new Set<string>(["tiktok", "youtube", "instagram"]);

const hasLogin = (account: ReturnType<typeof socialConnections>[number]) =>
  !!(account.tiktok || account.youtube || account.bluesky || account.linkedin || account.x || account.instagram || account.facebook || account.threads);

type RepeatInput = {
  every?: number;
  unit: "day" | "week" | "month" | "weekday";
  until?: string;
  times?: number;
};

type YouTubeInput = {
  title?: string;
  privacy?: YouTubePostSettings["privacy"];
  madeForKids?: boolean;
  tags?: string[];
};

type TikTokInput = {
  privacy?: TikTokPostSettings["privacy"];
  comments?: boolean;
  duet?: boolean;
  stitch?: boolean;
  promotion?: TikTokPromotion;
  agreed?: boolean;
  inbox?: boolean;
};

function threadOf(input: readonly { text: string; delayMinutes?: number }[] | undefined, platforms: readonly PlatformId[]): ThreadReply[] | undefined {
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
function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function isPlatform(id: string): id is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(id);
}

function userOf(ctx: ToolContext) {
  return ctx.app.requireUser(SIGN_IN);
}

async function ready(ctx: ToolContext) {
  const user = userOf(ctx);
  loadSocialConnections(user.id);
  await hydrateCalendar();
  const error = loadError();
  if (error) throw new DapiError("unsupported", error);
  return user;
}

function mapped(message: string): DapiError {
  if (message.includes("no longer exists")) return new DapiError("not-found", message);
  return new DapiError("invalid-input", message);
}

function clock(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 23 || minutes > 59) throw new DapiError("invalid-input", "Time is HH:MM, 24-hour, such as 09:00.");
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function accountsForPost(platforms: readonly PlatformId[], requested: readonly string[] | undefined): AccountChoices {
  const result = chooseAccounts(
    platforms,
    requested,
    socialConnections().map(({ id, platform, handle }) => ({ id, platform, handle })),
    (id) => (isPlatform(id) ? socialPlatform(id).name : id),
  );
  if (!result.ok) throw new DapiError("invalid-input", result.message);
  return result.choices;
}

function connectedIds(platform: PlatformId, ids: readonly string[]): string[] {
  return ids.filter((id) => socialConnections().some((account) => account.id === id && account.platform === platform));
}

// A platform with no account named is chosen only when it has exactly one.
// One whose accounts were all disconnected keeps naming them, so the post goes
// out from none there rather than from another account.
function mergeAccounts(platforms: readonly PlatformId[], requested: readonly string[] | undefined, existing: AccountChoices | undefined): AccountChoices {
  if (requested && requested.length > 0) return accountsForPost(platforms, requested);
  const previous = readChoices(existing);
  const missing: PlatformId[] = [];
  const keeping: PlatformId[] = [];
  const keptIds: string[] = [];
  const removed: AccountChoices = {};
  for (const platform of platforms) {
    const named = previous[platform] ?? [];
    const kept = connectedIds(platform, named);
    if (kept.length > 0) {
      keeping.push(platform);
      keptIds.push(...kept);
    } else if (named.length > 0) removed[platform] = named;
    else missing.push(platform);
  }
  const kept = keeping.length > 0 ? accountsForPost(keeping, keptIds) : {};
  const added = missing.length > 0 ? accountsForPost(missing, undefined) : {};
  return { ...kept, ...added, ...removed };
}

function removedAccounts(platforms: readonly PlatformId[], choices: AccountChoices): string[] {
  return platforms
    .filter((platform) => (choices[platform]?.length ?? 0) > 0 && connectedIds(platform, choices[platform] ?? []).length === 0)
    .map((platform) => {
      const name = socialPlatform(platform).name;
      return `${name}: The account it named was removed, so it won't go out on ${name} until you pass accounts with a ${name} id from social_accounts.`;
    });
}

function repeatOf(repeat: RepeatInput | undefined, day: string): { repeat: string; repeatEnd: string } {
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

function cleanTags(tags: readonly string[]): string[] {
  const cleaned = tags.map((tag) => youtubeTag(tag)).filter((tag): tag is string => !!tag);
  if (cleaned.some((tag) => captionLength(tag) > 30)) throw new DapiError("invalid-input", "A YouTube tag can be 30 characters.");
  if (youtubeTagsLength(cleaned) > YOUTUBE_TAGS_LIMIT) {
    throw new DapiError("invalid-input", `YouTube tags are over the ${YOUTUBE_TAGS_LIMIT} character limit.`);
  }
  return cleaned;
}

function youtubeOf(
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

function tiktokOf(input: TikTokInput | undefined, existing?: TikTokPostSettings): TikTokPostSettings | undefined {
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

function requireTikTok(platforms: readonly PlatformId[], tiktok: TikTokPostSettings | undefined, scheduling: boolean) {
  if (!scheduling || !platforms.includes("tiktok") || tiktok?.inbox || tiktok?.privacy) return;
  throw new DapiError(
    "invalid-input",
    "TikTok needs who can watch. Call tiktok_creator for the choices this account has, ask the user, and pass tiktok.privacy with tiktok.promotion. Or set tiktok.inbox so it goes to the TikTok app as a draft. Save with draft true if you don't know yet.",
  );
}

// TikTok wants the person's yes before posting to the profile; the inbox is finished in TikTok.
const toProfile = (platforms: readonly string[], tiktok: TikTokPostSettings | undefined): tiktok is TikTokPostSettings =>
  platforms.includes("tiktok") && !!tiktok && !tiktok.inbox;

// Where the tab can ask (ctx.confirm) the caller's word doesn't count: this
// passes and askPerson waits for the person's own yes.
function requireAgreed(ctx: ToolContext, tiktok: TikTokPostSettings, agreed: boolean | undefined, field: string) {
  if (ctx.confirm || agreed === true) return;
  throw new DapiError(
    "invalid-input",
    `Posting to the TikTok profile needs the user's yes to TikTok's terms. Show them this, word for word: "${tiktokConsent(tiktok.brandedContent)}" Then pass ${field} true once they accept.`,
  );
}

function channelsOf(platforms: readonly string[], choices: AccountChoices | undefined): ConfirmRequest["channels"] {
  const chosen = readChoices(choices);
  return platforms.flatMap((platform) => {
    const ids = (isPlatform(platform) ? chosen[platform] : undefined) ?? [];
    if (!ids.length) return [{ platform, handle: "" }];
    return ids.map((id) => ({ platform, handle: socialConnections().find((account) => account.id === id)?.handle ?? "" }));
  });
}

// A no stops the call before anything changes.
async function askPerson(ctx: ToolContext, request: ConfirmRequest & { scheduled?: boolean; at?: Date | null; tiktokYes?: boolean }) {
  const { scheduled, at, tiktokYes, ...shown } = request;
  if (!ctx.confirm || !needsConfirm({ tool: request.tool, scheduled, at, tiktokYes, every: ctx.confirmEvery })) return;
  if (!(await ctx.confirm(shown))) throw new DapiError("canceled", NOT_CONFIRMED);
}

// `elsewhere` counts files this browser doesn't have.
function detailsOf(post: {
  platforms: readonly string[];
  link?: string | null;
  files: readonly File[];
  elsewhere?: number;
  recurrence?: string | null;
  end?: string | null;
  youtube?: YouTubePostSettings;
  tiktok?: TikTokPostSettings;
  captions?: Partial<Record<string, string>>;
  thread?: readonly ThreadReply[];
}): ConfirmDetails {
  const youtube = post.platforms.includes("youtube") ? post.youtube : undefined;
  const tiktok = post.platforms.includes("tiktok") ? post.tiktok : undefined;
  return {
    link: post.link ?? "",
    files: post.files.map((file) => file.name),
    filesElsewhere: Math.max(0, post.elsewhere ?? 0),
    repeat: post.recurrence ? { recurrence: post.recurrence, end: post.end ?? null } : null,
    youtube: youtube ? { title: youtube.title, privacy: youtube.privacy, madeForKids: youtube.madeForKids, tags: [...youtube.tags] } : null,
    tiktokPrivacy: tiktok && !tiktok.inbox ? tiktok.privacy : null,
    captions: Object.entries(post.captions ?? {}).flatMap(([platform, text]) => (post.platforms.includes(platform) && text?.trim() ? [{ platform, text }] : [])),
    thread: threadPlatforms(post.platforms as PlatformId[]).length ? (post.thread ?? []).map((reply) => ({ text: reply.text, delay: reply.delay, files: reply.files?.length ?? 0 })) : [],
  };
}

const keptFiles = (post: StoredEvent) => new Set([...(post.files ?? []), ...Object.values(post.ownFiles ?? {}).flatMap((ids) => ids ?? [])]).size;

const filesOf = (shared: Attached | null, own: Partial<Record<string, Attached>>) => [...(shared?.files ?? []), ...Object.values(own).flatMap((item) => item?.files ?? [])];

async function creatorOf(account: SocialConnection & { tiktok: NonNullable<SocialConnection["tiktok"]> }): Promise<TikTokCreator> {
  try {
    return await loadTikTokCreator(account.id);
  } catch (cause) {
    throw new DapiError("unsupported", `TikTok (${account.handle}): ${(cause as Error).message}`, { cause });
  }
}

async function checkCreators(choices: AccountChoices | undefined, tiktok: TikTokPostSettings, media: MediaSummary | null) {
  let settings = tiktok;
  const warnings: string[] = [];
  for (const account of accountsFor("tiktok", choices)) {
    if (!account.tiktok) continue;
    const creator = await creatorOf({ ...account, tiktok: account.tiktok });
    const checked = checkTikTokCreator(settings, creator, media?.kind === "video" ? media.duration : null);
    if (checked.errors.length) throw new DapiError("invalid-input", checked.errors.join(" "));
    settings = checked.choices;
    warnings.push(...checked.warnings);
  }
  return { tiktok: settings, warnings };
}

// Networks with words of their own (`own`) are checked by those instead of the caption.
function assertFits(input: {
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

async function summarize(file: File, strict: boolean): Promise<{ kind: PostKind; media: MediaSummary }> {
  const name = file.name.toLowerCase();
  const video = file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/.test(name);
  const image = file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name);
  if (video) {
    const source = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    try {
      const duration = await source.computeDuration();
      let width = 0;
      let height = 0;
      for (const track of await source.getTracks()) {
        if (track.isVideoTrack()) {
          width = track.displayWidth;
          height = track.displayHeight;
          break;
        }
      }
      return { kind: "video", media: { kind: "video", duration, width, height } };
    } catch (error) {
      if (!strict) return { kind: "video", media: { kind: "video", duration: 0, width: 0, height: 0 } };
      throw new DapiError("invalid-input", `Could not read ${file.name}. Attach an mp4 or mov.`, { cause: error });
    } finally {
      source.dispose();
    }
  }
  if (image) {
    try {
      const bitmap = await createImageBitmap(file);
      const media: MediaSummary = { kind: "images", count: 1, width: bitmap.width, height: bitmap.height, mixedShapes: false };
      bitmap.close();
      return { kind: "image", media };
    } catch (error) {
      if (!strict) return { kind: "image", media: { kind: "images", count: 1, width: 0, height: 0, mixedShapes: false } };
      throw new DapiError("invalid-input", `Could not read ${file.name}. Attach a png, jpg, webp, or gif.`, { cause: error });
    }
  }
  throw new DapiError("wrong-kind", "Attach a video (mp4, mov) or a picture (png, jpg, webp, gif).");
}

type Attached = { files: File[]; kind: PostKind; media: MediaSummary };

// `strict` turns down a file that can't be read instead of guessing.
async function attach(files: readonly File[], strict: boolean): Promise<Attached | null> {
  const read = await Promise.all(files.map((file) => summarize(file, strict)));
  const first = read[0];
  if (!first) return null;
  if (first.kind === "video") {
    if (read.length > 1) throw new DapiError("invalid-input", "A post takes one video, or up to 35 pictures. Attach the video on its own.");
    return { files: [...files], kind: "video", media: first.media };
  }
  if (read.some((item) => item.kind === "video")) throw new DapiError("invalid-input", "A post takes one video, or up to 35 pictures, not both.");
  const { width, height } = first.media;
  const mixedShapes = width > 0 && read.some(({ media }) => !isAspect(media.width, media.height, width / height));
  return { files: [...files], kind: "image", media: { kind: "images", count: files.length, width, height, mixedShapes } };
}

async function loadMedia(ctx: ToolContext, media: string | readonly string[]): Promise<Attached> {
  const paths = typeof media === "string" ? [media] : media;
  const files: File[] = [];
  for (const path of paths) {
    const named = await ctx.media?.(path);
    if (named) {
      files.push(named);
      continue;
    }
    if (isUrlSource(path)) throw new DapiError("invalid-input", "Pass a file on this machine. Remote URLs are not attached to posts.");
    files.push(await getAssetFile(await resolveAsset(ctx, path)));
  }
  const attached = await attach(files, true);
  if (!attached) throw new DapiError("invalid-input", "Pass a video, or one or more pictures.");
  return attached;
}

async function savedMedia(post: StoredEvent) {
  const own: Partial<Record<string, Attached>> = {};
  for (const platform of Object.keys(post.ownFiles ?? {})) {
    const attached = await attach(await postFiles(post, platform), false);
    if (attached) own[platform] = attached;
  }
  return { shared: await attach(await postFiles(post), false), own };
}

const mediaOn = (shared: Attached | null, own: Partial<Record<string, Attached>>) => (platform: PlatformId) => (own[platform] ?? shared)?.media ?? null;

const kindOf = (shared: Attached | null, own: Partial<Record<string, Attached>>): PostKind => {
  const all = [shared, ...Object.values(own)].filter((item): item is Attached => !!item);
  return all.some((item) => item.kind === "video") ? "video" : all.length ? "image" : "text";
};

const fileTitle = (attached: Attached | null) => attached?.files[0]?.name.replace(/\.[^.]+$/, "");

function postView(post: StoredEvent, warnings: string[] = []) {
  const platforms = [];
  for (const id of post.platforms) {
    if (!isPlatform(id)) continue;
    const chosen = readChoices(post.accounts)[id] ?? [];
    const ids = chosen.length > 0 ? chosen : [""];
    for (const accountId of ids) {
      const found = socialConnections().find((account) => account.id === accountId);
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
    timeZone: post.timeZone || timeZone(),
    platforms,
    repeat: post.recurrence,
    link: post.link,
    thread: (post.thread ?? []).map((reply) => ({ text: reply.text, delayMinutes: reply.delay })),
    warnings,
    deliveries,
  };
}

function deliveryErrors(post: StoredEvent): string {
  const lines = Object.entries(post.deliveries ?? {}).flatMap(([id, delivery]) => {
    if (!delivery || delivery.state === "sent") return [];
    const name = isPlatform(id) ? socialPlatform(id).name : id;
    return [`${name}: ${delivery.error ?? "was not published."}`];
  });
  return lines.join(" ") || "The post was not published.";
}

function platformNotes(platform: SocialPlatform): string {
  const pictures = Math.min(platform.maxImages, platform.publishedImages ?? platform.maxImages);
  const parts = [
    PUBLISHES.has(platform.id)
      ? platform.id === "youtube"
        ? "Plan Video can upload a video here while the app is open."
        : platform.id === "tiktok"
          ? `Plan Video can post here while the app is open: a video, or up to ${pictures} pictures as a photo post.`
          : `Plan Video can post here while the app is open: the words, with the post's video or up to ${pictures} of its pictures.`
      : "Kept on the calendar. Plan Video does not send to this platform.",
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

function readBack(id: string): StoredEvent {
  const saved = allPosts().find((post) => post.id === id);
  if (!saved) throw new DapiError("unsupported", "The post was saved but could not be read back.");
  return saved;
}

export const socialAccounts: ToolHandler<"social_accounts"> = async (_args, ctx) => {
  const user = userOf(ctx);
  loadSocialConnections(user.id);
  return {
    timeZone: timeZone(),
    accounts: socialConnections().flatMap((account) => {
      if (!isPlatform(account.platform)) return [];
      const publishes = PUBLISHES.has(account.platform);
      const ready = publishes && hasLogin(account);
      return [{ id: account.id, platform: account.platform, handle: account.handle, publishes, ready }];
    }),
  };
};

export const socialSchema: ToolHandler<"social_schema"> = async ({ platform }) => ({
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
});

export const tiktokCreator: ToolHandler<"tiktok_creator"> = async ({ account: requested }, ctx) => {
  const user = userOf(ctx);
  loadSocialConnections(user.id);
  const choices = accountsForPost(["tiktok"], requested ? [requested] : undefined);
  const account = accountsFor("tiktok", choices)[0];
  if (!account) throw new DapiError("invalid-input", "Connect TikTok in Connections first.");
  if (!account.tiktok) throw new DapiError("invalid-input", `Connect ${account.handle} in Connections again: Plan Video has its name but no TikTok login.`);
  const creator = await creatorOf({ ...account, tiktok: account.tiktok });
  return {
    accountId: account.id,
    nickname: creator.nickname,
    username: creator.username,
    privacy: creator.privacy,
    comments: !creator.commentDisabled,
    duet: !creator.duetDisabled,
    stitch: !creator.stitchDisabled,
    maxVideoSeconds: creator.maxVideoSeconds,
    consent: tiktokConsent(false),
    brandedConsent: tiktokConsent(true),
  };
};

export const schedulePost: ToolHandler<"schedule_post"> = async (args, ctx) => {
  await ready(ctx);
  return savePost(args, args.media ? await loadMedia(ctx, args.media) : null, {}, ctx);
};

async function savePost(
  args: Omit<ToolArgs<"schedule_post">, "media">,
  attached: Attached | null,
  own: Partial<Record<string, Attached>>,
  ctx: ToolContext,
  tool: Extract<ConfirmTool, "schedule_post" | "copy_post"> = "schedule_post",
) {
  const platforms = sortPlatforms(args.platforms);
  const choices = accountsForPost(platforms, args.accounts);
  const day = args.day ?? localDateKey(new Date());
  if (!isDateKey(day)) throw new DapiError("invalid-input", "Day is YYYY-MM-DD.");
  const scheduling = args.draft !== true;
  if (scheduling && (args.day === undefined || args.time === undefined)) {
    throw new DapiError("invalid-input", "Pass a day and a time to schedule, or draft true to save it without a send time.");
  }
  const time = args.time ? clock(args.time) : null;
  const when = atLocal(day, time ?? "00:00");
  if (!when) throw new DapiError("invalid-input", "Pick a date and a time.");
  if (scheduling) {
    const problem = inEnglish(() => scheduleProblem(when));
    if (problem) throw new DapiError("invalid-input", problem);
  }

  const caption = args.caption;
  const title = postTitle(args.youtube?.title || caption, fileTitle(attached) ?? "Untitled post");
  const media = mediaOn(attached, own);
  const youtube = youtubeOf(args.youtube, undefined, platforms, caption, media("youtube"));
  let tiktok = platforms.includes("tiktok") ? tiktokOf(args.tiktok) : undefined;
  requireTikTok(platforms, tiktok, scheduling);
  const warnings = assertFits({ kind: kindOf(attached, own), platforms, caption, title: youtube?.title || title, media });
  const profile = scheduling && toProfile(platforms, tiktok);
  if (scheduling && toProfile(platforms, tiktok)) {
    requireAgreed(ctx, tiktok, args.tiktok?.agreed, "tiktok.agreed");
    const checked = await checkCreators(choices, tiktok, media("tiktok"));
    tiktok = checked.tiktok;
    warnings.push(...checked.warnings);
  }
  const { repeat, repeatEnd } = repeatOf(args.repeat, day);
  const thread = threadOf(args.thread, platforms);
  await askPerson(ctx, {
    tool,
    caption,
    day: scheduling || time ? day : null,
    time,
    channels: channelsOf(platforms, choices),
    soon: scheduling && isSoon(when),
    tiktok: profile && tiktok ? { branded: tiktok.brandedContent } : null,
    details: detailsOf({
      platforms,
      link: args.link,
      files: filesOf(attached, own),
      recurrence: repeat,
      end: repeat ? resolveRepeatEnd(repeatEnd || undefined, repeat, day) : null,
      youtube,
      tiktok,
      thread,
    }),
    scheduled: scheduling,
    at: when,
    tiktokYes: profile,
  });
  const id = newId();
  const error = await savePosts([{
    id,
    title,
    caption,
    platforms,
    accounts: choices,
    link: args.link,
    tiktok,
    youtube,
    thread,
    when,
    untimed: !scheduling && !time,
    repeat,
    repeatEnd,
    status: scheduling ? "scheduled" : "draft",
    files: {
      shared: attached?.files ?? [],
      own: Object.fromEntries(Object.entries(own).flatMap(([platform, item]) => (item && (platforms as string[]).includes(platform) ? [[platform, item.files]] : []))),
    },
  }]);
  if (error) throw new DapiError("invalid-input", error);
  return postView(readBack(id), warnings);
}

// Saved through schedule_post so the copy is checked like any new post.
export const copyPost: ToolHandler<"copy_post"> = async (args, ctx) => {
  await ready(ctx);
  const original = allPosts().find((post) => post.id === args.id);
  if (!original) throw new DapiError("not-found", "This post no longer exists.");

  const platforms = sortPlatforms(args.platforms ?? original.platforms.filter(isPlatform));
  if (platforms.length === 0) throw new DapiError("invalid-input", "The original has no platform. Pass platforms for the copy.");
  const kept = Object.entries(readChoices(original.accounts)).flatMap(([platform, ids]) =>
    (platforms as string[]).includes(platform) ? connectedIds(platform as PlatformId, ids ?? []) : [],
  );
  const files = await loadPostFiles(original).catch((cause) => {
    throw new DapiError("unsupported", (cause as Error).message, { cause });
  });
  const own: Partial<Record<string, Attached>> = {};
  for (const [platform, list] of Object.entries(files.own)) {
    const attached = await attach(list ?? [], false);
    if (attached) own[platform] = attached;
  }
  const youtube = original.youtube;
  // The original's TikTok answers stand under any the caller changed; its yes to TikTok's terms was for that post.
  const tiktok = original.tiktok;
  const promotion: TikTokPromotion | undefined = tiktok
    ? tiktok.yourBrand && tiktok.brandedContent
      ? "both"
      : tiktok.yourBrand
        ? "your_brand"
        : tiktok.brandedContent
          ? "branded_content"
          : "none"
    : undefined;

  return savePost(
    {
      caption: args.caption ?? original.description ?? "",
      platforms,
      accounts: args.accounts ?? (kept.length > 0 ? kept : undefined),
      day: args.day,
      time: args.time,
      draft: args.draft,
      link: original.link || undefined,
      thread: args.thread ?? (original.thread ?? []).map((reply) => ({ text: reply.text, delayMinutes: reply.delay })),
      youtube: youtube ? { title: youtube.title, privacy: youtube.privacy, madeForKids: youtube.madeForKids, tags: youtube.tags } : undefined,
      tiktok:
        tiktok || args.tiktok
          ? {
              ...(tiktok ? { privacy: tiktok.privacy, comments: tiktok.comments, duet: tiktok.duet, stitch: tiktok.stitch, promotion, inbox: tiktok.inbox } : {}),
              ...definedOnly(args.tiktok),
            }
          : undefined,
    },
    await attach(files.shared, false),
    own,
    ctx,
    "copy_post",
  );
};

export const listPosts: ToolHandler<"list_posts"> = async (args, ctx) => {
  await ready(ctx);
  if (args.id) {
    const post = allPosts().find((item) => item.id === args.id);
    if (!post) throw new DapiError("not-found", "This post no longer exists.");
    return { timeZone: timeZone(), total: 1, posts: [postView(post)] };
  }
  if (args.from && !isDateKey(args.from)) throw new DapiError("invalid-input", "from is YYYY-MM-DD.");
  if (args.to && !isDateKey(args.to)) throw new DapiError("invalid-input", "to is YYYY-MM-DD.");
  const matched = allPosts().filter((post) => {
    if (args.status && post.status !== args.status) return false;
    if (args.platform && !post.platforms.includes(args.platform)) return false;
    if (args.from && post.day < args.from) return false;
    if (args.to && post.day > args.to) return false;
    return true;
  });
  const sorted = [...matched].sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start));
  const limit = args.limit ?? 50;
  return { timeZone: timeZone(), total: sorted.length, posts: sorted.slice(0, limit).map((post) => postView(post)) };
};

export const updatePost: ToolHandler<"update_post"> = async (args, ctx) => {
  await ready(ctx);
  const existing = allPosts().find((post) => post.id === args.id);
  if (!existing) throw new DapiError("not-found", "This post no longer exists.");
  if (existing.status === "posted") throw new DapiError("invalid-input", "Posted posts stay as they went out. Post again to make a copy you can change.");

  const platforms = args.platforms ? sortPlatforms(args.platforms) : sortPlatforms(existing.platforms.filter(isPlatform));
  if (platforms.length === 0) throw new DapiError("invalid-input", "Pick at least one platform.");
  const choices = mergeAccounts(platforms, args.accounts, existing.accounts);
  const saved = args.media ? { shared: await loadMedia(ctx, args.media), own: {} } : await savedMedia(existing);
  const caption = args.caption ?? existing.description ?? "";
  // A new caption replaces words a network had of its own.
  const own = caption.trim() === (existing.description ?? "").trim() ? ownCaptions(existing) : {};
  const day = args.day ?? existing.day;
  if (!isDateKey(day)) throw new DapiError("invalid-input", "Day is YYYY-MM-DD.");
  const time = args.time ? clock(args.time) : existing.allDay ? null : existing.start;

  let status = existing.status;
  if (args.draft === true) status = "draft";
  else if (args.draft === false) status = "scheduled";
  else if (args.day !== undefined && args.time !== undefined && existing.status === "draft") status = "scheduled";
  if (status === "scheduled") {
    if (!time) throw new DapiError("invalid-input", "A scheduled post needs a time. Pass one, or draft true.");
    const problem = inEnglish(() => scheduleProblem(atLocal(day, time)));
    if (problem) throw new DapiError("invalid-input", problem);
  }

  // A YouTube title written for the post stays when the caption changes; one made from the caption (its first line, or
  // "Untitled post" for none, as create_post makes it) follows the new caption.
  const madeTitles = new Set([postTitle(existing.description ?? "", ""), postTitle(existing.description ?? "", "Untitled post")]);
  const oldYouTubeTitle = existing.youtube?.title?.trim() ?? "";
  const ownTitle = platforms.includes("youtube") && oldYouTubeTitle && !madeTitles.has(oldYouTubeTitle) ? oldYouTubeTitle : "";
  const title = args.youtube?.title?.trim() || (args.caption !== undefined ? ownTitle || postTitle(caption, fileTitle(saved.shared) ?? existing.title) : existing.title);
  const media = mediaOn(saved.shared, saved.own);
  const youtube = youtubeOf(args.youtube, existing.youtube, platforms, caption, media("youtube"), args.caption !== undefined ? title : existing.youtube?.title);
  let tiktok = platforms.includes("tiktok") ? tiktokOf(args.tiktok, existing.tiktok) : undefined;
  requireTikTok(platforms, tiktok, status === "scheduled");
  const warnings = [...assertFits({ kind: kindOf(saved.shared, saved.own), platforms, caption, own, title: youtube?.title || title, media }), ...removedAccounts(platforms, choices)];
  let tiktokYes = false;
  if (status === "scheduled" && toProfile(platforms, tiktok)) {
    // A post already set to go to the profile was agreed to; one newly headed there, or with new answers, needs a yes again.
    const agreedBefore = existing.status === "scheduled" && toProfile(existing.platforms, existing.tiktok);
    const changed = args.tiktok?.privacy !== undefined || args.tiktok?.promotion !== undefined || args.tiktok?.inbox !== undefined || args.accounts !== undefined;
    tiktokYes = !agreedBefore || changed;
    if (tiktokYes) requireAgreed(ctx, tiktok, args.tiktok?.agreed, "tiktok.agreed");
    const checked = await checkCreators(choices, tiktok, media("tiktok"));
    tiktok = checked.tiktok;
    warnings.push(...checked.warnings);
  }
  const at = time ? atLocal(day, time) : null;
  const built = args.repeat ? repeatOf(args.repeat, day) : null;
  const recurrence = args.repeat === null ? null : built ? built.repeat : existing.recurrence;
  const end = args.repeat === null ? null : built ? resolveRepeatEnd(built.repeatEnd || undefined, built.repeat, day) : (existing.recurrenceEnd ?? null);
  const thread = threadOf(args.thread, platforms);
  await askPerson(ctx, {
    tool: "update_post",
    caption,
    day,
    time,
    channels: channelsOf(platforms, choices),
    soon: status === "scheduled" && isSoon(at),
    tiktok: tiktokYes && tiktok ? { branded: tiktok.brandedContent } : null,
    details: detailsOf({
      platforms,
      link: args.link !== undefined ? args.link : existing.link,
      files: filesOf(saved.shared, saved.own),
      elsewhere: args.media ? 0 : keptFiles(existing) - filesOf(saved.shared, saved.own).length,
      recurrence,
      end,
      youtube,
      tiktok,
      captions: own,
      thread: thread ?? existing.thread,
    }),
    scheduled: status === "scheduled",
    at,
    tiktokYes,
  });

  const patch: PostPatch = {
    title,
    description: caption,
    captions: own,
    platforms,
    day,
    status,
    ...(time ? { start: time, allDay: false } : { allDay: true }),
    accounts: choices,
    ...(args.link !== undefined ? { link: args.link } : {}),
    ...(thread !== undefined ? { thread } : {}),
  };
  if (!platforms.includes("tiktok")) patch.tiktok = null;
  else if (tiktok) patch.tiktok = tiktok;
  if (!platforms.includes("youtube")) patch.youtube = null;
  else if (youtube) patch.youtube = youtube;
  if (args.repeat === null) {
    patch.repeat = null;
    patch.repeatEnd = null;
  } else if (built) {
    patch.repeat = built.repeat;
    patch.repeatEnd = built.repeatEnd;
  }

  const error = revisePost(existing.id, patch);
  if (error) throw mapped(error);
  if (args.media && saved.shared) await setPostFiles(existing.id, { shared: saved.shared.files });
  return postView(readBack(existing.id), warnings);
};

export const deletePost: ToolHandler<"delete_post"> = async ({ id }, ctx) => {
  await ready(ctx);
  const existing = allPosts().find((post) => post.id === id);
  if (!existing) throw new DapiError("not-found", "This post no longer exists.");
  if (existing.status === "posted") {
    throw new DapiError("invalid-input", "Posted posts stay as they went out. Post again to make a copy you can change.");
  }
  await askPerson(ctx, {
    tool: "delete_post",
    caption: existing.description ?? "",
    day: existing.day || null,
    time: existing.allDay ? null : existing.start,
    channels: channelsOf(existing.platforms, existing.accounts),
    soon: false,
    tiktok: null,
  });
  const error = deleteEvent({ sourceId: id });
  if (error) throw mapped(error);
  return { id, deleted: true };
};

export const publishPost: ToolHandler<"publish_post"> = async ({ id, agreed }, ctx) => {
  const user = await ready(ctx);
  const post = allPosts().find((item) => item.id === id);
  if (!post) throw new DapiError("not-found", "This post no longer exists.");
  if (post.status === "posted") throw new DapiError("invalid-input", "This post already went out.");
  const foreign = post.platforms.filter((platform) => !PUBLISHES.has(platform));
  if (foreign.length > 0) {
    const names = foreign.map((platform) => (isPlatform(platform) ? socialPlatform(platform).name : platform));
    throw new DapiError(
      "unsupported",
      `Plan Video sends ${inEnglish(() => listNames(PUBLISHING_PLATFORMS as PlatformId[]))} only. ${names.join(", ")} ${names.length === 1 ? "is" : "are"} not sent. Take ${names.length === 1 ? "it" : "them"} off the post, or leave this post on the calendar.`,
    );
  }
  if (post.platforms.length === 0) throw new DapiError("invalid-input", "This post has no platform to send to.");
  for (const platform of post.platforms) {
    if (!isPlatform(platform)) continue;
    const name = socialPlatform(platform).name;
    const chosen = accountsFor(platform, post.accounts);
    if (chosen.length > 1) {
      throw new DapiError("invalid-input", `Publishing sends one ${name} account. This post has ${chosen.length}. Leave one on it.`);
    }
    const loggedIn = chosen.find(hasLogin);
    if (!loggedIn) {
      const unnamed = (readChoices(post.accounts)[platform] ?? []).length === 0;
      const connected = socialConnections().filter((account) => account.platform === platform).length;
      if (unnamed && connected > 1) {
        throw new DapiError("invalid-input", `${name} has more than one account. Update the post with the account id to publish.`);
      }
      if (!unnamed && chosen.length === 0 && connected > 0) {
        throw new DapiError("invalid-input", `The ${name} account this post named was removed. Update the post with a ${name} account id, then publish.`);
      }
      throw new DapiError("invalid-input", `Connect ${name} in Connections. A name alone can't publish.`);
    }
  }
  if (post.platforms.includes("tiktok") && !post.tiktok?.inbox && !post.tiktok?.privacy) {
    throw new DapiError("invalid-input", "TikTok needs who can watch before it can be published. Update the post with tiktok.privacy, or tiktok.inbox true.");
  }
  if (post.platforms.includes("youtube") && !(post.youtube?.title || post.title).trim()) {
    throw new DapiError("invalid-input", "Add a YouTube title, then publish.");
  }
  // YouTube needs a video, TikTok a video or pictures. Bluesky, LinkedIn and X also take pictures, or the words alone.
  for (const platform of post.platforms.filter((item) => NEEDS_FILE.has(item))) {
    const files = await postFiles(post, platform);
    const elsewhere = !!post.files && files.length < postFileIds(post, platform).length;
    if (!files.length && !elsewhere) {
      throw new DapiError("invalid-input", platform === "youtube" ? "Attach a video before publishing." : "Attach a video or pictures before publishing.");
    }
    if (platform === "youtube" && files.length && !files.some((file) => file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name))) {
      throw new DapiError("wrong-kind", "YouTube needs a video. This post has pictures.");
    }
  }
  const warnings: string[] = [];
  let profile: TikTokPostSettings | null = null;
  if (toProfile(post.platforms, post.tiktok)) {
    requireAgreed(ctx, post.tiktok, agreed, "agreed");
    const media = (await attach(await postFiles(post, "tiktok"), false))?.media ?? null;
    const checked = await checkCreators(post.accounts, post.tiktok, media);
    warnings.push(...checked.warnings);
    profile = checked.tiktok;
  }
  // It goes out now, so the person is asked before anything on it changes.
  const here = [...(await postFiles(post)), ...(await Promise.all(Object.keys(post.ownFiles ?? {}).map((platform) => postFiles(post, platform)))).flat()];
  await askPerson(ctx, {
    tool: "publish_post",
    caption: post.description ?? "",
    day: null,
    time: null,
    channels: channelsOf(post.platforms, post.accounts),
    soon: true,
    tiktok: profile ? { branded: profile.brandedContent } : null,
    details: detailsOf({
      platforms: post.platforms,
      link: post.link,
      files: here,
      elsewhere: keptFiles(post) - here.length,
      youtube: post.youtube,
      tiktok: profile ?? post.tiktok,
      captions: ownCaptions(post),
      thread: post.thread,
    }),
  });
  if (profile && warnings.length) {
    const changed = revisePost(id, { tiktok: profile });
    if (changed) throw mapped(changed);
  }

  // A future post moves to now so the calendar shows where it went out, as Post
  // now does in the app. A miss puts that time back. A repeat stays on its days.
  const at = atLocal(post.day, post.allDay ? "00:00" : post.start);
  const shift = !post.recurrence && !hasFailed(post) && !!at && at.getTime() > Date.now();
  if (shift) {
    const now = new Date();
    const moved = revisePost(id, { day: localDateKey(now), start: timeOf(now), allDay: false });
    if (moved) throw mapped(moved);
  }
  const result = await sendPost(id, user.id);
  const saved = readBack(id);
  if (result === "sent") return postView(saved, warnings);
  if (shift && saved.status !== "posted") {
    revisePost(id, { day: post.day, start: post.start, allDay: post.allDay });
  }
  if (result === "busy") throw new DapiError("busy", "This post is already being published.");
  if (result === "needs-media") throw new DapiError("invalid-input", "Attach a video, or pictures for TikTok, before publishing.");
  throw new DapiError("unsupported", deliveryErrors(saved));
};
