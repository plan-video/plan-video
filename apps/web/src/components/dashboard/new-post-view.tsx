/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// One post, written once and sent to several platforms: the media, a caption
// that each platform can change, the settings only some of them have, and
// when it goes out. Every post is kept on the posts calendar. TikTok and
// YouTube publish from here, through the publisher.

import { useNavigate, useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch, batch, type JSX, createEffect, createMemo, createRoot, createSignal, on, onCleanup, onMount } from "solid-js";
import { createStore, produce, reconcile, unwrap, type SetStoreFunction } from "solid-js/store";
import { toast } from "somoto";

import { formatEditedAt } from "./utils";
import { StashMark } from "@/components/brand/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { capCentered } from "@/components/ui/cap-label";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { Slider, SliderLabel, SliderThumb, SliderTrack } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch as Toggle, SwitchControl, SwitchInput, SwitchLabel, SwitchThumb } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectPortal, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RemoveButton } from "@/components/ui/remove-button";
import {
  CharCount,
  DropZone,
  FormSection,
  PlatformLogo,
  PlatformLogos,
  PlatformPicker,
  createDropHandlers,
  fieldControl,
  dropZoneAction,
} from "@/components/publish/controls";
import { AccountGroupPicker } from "@/components/publish/account-group-picker";
import { DateTimePicker } from "@/components/publish/date-time-picker";
import { PostPreview } from "@/components/publish/post-preview";
import { CoverImage, ProjectPicker, findProject, linkProject, type LinkedProject } from "@/components/publish/project-picker";
import { nextQueueTimes } from "@/components/publish/queue";
import { useOpenQueueSettings, useQueueSlots } from "@/components/publish/queue-slots";
import { CaptionTools, captionShortcut } from "@/components/publish/caption-tools";
import {
  atLocal,
  formatDay,
  formatWhen,
  latestSchedule,
  nextSlot,
  postTitle,
  savePosts,
  scheduleProblem as scheduleTimeProblem,
  timeOf,
  timeZoneName,
} from "@/components/publish/save";
import { allPosts, loadPostFiles, ownCaptions as savedCaptions, setPostThumbnail, type PostFiles } from "@/components/calendar/store";
import { shrinkToThumbnail, thumbnailFromFile } from "@/lib/post-thumbnail";
import type { StoredEvent } from "@/components/calendar/types";
import {
  cadencePhrase,
  formatDay as formatCalendarDay,
  isDateKey,
  localDateKey,
  matchesRecurrence,
  newId,
  resolveRepeatEnd,
  shiftDay,
} from "@/components/calendar/utils";
import { takeHandOff, takeHandedFiles } from "@/components/publish/handoff";
import { MediaPicker } from "@/components/publish/media-picker";
import { PUBLISHING_PLATFORMS, sendPost } from "@/components/publish/publisher";
import { RepeatEndField, RepeatField } from "@/components/publish/repeat-field";
import { PlatformSettingsFields, platformsWithSettings, tiktokLimitIssues } from "@/components/publish/platform-settings";
import { WhenOptions } from "@/components/publish/when-fields";
import { useAuth } from "@/context/auth";
import { askForAccount } from "@/lib/guest";
import { droppedFiles, pickFiles } from "@/engine/asset-actions";
import { projectRoute, useReturnHere } from "@/hooks/use-project-route";
import { track } from "@/lib/analytics";
import { cx } from "@/lib/cva";
import { localized, msg, t } from "@/lib/i18n";
import {
  captionLength,
  checkPost,
  defaultPlatformSettings,
  instagramPostSettings,
  pinterestPostSettings,
  tiktokPostSettings,
  xPostSettings,
  youtubePostSettings,
  formatDuration,
  hashtagCount,
  listNames,
  picturesOut,
  platformTitle,
  platformsFor,
  socialPlatform,
  sortPlatforms,
  youtubeFormat,
  PLATFORM_IDS,
  type PlatformId,
  type PostKind,
  type MediaSummary,
  type PlatformSettings,
  type PostIssue,
} from "@/lib/social";
import { accountCount, accountLabel, accountsFor, accountsForPlatforms, connectionsFor, loadSocialConnections, readChoices, sameChoices, type AccountChoices } from "@/lib/social-connections";
import { describeQueue, queueSlots } from "@/lib/queue-slots";
import { META_NAMES, META_NETWORKS } from "@/lib/meta";
import { rememberPinterestBoard } from "@/lib/pinterest-boards";
import {
  MAX_REPLIES,
  MAX_REPLY_PICTURES,
  REPLY_DELAYS,
  REPLY_MEDIA_PLATFORMS,
  hasContent as replyHasContent,
  keptThread,
  replyLimit,
  threadIssues,
  threadPlatforms,
  THREAD_PLATFORMS,
  type ThreadReply,
} from "@/lib/thread";
import { keepInLibrary } from "@/lib/media-library";
import { appendSignature, createVaultItem, insertVaultText, loadVault, takeVaultInsert, vaultSignature } from "@/lib/vault";
import {
  createTemplate,
  loadTemplates,
  markTemplateUsed,
  postTemplates,
  sortTemplates,
  takeTemplate,
  type PostTemplate,
  type TemplateDraft,
} from "@/lib/post-templates";
import {
  MEDIA_LIMITS,
  POSTABLE_FILES,
  POSTABLE_IMAGES,
  POSTABLE_VIDEOS,
  baseName,
  formatBytes,
  imageFileProblem,
  mediaKind,
  mediaProblems,
  readMedia,
  releaseMedia,
  summarizeMedia,
  videoFrames,
  videoStill,
  type PostMedia,
} from "@/lib/social-media";
import { projectKey, type ProjectInfo } from "@/projects";
import { createPostProject } from "@/projects/post";
import { exportProjectVideo } from "@/projects/post-export";

const MAX_IMAGES = MEDIA_LIMITS.maxImages;
const COVER_FRAMES = 8;

type When = "now" | "queue" | "schedule";

type Cover = { time: number; src: string };

/** Media a platform has of its own, instead of the shared files. */
type OwnMedia = { items: PostMedia[]; cover: Cover | null };

/** A follow-up as the composer holds it: its words, its wait, and the pictures or video it carries. */
type ComposerReply = Omit<ThreadReply, "files"> & { media: PostMedia[] };

type Composer = {
  kind: PostKind;
  platforms: PlatformId[];
  accounts: AccountChoices;
  media: PostMedia[];
  /** Platforms that go out with media of their own. */
  ownMedia: Partial<Record<PlatformId, OwnMedia>>;
  caption: string;
  /** Captions a platform has of its own, instead of the shared one. */
  overrides: Partial<Record<PlatformId, string>>;
  settings: PlatformSettings;
  /** The still a video goes out with; null keeps the platform's pick. */
  cover: Cover | null;
  /** The project the video comes from. Its export is the media, when attached. */
  project: LinkedProject | null;
  when: When;
  day: string;
  time: string;
  /** How a scheduled post repeats from its day, as the calendar keeps it. `""` for once. */
  repeat: string;
  /** When the repeats stop: `""` never, `on:YYYY-MM-DD`, or `after:N` posts. */
  repeatEnd: string;
  /** Follow-ups posted under it once it's out, on the networks that take them. */
  thread: ComposerReply[];
  /** Whether the vault signature goes at the end of the caption. */
  signature: boolean;
  /** The saved post this one goes over, when it was opened from the post lists. */
  replaces: string | null;
};

function freshComposer(platforms: PlatformId[] = [], kind: PostKind = "video"): Composer {
  const slot = nextSlot(new Date(Date.now() + 60 * 60 * 1000));
  return {
    kind,
    platforms,
    accounts: accountsForPlatforms(platforms),
    media: [],
    ownMedia: {},
    caption: "",
    overrides: {},
    settings: defaultPlatformSettings(),
    cover: null,
    project: null,
    when: "schedule",
    day: localDateKey(slot),
    time: timeOf(slot),
    repeat: "",
    repeatEnd: "",
    thread: [],
    signature: true,
    replaces: null,
  };
}

/** Kept across views, so leaving the page does not lose a post halfway written. */
const [post, setPost] = createStore<Composer>(freshComposer());
/** The platform the preview shows. Picking a platform tab in the form shows it there too. */
const [previewing, setPreviewing] = createSignal<PlatformId>("tiktok");
/** Which platform the media and caption are being changed for, or all of them. */
const [editing, setEditing] = createSignal<PlatformId | "all">("all");

/** The saved post the composer goes over, when it was opened from the post lists. */
const replacing = () => (post.replaces ? allPosts().find((item) => item.id === post.replaces) : undefined);

/** A repeating post opened over itself. Post now would turn it into a single post. */
const editingSeries = () => !!post.repeat && !!replacing()?.recurrence;

/**
 * A series opened over itself keeps its first day, which may have passed. Its
 * time then counts from its next run, since the runs before it have had their
 * turn. Undefined when the post isn't such a series; null when it has no runs left.
 */
function nextSeriesRun(): Date | null | undefined {
  const saved = replacing();
  if (post.when !== "schedule" || !post.repeat || !saved?.recurrence || post.day !== saved.day) return undefined;
  const first = atLocal(post.day, post.time);
  if (!first || first.getTime() > Date.now()) return undefined;
  const end = resolveRepeatEnd(post.repeatEnd, post.repeat, post.day);
  const skipped = post.repeat === saved.recurrence ? saved.recurrenceExceptions : [];
  const today = localDateKey(new Date());
  for (let offset = 0; offset <= 400; offset++) {
    const day = shiftDay(today, offset);
    if (end && day > end) return null;
    if (skipped.includes(day) || !matchesRecurrence(post.repeat, day, post.day)) continue;
    const at = atLocal(day, post.time);
    if (at && at.getTime() > Date.now()) return at;
  }
  return null;
}

/**
 * What kind of post it is follows from what is in it, shared or a network's
 * own: a video or a project makes a video post, pictures an image post,
 * nothing a text post. A story is the one kind that is asked for, and it lasts
 * while it has its file.
 */
function kindFromMedia(): PostKind {
  const items = allMedia();
  const hasVideo = !!post.project || items.some((item) => item.kind === "video");
  if (post.kind === "story" && (hasVideo || items.length)) return "story";
  if (hasVideo) return "video";
  return items.length ? "image" : "text";
}

/**
 * Where the post can go. With nothing in it yet that is anywhere, since the
 * media it gets decides. Picked platforms stay listed so a misfit can be unpicked.
 */
const availablePlatforms = () =>
  post.kind === "text" ? [...PLATFORM_IDS] : PLATFORM_IDS.filter((id) => platformsFor(post.kind).includes(id) || post.platforms.includes(id));

const captionFor = (id: PlatformId) => post.overrides[id] ?? post.caption;
const signatureText = () => (post.signature && post.kind !== "story" ? vaultSignature()?.body : undefined);
/** The caption as it goes out, signature included. */
const finalCaption = (id: PlatformId) => appendSignature(captionFor(id), signatureText());
/**
 * The words each network goes out with, kept on the post: the publisher sends
 * them, and the post opens with them again. YouTube's are its description.
 */
const ownCaptions = () =>
  Object.fromEntries(post.platforms.filter((id) => id !== "youtube").map((id) => [id, finalCaption(id)]));

const mediaFor = (id: PlatformId) => post.ownMedia[id]?.items ?? post.media;
const coverFor = (id: PlatformId) => (post.ownMedia[id] ? post.ownMedia[id]!.cover : post.cover);
const sharingMedia = () => post.platforms.filter((id) => !post.ownMedia[id]);

/**
 * What the checks see. A project without its export attached counts as a
 * video of unknown length and shape, so it is not told it needs media.
 */
const mediaSummary = (id: PlatformId): MediaSummary | null => {
  const own = post.ownMedia[id];
  if (own) return summarizeMedia(own.items);
  return post.media.length ? summarizeMedia(post.media) : post.project ? { kind: "video", duration: 0, width: 0, height: 0 } : null;
};

const allMedia = () => [...post.media, ...Object.values(post.ownMedia).flatMap((own) => own?.items ?? [])];
/** What the thread's follow-ups carry. Apart from allMedia, since it doesn't decide what kind of post this is. */
const threadMedia = () => post.thread.flatMap((reply) => reply.media);
/** The follow-ups that go out, in order: the ones with words or media. */
const keptReplies = () => post.thread.filter(replyHasContent).slice(0, MAX_REPLIES);

/** Platforms can share a file, so one is only let go once nothing in the post holds it. */
function releaseUnused(items: readonly PostMedia[]) {
  const held = new Set([...allMedia(), ...threadMedia()].map((item) => item.id));
  for (const item of items) if (!held.has(item.id)) releaseMedia(item);
}

const copyOwnMedia = () =>
  Object.fromEntries(
    Object.entries(post.ownMedia).map(([id, own]) => [id, { items: [...own!.items], cover: own!.cover }]),
  ) as Composer["ownMedia"];

async function attachProject(project: ProjectInfo & { cover?: Blob | null }) {
  pendingCover = null;
  const linked = await linkProject(project);
  if (post.kind === "text" || post.kind === "image") setKind("video");
  setPost("project", linked);
}

/** Ends a caption with the credits its music asks for, leaving out the ones it already has. */
function withCredits(caption: string, credits: readonly string[]): string {
  const missing = credits.filter((credit) => !caption.includes(credit));
  if (!missing.length) return caption;
  return [caption.trimEnd(), missing.join("\n")].filter(Boolean).join("\n\n");
}

/** Puts the credits of the project's library tracks in the shared caption and every caption of a network's own. */
function addCredits(credits: readonly string[]) {
  if (!credits.length) return;
  setPost("caption", withCredits(post.caption, credits));
  for (const [id, caption] of Object.entries(post.overrides)) {
    if (caption !== undefined) setPost("overrides", id as PlatformId, withCredits(caption, credits));
  }
}

/**
 * A linked project's video, rendered in the background. It becomes the post's
 * media when it lands, unless a video was put in by hand meanwhile.
 */
type ProjectExport = { key: string; progress: number; error?: string };
const [projectExport, setProjectExport] = createSignal<ProjectExport | null>(null);
/** What the linked project's captions say, from its last render, for the caption to take on. */
const [projectWords, setProjectWords] = createSignal<{ key: string; words: string } | null>(null);
/** The words of the project the post is linked to now, once its render has them. */
const linkedProjectWords = () => {
  const found = projectWords();
  return found && found.key === post.project?.key ? found.words : "";
};
/**
 * The cover time a reopened post kept while its video is rendered again from
 * the project, so the render lands with the same cover.
 */
let pendingCover: { key: string; time: number } | null = null;
let exportRun: { key: string; abort: AbortController; done: Promise<boolean> } | null = null;

/** Whether the run that renders `key` is still the one the post wants. */
const wantsExport = (key: string, abort: AbortController) => !abort.signal.aborted && post.project?.key === key && !post.media.length;

function cancelProjectExport() {
  exportRun?.abort.abort();
  exportRun = null;
  setProjectExport(null);
}

function exportLinkedProject(key: string) {
  cancelProjectExport();
  const abort = new AbortController();
  setProjectExport({ key, progress: 0 });
  const done = (async () => {
    try {
      const project = await findProject(key);
      if (!project) throw new Error(msg("That project is no longer on your list."));
      const { file, credits, words } = await exportProjectVideo(project, {
        signal: abort.signal,
        onProgress: (progress) => !abort.signal.aborted && setProjectExport({ key, progress }),
      });
      if (!wantsExport(key, abort)) return false;
      const read = await readMedia(file);
      if (!wantsExport(key, abort)) {
        releaseMedia(read);
        return false;
      }
      const keptTime = pendingCover?.key === key ? pendingCover.time : null;
      pendingCover = null;
      const cover =
        keptTime !== null && read.kind === "video"
          ? { time: keptTime, src: await videoStill(read, keptTime).catch(() => read.poster) }
          : null;
      if (!wantsExport(key, abort)) {
        releaseMedia(read);
        return false;
      }
      batch(() => {
        setPost("media", [read]);
        setPost("cover", cover);
        addCredits(credits);
      });
      setProjectWords({ key, words });
      track("post_project_exported");
      return true;
    } catch (error) {
      if (abort.signal.aborted) return false;
      console.error("[new-post] project export failed", error);
      setProjectExport({ key, progress: 0, error: (error as Error).message || msg("The export failed.") });
      return false;
    } finally {
      if (exportRun?.abort === abort) exportRun = null;
    }
  })();
  exportRun = { key, abort, done };
}

/** Whether a network the post goes to is left without the linked project's video. */
const projectVideoMissing = () => post.project !== null && post.platforms.some((id) => !mediaFor(id).length);

/** Waits out a running export; true when the post then has the project's video. */
const projectExportDone = () => exportRun?.done ?? Promise.resolve(true);

// A linked project with no video yet starts its export; a video put in by
// hand, another project or none at all stops it. A failed one waits for Retry.
createRoot(() =>
  createEffect(
    on(
      () => [post.project?.key, post.media.length > 0] as const,
      ([key, hasVideo]) => {
        if (!key || hasVideo) {
          if (exportRun || projectExport()) cancelProjectExport();
          return;
        }
        if (projectExport()?.key !== key) exportLinkedProject(key);
      },
    ),
  ),
);

/** Fills the composer with a saved post, its video included when it was kept. The caption already ends with its signature. */
async function loadPost(saved: StoredEvent, replace: boolean) {
  const files = await loadPostFiles(saved);
  // A file that's shared and a network's own too is read once, so the composer holds it once.
  const reading = new Map<File, Promise<PostMedia>>();
  const read = (list: readonly File[]) =>
    Promise.all(list.filter((file) => mediaKind(file)).map((file) => reading.get(file) ?? reading.set(file, readMedia(file)).get(file)!));
  const media = await read(files.shared);
  const owned = await Promise.all(Object.entries(files.own).map(async ([id, list]) => [id as PlatformId, await read(list ?? [])] as const));
  const all = [...media, ...owned.flatMap(([, items]) => items)];
  const ids = saved.platforms.filter((id): id is PlatformId => (PLATFORM_IDS as readonly string[]).includes(id));
  const fileKind = all.some((item) => item.kind === "video") ? "video" : all.length ? "image" : null;
  // A story stays one while it has its file.
  const kind: PostKind =
    saved.story && all.length ? "story" : (fileKind ?? (saved.projectId || ids.some((id) => !platformsFor("text").includes(id)) ? "video" : "text"));
  const platforms = sortPlatforms(ids.filter((id) => platformsFor(kind).includes(id)));
  // The cover kept is TikTok's: on its own video when it has one, else on the shared one.
  const coverOf = async (items: readonly PostMedia[]) =>
    typeof saved.coverTime === "number" && items[0]?.kind === "video"
      ? { time: saved.coverTime, src: await videoStill(items[0], saved.coverTime).catch(() => items[0].poster) }
      : null;
  const ownMedia: Composer["ownMedia"] = {};
  for (const [id, items] of owned) {
    if (platforms.includes(id) && items.length) ownMedia[id] = { items, cover: id === "tiktok" ? await coverOf(items) : null };
  }
  const cover = ownMedia.tiktok ? null : await coverOf(media);
  const thread: ComposerReply[] = [];
  for (const reply of saved.thread ?? []) thread.push({ id: reply.id, text: reply.text, delay: reply.delay, media: await read(files.thread[reply.id] ?? []) });
  // Files of networks the post no longer goes to aren't kept.
  const held = new Set([...media, ...Object.values(ownMedia).flatMap((entry) => entry!.items), ...thread.flatMap((reply) => reply.media)]);
  for (const item of all) if (!held.has(item)) releaseMedia(item);
  const project = saved.projectId ? await findProject(saved.projectId) : null;
  const linked = project ? await linkProject(project) : null;
  // Kept without its video, the post's cover waits for the project's render.
  pendingCover =
    linked && !media.length && !ownMedia.tiktok && typeof saved.coverTime === "number" ? { key: linked.key, time: saved.coverTime } : null;

  for (const item of [...allMedia(), ...threadMedia()]) if (!held.has(item)) releaseMedia(item);
  const fresh = freshComposer(platforms, kind);
  // Opened to save over it, the post keeps its day, time and repeat. A copy goes out once, at a time of its own.
  const timing: Partial<Composer> = replace
    ? {
        when: "schedule",
        day: saved.day,
        time: saved.allDay ? "" : saved.start,
        repeat: saved.recurrence ?? "",
        repeatEnd: saved.recurrence && saved.recurrenceEnd ? `on:${saved.recurrenceEnd}` : "",
      }
    : {};
  // Words a network had of its own come back as its own caption. YouTube's are its description.
  const own = savedCaptions(saved);
  const overrides = Object.fromEntries(platforms.flatMap((id) => (own[id] ? [[id, own[id]]] : [])));
  setPost(
    reconcile({
      ...fresh,
      ...timing,
      accounts: accountsForPlatforms(platforms, readChoices(saved.accounts), { keepRemoved: true }),
      media,
      ownMedia,
      cover,
      caption: saved.description ?? "",
      overrides,
      thread,
      project: linked,
      signature: false,
      replaces: replace ? saved.id : null,
      settings: {
        ...fresh.settings,
        pinterest: { ...fresh.settings.pinterest, ...saved.pinterest, link: saved.link ?? "" },
        ...(saved.instagram
          ? { instagram: { ...fresh.settings.instagram, ...saved.instagram, collaborators: [...(saved.instagram.collaborators ?? [])] } }
          : {}),
        ...(saved.x ? { x: { ...fresh.settings.x, ...saved.x } } : {}),
        ...(saved.tiktok
          ? {
              tiktok: {
                ...fresh.settings.tiktok,
                ...saved.tiktok,
                disclose: saved.tiktok.yourBrand || saved.tiktok.brandedContent,
              },
            }
          : {}),
        ...(saved.youtube
          ? {
              youtube: {
                ...fresh.settings.youtube,
                title: saved.youtube.title,
                privacy: saved.youtube.privacy,
                madeForKids: saved.youtube.madeForKids,
                tags: [...(saved.youtube.tags ?? [])],
              },
            }
          : {}),
      },
    }),
  );
}

/** Puts files from the media library in the post. What is written stays; the media it carried is swapped out. */
async function putFiles(files: File[]) {
  const videos = files.filter((file) => mediaKind(file) === "video");
  const kind: PostKind = post.kind === "story" && files.length === 1 ? "story" : videos.length ? "video" : "image";
  const chosen = kind === "story" ? files : kind === "video" ? videos.slice(0, 1) : files.slice(0, MAX_IMAGES);
  const media = await Promise.all(chosen.map(readMedia));
  const replaced = allMedia();
  const platforms = post.platforms.filter((id) => platformsFor(kind).includes(id));
  batch(() => {
    setPost("kind", kind);
    setPost("platforms", platforms);
    setPost("accounts", reconcile(accountsForPlatforms(platforms, post.accounts, { keepRemoved: true })));
    setPost("media", media);
    setPost("ownMedia", reconcile({}));
    setPost("cover", null);
    setPost("project", null);
  });
  for (const item of replaced) releaseMedia(item);
}

/** What the composer has set up, as a template keeps it: everything but the media and the day. */
function templateDraft(name: string, keepTime: boolean): TemplateDraft {
  const when = post.when === "queue" ? "queue" : post.when === "schedule" && keepTime ? "time" : "none";
  return {
    name,
    platforms: [...post.platforms],
    accounts: readChoices(post.accounts),
    caption: post.caption,
    overrides: { ...post.overrides },
    settings: structuredClone(unwrap(post.settings)),
    signature: post.signature,
    // Like the post's own, the follow-ups' media isn't kept: only the ones with words are.
    thread: keptThread(post.thread.filter((reply) => reply.text.trim())),
    when,
    time: post.time,
    repeat: when === "time" ? post.repeat : "",
  };
}

/**
 * Sets the composer up from a template. The media and project stay. What the
 * template replaces comes back with Undo.
 */
function applyTemplate(template: PostTemplate) {
  const before = {
    platforms: [...post.platforms],
    accounts: readChoices(post.accounts),
    caption: post.caption,
    overrides: { ...post.overrides },
    settings: structuredClone(unwrap(post.settings)),
    signature: post.signature,
    thread: post.thread.map((reply) => ({ ...reply })),
    when: post.when,
    day: post.day,
    time: post.time,
    repeat: post.repeat,
    repeatEnd: post.repeatEnd,
  };
  const available = availablePlatforms();
  const platforms = template.platforms.filter((id) => available.includes(id));
  const left = template.platforms.filter((id) => !available.includes(id));
  // A time that has already gone by today goes out tomorrow.
  const today = localDateKey(new Date());
  const passed = (atLocal(today, template.time)?.getTime() ?? 0) <= Date.now();
  const day = passed ? localDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000)) : today;

  batch(() => {
    setPost("platforms", platforms);
    setPost("accounts", reconcile(accountsForPlatforms(platforms, template.accounts)));
    setPost("caption", template.caption);
    setPost("overrides", reconcile(Object.fromEntries(Object.entries(template.overrides).filter(([id]) => platforms.includes(id as PlatformId)))));
    setPost("settings", reconcile(structuredClone(template.settings)));
    setPost("signature", template.signature);
    // Fresh ids, so two posts made from the template never share a follow-up's.
    setPost("thread", template.thread.map((reply) => ({ id: newId(), text: reply.text, delay: reply.delay, media: [] })));
    if (template.when === "queue") setPost("when", "queue");
    if (template.when === "time") {
      setPost("when", "schedule");
      setPost("day", day);
      setPost("time", template.time);
      setPost("repeat", template.repeat);
      setPost("repeatEnd", "");
    }
  });
  setEditing("all");
  markTemplateUsed(template.id);

  toast(t("Started from {name}", { name: template.name }), {
    description: left.length
      ? t(
          "{count, plural, one {{names} doesn't take {kind, select, image {pictures} video {video posts} story {story posts} other {text posts}}, so it was left out.} other {{names} don't take {kind, select, image {pictures} video {video posts} story {story posts} other {text posts}}, so they were left out.}}",
          { count: left.length, names: listNames(left), kind: post.kind },
        )
      : undefined,
    action: {
      label: t("Undo"),
      onClick: () =>
        batch(() => {
          setPost("platforms", before.platforms);
          setPost("accounts", reconcile(before.accounts));
          setPost("caption", before.caption);
          setPost("overrides", reconcile(before.overrides));
          setPost("settings", reconcile(before.settings));
          setPost("signature", before.signature);
          setPost("thread", before.thread);
          setPost("when", before.when);
          setPost("day", before.day);
          setPost("time", before.time);
          setPost("repeat", before.repeat);
          setPost("repeatEnd", before.repeatEnd);
        }),
    },
  });
}

const DROP_TITLES: Record<PostKind, string> = {
  text: msg("Drop a video or pictures"),
  image: msg("Drop pictures"),
  video: msg("Drop a video"),
  story: msg("Drop a picture or a video"),
};

/** `{count}` is how many pictures a post takes. */
const DROP_HINTS: Record<PostKind, string> = {
  text: msg(
    "{count, plural, one {An MP4 or MOV, up to # JPG or PNG picture, or a project. Leave it empty for a text post.} other {An MP4 or MOV, up to # JPG or PNG pictures, or a project. Leave it empty for a text post.}}",
  ),
  image: msg("{count, plural, one {Up to # JPG or PNG picture, 8 MB each} other {Up to # JPG or PNG pictures, 8 MB each}}"),
  video: msg("An MP4 or MOV up to 5 minutes, or a project of yours"),
  story: msg("One JPG or PNG, or an MP4 or MOV up to a minute"),
};

const KIND_MEDIA: Record<PostKind, string> = {
  text: msg("Text posts carry no media."),
  image: msg("Image posts take pictures."),
  video: msg("Video posts take one video."),
  story: msg("A story takes one picture or one video."),
};

/**
 * Switches what kind of post it is. Platforms and media the new kind can't
 * take are dropped, and the toast can put them back.
 */
function setKind(kind: PostKind) {
  if (kind === post.kind) return;
  const before = {
    kind: post.kind,
    platforms: [...post.platforms],
    accounts: readChoices(post.accounts),
    media: [...post.media],
    ownMedia: copyOwnMedia(),
    project: post.project,
    cover: post.cover,
  };

  const fits = (item: PostMedia) => kind === "story" || item.kind === kind;
  const trim = (items: readonly PostMedia[]) => (kind === "text" ? [] : items.filter(fits).slice(0, kind === "story" ? 1 : undefined));
  const media = trim(post.media);
  const ownMedia = kind === "text" ? {} : copyOwnMedia();
  for (const [id, own] of Object.entries(ownMedia) as [PlatformId, OwnMedia][]) {
    own.items = trim(own.items);
    if (!own.items.length) delete ownMedia[id];
    else if (kind === "story" || !own.items.some((item) => item.kind === "video")) own.cover = null;
  }
  const filesOf = (shared: PostMedia[], own: Composer["ownMedia"]) =>
    new Map([...shared, ...Object.values(own).flatMap((entry) => entry!.items)].map((item) => [item.id, item]));
  const kept = filesOf(media, ownMedia);
  const removed = [...filesOf(before.media, before.ownMedia).values()].filter((item) => !kept.has(item.id));
  const project = kind === "video" || kind === "story" ? post.project : null;
  const available = platformsFor(kind);
  const fitting = post.platforms.filter((id) => available.includes(id));
  const platforms = fitting.length ? fitting : available.filter((id) => connectionsFor(id).length > 0);

  batch(() => {
    setPost("kind", kind);
    setPost("platforms", platforms);
    setPost("accounts", reconcile(accountsForPlatforms(platforms, post.accounts, { keepRemoved: true })));
    setPost("media", media);
    setPost("ownMedia", reconcile(ownMedia));
    setPost("project", project);
    if (kind === "story" || !media.some((item) => item.kind === "video")) setPost("cover", null);
  });

  const dropped = removed.length;
  if (!dropped && project === before.project) return;
  const videos = removed.filter((item) => item.kind === "video").length;
  const what = !dropped
    ? t("Unlinked the project")
    : videos === dropped
      ? t("{count, plural, =1 {Removed the video} other {Removed # videos}}", { count: dropped })
      : videos
        ? t("{count, plural, one {Removed # file} other {Removed # files}}", { count: dropped })
        : t("{count, plural, =1 {Removed a picture} other {Removed # pictures}}", { count: dropped });
  toast(what, {
    description: dropped ? t(KIND_MEDIA[kind]) : t("Only video posts and stories link a project."),
    action: {
      label: t("Undo"),
      onClick: () =>
        batch(() => {
          setPost("kind", before.kind);
          setPost("platforms", before.platforms);
          setPost("accounts", reconcile(before.accounts));
          setPost("media", before.media);
          setPost("ownMedia", reconcile(before.ownMedia));
          setPost("project", before.project);
          setPost("cover", before.cover);
        }),
    },
  });
}

const POST_COLUMN = "mx-auto flex w-full max-w-[820px] flex-col px-10 pt-8 pb-12";

/** How a post that goes out later gets its time. Post now is a button of its own. */

const SUBMIT_LABELS: Record<When, string> = { now: msg("Post now"), queue: msg("Add to queue"), schedule: msg({ message: "Schedule", context: "verb" }) };

export function DashboardNewPostView() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = createSignal<"draft" | "post" | null>(null);
  const handed = takeHandOff();
  if (handed) {
    void loadPost(handed.post, handed.replace).catch((error) =>
      toast.error(t("Could not open the post"), { description: t((error as Error).message) }),
    );
  }
  const handedFiles = takeHandedFiles();
  if (handedFiles) {
    void putFiles(handedFiles).catch((error) => toast.error(t("Could not open those files"), { description: (error as Error).message }));
  }
  const template = handed ? null : takeTemplate();
  if (template) {
    // Its accounts are picked among the connected ones, so those are read first.
    loadSocialConnections(auth.user()?.id);
    applyTemplate(template);
  }
  if (post.when === "now") setPost("when", "schedule");
  createEffect(() => {
    const kind = kindFromMedia();
    if (kind !== post.kind) setPost("kind", kind);
  });
  // A calendar slot opens this composer on that day, at the slot's time or the plus button's time.
  createEffect(() => {
    if (handed) return;
    const day = Array.isArray(params.date) ? params.date[0] : params.date;
    if (!isDateKey(day)) return;
    const rawTime = Array.isArray(params.time) ? params.time[0] : params.time;
    const time = rawTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime) ? rawTime : "09:00";
    batch(() => {
      setPost("when", "schedule");
      setPost("day", day);
      setPost("time", time);
    });
    setParams({ date: undefined, time: undefined }, { replace: true });
  });
  createEffect(() => {
    loadSocialConnections(auth.user()?.id);
    // Keeps a pick whose account was removed, so opening a saved post never moves it to another account.
    const next = accountsForPlatforms(post.platforms, post.accounts, { keepRemoved: true });
    if (!sameChoices(next, post.accounts)) setPost("accounts", reconcile(next));
  });
  const unconnected = () => post.platforms.filter((id) => connectionsFor(id).length === 0);
  const postToHint = () => {
    const platforms = post.platforms.length;
    if (!platforms) return undefined;
    const accounts = accountCount(post.platforms, post.accounts);
    return accounts > platforms
      ? t("{platforms, plural, one {# platform} other {# platforms}}, {accounts, plural, one {# account} other {# accounts}}", { platforms, accounts })
      : t("{count, plural, one {# selected} other {# selected}}", { count: platforms });
  };

  // "Make a post" on a project lands here with the project's key.
  createEffect(
    on(
      () => params.project,
      async (key) => {
        if (typeof key !== "string" || !key) return;
        setParams({ project: undefined }, { replace: true });
        const project = await findProject(key);
        if (project) {
          await attachProject(project);
        } else toast.error(t("That project is no longer on your list"));
      },
    ),
  );

  const scheduledAt = () => (post.when === "schedule" ? atLocal(post.day, post.time) : null);
  useQueueSlots();
  const [minute, setMinute] = createSignal(0);
  const ticker = setInterval(() => setMinute((count) => count + 1), 60_000);
  onCleanup(() => clearInterval(ticker));
  const queuedAt = createMemo(() => {
    minute();
    return nextQueueTimes(1)[0] ?? null;
  });

  const issues = createMemo<PostIssue[]>(() => {
    const media = mediaSummary("tiktok");
    return [
      ...checkPost({
        kind: post.kind,
        platforms: post.platforms,
        caption: finalCaption,
        title: (id) => platformTitle(post.settings, id),
        media: mediaSummary,
        settings: post.settings,
      }),
      ...tiktokLimitIssues(post.kind, post.platforms, media?.kind === "video" ? media.duration : null),
      ...(post.kind === "story" ? [] : threadIssues(keptThread(keptReplies()), post.platforms, (index) => summarizeMedia(keptReplies()[index]?.media ?? []))),
      // A saved post whose accounts here were removed goes out from none of them until another is picked.
      ...post.platforms.flatMap((id): PostIssue[] =>
        connectionsFor(id).length && readChoices(post.accounts)[id]?.length && !accountsFor(id, post.accounts).length
          ? [{ platform: id, level: "error", message: t("Its {platform} account was removed. Pick which account it goes out from.", { platform: socialPlatform(id).name }) }]
          : [],
      ),
    ];
  });
  const errors = () => issues().filter((issue) => issue.level === "error");
  const mediaErrors = createMemo(() => [
    ...(sharingMedia().length ? mediaProblems(post.media) : []),
    ...(post.kind === "story" ? [] : keptReplies().flatMap((reply) => mediaProblems(reply.media))),
    ...post.platforms.flatMap((id) => (post.ownMedia[id] ? mediaProblems(post.ownMedia[id]!.items) : [])),
  ]);
  const scheduleProblem = () => {
    if (post.when === "schedule" && post.repeat && post.repeatEnd.startsWith("on:") && post.repeatEnd.slice(3) < post.day) {
      return msg("Pick an end on or after the first post");
    }
    const next = nextSeriesRun();
    if (next !== undefined) return next ? null : msg("This series has no runs left. Pick a later end, or a new first day.");
    if (post.when === "schedule") return scheduleTimeProblem(scheduledAt());
    if (post.when === "queue" && !queuedAt()) return queueSlots().length ? msg("Every queue slot is taken") : msg("Add a queue slot first");
    return null;
  };

  const hasContent = () =>
    post.media.length > 0 ||
    post.project !== null ||
    post.caption.trim().length > 0 ||
    Object.keys(post.overrides).length > 0 ||
    Object.keys(post.ownMedia).length > 0 ||
    post.thread.some(replyHasContent);

  const toInbox = () => post.kind !== "story" && post.platforms.length > 0 && post.platforms.every((id) => id === "tiktok") && post.settings.tiktok.inbox;
  const livePlatforms = () => post.platforms.filter((id) => PUBLISHING_PLATFORMS.includes(id));
  const ready = () => post.platforms.length > 0 && errors().length === 0 && mediaErrors().length === 0 && !busy();
  const canSubmit = () => ready() && (toInbox() || !scheduleProblem());

  const reset = () => {
    for (const item of [...allMedia(), ...threadMedia()]) releaseMedia(item);
    setPost(reconcile(freshComposer([...post.platforms], post.kind)));
    setEditing("all");
  };

  const openCalendar = (when: Date) => setParams({ dashboard: "calendar", date: localDateKey(when), view: undefined });

  const titleOf = () => {
    const fallback = post.project?.name ?? (post.media[0] ? baseName(post.media[0].file) : t("Untitled post"));
    if (post.kind === "story") return postTitle("", t("Story · {name}", { name: fallback }));
    return postTitle(post.settings.youtube.title || post.caption, fallback);
  };

  const untimedDay = () => (post.when === "schedule" && !scheduledAt() ? atLocal(post.day, "00:00") : null);

  /**
   * The files kept with the post, so it can be sent, or opened and posted
   * again later: the shared files, while a network goes out with them, and
   * those of networks with their own. Networks plan.video only plans for keep
   * theirs too, or the post would open again without them.
   */
  const keptFiles = (): PostFiles => {
    const owners = post.platforms.filter((id) => post.ownMedia[id]);
    return {
      shared: sharingMedia().length ? post.media.map((item) => item.file) : [],
      own: Object.fromEntries(owners.map((id) => [id, post.ownMedia[id]!.items.map((item) => item.file)])),
      thread: post.kind === "story" ? {} : Object.fromEntries(keptReplies().map((reply) => [reply.id, reply.media.map((item) => item.file)])),
    };
  };

  /**
   * Makes the saved post's thumbnail from what it carries: its first file, at
   * its cover for a video, or the linked project's cover. Read now, since the
   * composer is cleared before the picture is made.
   */
  const keepThumbnail = (id: string) => {
    const first = post.platforms[0];
    const item = (first ? mediaFor(first)[0] : undefined) ?? post.media[0];
    const cover = item?.kind === "video" ? ((first ? coverFor(first) : post.cover)?.time ?? null) : null;
    const projectCover = post.project?.cover ?? null;
    const making = item ? thumbnailFromFile(item.file, cover) : projectCover ? shrinkToThumbnail(projectCover) : Promise.resolve(null);
    void making.then((made) => made && setPostThumbnail(id, made));
  };

  const save = async (status: "draft" | "scheduled" | "posted", at?: Date) => {
    const untimed = status === "draft" && !at ? untimedDay() : null;
    const queued = post.when === "queue" ? nextQueueTimes(1)[0] : undefined;
    const when = at ?? scheduledAt() ?? queued ?? untimed ?? nextSlot();
    const id = post.replaces ?? newId();
    const error = await savePosts([
      {
        id,
        title: titleOf(),
        caption: post.kind === "story" ? "" : appendSignature(post.caption, signatureText()),
        platforms: post.platforms,
        accounts: accountsForPlatforms(post.platforms, post.accounts, { keepRemoved: true }),
        link: post.platforms.includes("pinterest") ? post.settings.pinterest.link : undefined,
        projectId: post.project?.key,
        coverTime: post.kind === "story" ? null : (coverFor("tiktok")?.time ?? null),
        tiktok: post.platforms.includes("tiktok") && post.kind !== "story" ? tiktokPostSettings(post.settings) : undefined,
        youtube:
          post.platforms.includes("youtube") && post.kind !== "story"
            ? youtubePostSettings(post.settings, finalCaption("youtube"), { short: youtubeFormat(mediaSummary("youtube")) === "short" })
            : undefined,
        instagram: post.platforms.includes("instagram") && post.kind !== "story" ? instagramPostSettings(post.settings) : undefined,
        x: post.platforms.includes("x") && post.kind !== "story" ? xPostSettings(post.settings) : undefined,
        pinterest: post.platforms.includes("pinterest") && post.kind !== "story" ? pinterestPostSettings(post.settings) : undefined,
        story: post.kind === "story",
        // Saved over a post, an emptied thread takes the place of the one it had.
        thread: post.kind === "story" ? [] : keptThread(keptReplies()),
        captions: post.kind === "story" ? undefined : ownCaptions(),
        // Saved over a post, these take the place of the files it had, none included.
        files: keptFiles(),
        when,
        untimed: !!untimed,
        repeat: post.when === "schedule" ? post.repeat : "",
        repeatEnd: post.when === "schedule" && post.repeat ? post.repeatEnd : "",
        status,
      },
    ]);
    if (error) {
      toast.error(t("Could not save the post"), { description: t(error) });
      return null;
    }
    keepThumbnail(id);
    if (post.platforms.includes("pinterest") && post.kind !== "story") rememberPinterestBoard(post.settings.pinterest.board);
    return { when, id };
  };

  const saveDraft = async () => {
    if (busy()) return;
    setBusy("draft");
    try {
      const untimed = !!untimedDay();
      const saved = await save("draft");
      if (!saved) return;
      const { when } = saved;
      track("post_draft_saved", { platforms: post.platforms.length, kind: post.kind });
      toast.success(t("Saved as a draft"), {
        description: untimed
          ? t("On your calendar for {date}, with no set time.", { date: formatDay(when) })
          : t("On your calendar for {date}.", { date: formatWhen(when) }),
        action: { label: t("Open calendar"), onClick: () => openCalendar(when) },
      });
      reset();
    } finally {
      setBusy(null);
    }
  };

  /**
   * Saves the post with its video and hands it to the publisher, which sends
   * it after the composer is clear. Posts shows how it goes.
   */
  const publishNow = async () => {
    const userId = auth.user()?.id;
    if (!userId) {
      toast.error(t("Sign in before posting."));
      return;
    }
    const live = livePlatforms();
    loadSocialConnections(userId);
    if (live.includes("tiktok") && !accountsFor("tiktok", post.accounts).some((item) => item.tiktok)) {
      toast.error(t("Connect TikTok first"), { description: t("Open Connections and sign in with TikTok.") });
      return;
    }
    if (live.includes("youtube") && !accountsFor("youtube", post.accounts).some((item) => item.youtube)) {
      toast.error(t("Connect YouTube first"), {
        description: t("Open Connections and sign in with the Google account that owns the channel."),
      });
      return;
    }
    if (live.includes("bluesky") && !accountsFor("bluesky", post.accounts).some((item) => item.bluesky)) {
      toast.error(t("Connect Bluesky first"), { description: t("Open Connections and sign in with your handle and an app password.") });
      return;
    }
    if (live.includes("linkedin") && !accountsFor("linkedin", post.accounts).some((item) => item.linkedin)) {
      toast.error(t("Connect LinkedIn first"), { description: t("Open Connections and sign in with LinkedIn.") });
      return;
    }
    if (live.includes("x") && !accountsFor("x", post.accounts).some((item) => item.x)) {
      toast.error(t("Connect X first"), { description: t("Open Connections and sign in with X.") });
      return;
    }
    for (const network of META_NETWORKS) {
      if (live.includes(network) && !accountsFor(network, post.accounts).some((item) => item[network])) {
        toast.error(t("Connect {network} first", { network: META_NAMES[network] }), { description: t("Open Connections and sign in with {network}.", { network: META_NAMES[network] }) });
        return;
      }
    }
    // YouTube needs a video; TikTok and Instagram a video or pictures.
    const lacking = (["tiktok", "youtube", "instagram"] as const).filter(
      (id) => live.includes(id) && !(id === "youtube" ? mediaFor(id).some((item) => item.kind === "video") : mediaFor(id).length),
    );
    if (lacking.length) {
      toast.error(lacking.includes("youtube") ? t("Attach a video") : t("Attach a video or pictures"), {
        description: post.project ? t("The project's video didn't export. Retry it on the post, or attach a video.") : t("Posting from here sends the files on this post."),
      });
      return;
    }

    const caption = live.includes("tiktok") ? finalCaption("tiktok") : undefined;
    const staying = post.platforms.filter((id) => !PUBLISHING_PLATFORMS.includes(id));
    const inbox = live.includes("tiktok") && post.settings.tiktok.inbox;
    const saved = await save(staying.length ? "draft" : "scheduled", new Date());
    if (!saved) return;
    track("post_published", { platforms: post.platforms.length, kind: post.kind });
    reset();
    const names = listNames(live);
    toast(inbox && live.length === 1 ? t("Sending to your TikTok inbox") : t("Publishing to {platforms}", { platforms: names }), {
      description: [
        inbox && live.length === 1 ? t("Open the notification in TikTok to edit it and post it.") : null,
        inbox && live.length > 1 ? t("TikTok sends it to your inbox.") : null,
        staying.length ? t("{count, plural, one {{names} stays a draft.} other {{names} stay a draft.}}", { count: staying.length, names: listNames(staying) }) : null,
        live.includes("tiktok") && !inbox ? t("TikTok can take a few minutes to process it before it shows on your profile.") : null,
        live.includes("youtube") ? t("YouTube may still be processing it after the upload.") : null,
        live.includes("bluesky") && !mediaFor("bluesky").length ? t("Bluesky gets the words alone.") : null,
        live.includes("linkedin") && !mediaFor("linkedin").length ? t("LinkedIn gets the words alone.") : null,
        live.includes("x") && !mediaFor("x").length ? t("X gets the words alone.") : null,
        live.includes("facebook") && !mediaFor("facebook").length ? t("Facebook gets the words alone.") : null,
        live.includes("threads") && !mediaFor("threads").length ? t("Threads gets the words alone.") : null,
      ]
        .filter(Boolean)
        .join(" "),
      action: { label: t("Open Posts"), onClick: () => setParams({ dashboard: "posts" }) },
    });
    void sendPost(saved.id, userId, caption, {
      bluesky: live.includes("bluesky") ? finalCaption("bluesky") : undefined,
      linkedin: live.includes("linkedin") ? finalCaption("linkedin") : undefined,
      x: live.includes("x") ? finalCaption("x") : undefined,
      instagram: live.includes("instagram") ? finalCaption("instagram") : undefined,
      facebook: live.includes("facebook") ? finalCaption("facebook") : undefined,
      threads: live.includes("threads") ? finalCaption("threads") : undefined,
    });
  };

  const submit = async () => {
    if (!canSubmit()) return;
    setBusy("post");
    try {
      // The linked project's video may still be rendering. The post goes once it lands,
      // and is checked again first, now that its length and shape are known.
      if (exportRun && (!(await projectExportDone()) || errors().length || mediaErrors().length)) return;
      // Without the project's video, as when its export failed, networks that take words alone would get only those.
      if (projectVideoMissing()) {
        toast.error(t("Attach a video"), { description: t("The project's video didn't export. Retry it on the post, or attach a video.") });
        return;
      }

      // Nothing goes out from guest mode's demo: the post stays as it is, and the guest is asked to make an account.
      if (auth.isGuest()) {
        askForAccount({ reason: post.when === "now" || toInbox() ? "post" : "schedule" });
        return;
      }

      if (toInbox()) {
        await publishNow();
        return;
      }

      if (post.when !== "now") {
        const queued = post.when === "queue";
        // A series that's running says when it goes out next, not its first day.
        const next = nextSeriesRun();
        const saved = await save("scheduled");
        if (!saved) return;
        const { when } = saved;
        const shown = next ?? when;
        track(queued ? "post_queued" : "post_scheduled", { platforms: post.platforms.length, kind: post.kind });
        const cadence = !queued && post.repeat ? cadencePhrase(post.repeat, localDateKey(when)) : null;
        const end = cadence ? resolveRepeatEnd(post.repeatEnd, post.repeat, localDateKey(when)) : null;
        const repeats = cadence && (end ? t("{cadence} until {date}", { cadence, date: formatCalendarDay(end) }) : cadence);
        toast.success(queued ? t("Queued for {date}", { date: formatWhen(shown) }) : t("Scheduled for {date}", { date: formatWhen(shown) }), {
          description: [repeats ? t("Then {repeats}", { repeats }) : null, post.platforms.map((id) => socialPlatform(id).name).join(", ")]
            .filter(Boolean)
            .join(". "),
          icon: <StashMark />,
          action: { label: t("Open calendar"), onClick: () => openCalendar(shown) },
        });
        reset();
        return;
      }

      if (livePlatforms().length) {
        await publishNow();
        return;
      }

      const saved = await save("draft");
      if (!saved) return;
      const { when } = saved;
      track("post_now_unavailable", { platforms: post.platforms.length });
      toast(t("Publishing isn't switched on yet"), {
        description: t("It's saved as a draft on your calendar, ready for when it is."),
        action: { label: t("Open calendar"), onClick: () => openCalendar(when) },
      });
      reset();
    } finally {
      setBusy(null);
    }
  };

  /** While Post now sends, the time picked for later, so the bar keeps showing it. */
  const [nowFrom, setNowFrom] = createSignal<Exclude<When, "now"> | null>(null);
  const laterWhen = () => nowFrom() ?? (post.when === "now" ? "schedule" : post.when);
  const postNow = async () => {
    if (!ready() || post.when === "now" || editingSeries()) return;
    const before = post.when;
    batch(() => {
      setNowFrom(before);
      setPost("when", "now");
    });
    try {
      await submit();
    } finally {
      setNowFrom(null);
      if ((post.when as When) === "now") setPost("when", before);
    }
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      void submit();
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <div class="@container flex min-h-0 flex-1 overflow-hidden">
      <main class="flex min-w-0 flex-1 flex-col">
        <DashboardPageHeader>
          <Show when={hasContent()}>
            <Button variant="ghost" class="text-muted-foreground" onClick={reset}>
              {t("Start over")}
            </Button>
          </Show>
          <TemplatesMenu canSave={hasContent() || post.platforms.length > 0} />
        </DashboardPageHeader>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <div class={cx(POST_COLUMN, "gap-8")}>
            <FormSection title={t("Post to")} hint={postToHint()}>
              <div class="flex flex-col rounded-xl border border-(--border-input)">
                <PlatformPicker
                  variant="logos"
                  class="p-1.5"
                  value={post.platforms}
                  accounts={post.accounts}
                  available={availablePlatforms()}
                  onChange={(ids, accounts) => batch(() => {
                    setPost("platforms", ids);
                    setPost("accounts", reconcile(accounts));
                  })}
                />
                <AccountGroupPicker
                  class="border-t border-(--border-input) px-3 py-2.5"
                  platforms={post.platforms}
                  accounts={post.accounts}
                  available={availablePlatforms()}
                  onPick={(ids, accounts) => batch(() => {
                    setPost("platforms", ids);
                    setPost("accounts", reconcile(accounts));
                  })}
                />
              </div>
              <Show when={unconnected().length}>
                <p class="text-xs text-muted-foreground">
                  {t("{count, plural, one {{names} has no account yet.} other {{names} have no account yet.}}", { count: unconnected().length, names: listNames(unconnected()) })}{" "}
                  <button
                    type="button"
                    class="rounded-md text-foreground underline-offset-2 hover:underline focus-ring"
                    onClick={() => setParams({ dashboard: "connections" })}
                  >
                    {t("{count, plural, one {Add it in Connections} other {Add them in Connections}}", { count: unconnected().length })}
                  </button>
                </p>
              </Show>
            </FormSection>

            <EditingTabs />
            <MediaSection />
            <Show when={post.kind !== "story"}>
              <CaptionSection />
              <ThreadSection />
            </Show>
            <PlatformSettingsSection issues={issues()} />
          </div>
        </div>

        <footer class="flex shrink-0 flex-col gap-2.5 border-t border-border-strong px-6 py-3">
          <div class="flex items-center gap-2">
            <Show when={!toInbox()}>
              <WhenButton problem={scheduleProblem()} queuedAt={queuedAt()} />
            </Show>
            <span class="flex-1" />
            <Button variant="ghost" class="text-muted-foreground" disabled={!!busy() || (!hasContent() && !post.platforms.length)} onClick={() => void saveDraft()}>
              {t("Save draft")}
            </Button>
            <span
              class="inline-flex items-center gap-2"
              title={
                !toInbox() &&
                post.platforms.includes("tiktok") &&
                post.settings.tiktok.disclose &&
                !post.settings.tiktok.yourBrand &&
                !post.settings.tiktok.brandedContent
                  ? t("You need to indicate if your content promotes yourself, a third party, or both.")
                  : undefined
              }
            >
              <Show when={!toInbox()}>
                <Button
                  variant="secondary"
                  class="gap-1.5 px-3"
                  disabled={!ready() || editingSeries()}
                  title={editingSeries() ? t("A repeating post goes out at its times. Saving it here keeps the series.") : undefined}
                  onClick={() => void postNow()}
                >
                  <Show when={busy() === "post" && nowFrom()}>
                    <Icon name="spinner-loader" class="-ml-1 size-5 animate-spin" />
                  </Show>
                  {t("Post now")}
                </Button>
              </Show>
              <Tooltip>
                <TooltipTrigger as={Button} class="gap-1.5 px-3" disabled={!canSubmit()} onClick={() => void submit()}>
                  <Show when={busy() === "post" && !nowFrom()}>
                    <Icon name="spinner-loader" class="-ml-1 size-5 animate-spin" />
                  </Show>
                  {toInbox() ? t("Send to inbox") : t(SUBMIT_LABELS[laterWhen()])}
                </TooltipTrigger>
                <TooltipContent shortcut="⌘↵">{toInbox() ? t("Send to inbox") : t(SUBMIT_LABELS[laterWhen()])}</TooltipContent>
              </Tooltip>
            </span>
          </div>
        </footer>
      </main>

      <PreviewPanel issues={issues()} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media

/** Where an editor's files go: the shared media, or one platform's own. */
type MediaSlot = {
  platform?: PlatformId;
  items(): PostMedia[];
  setItems(items: PostMedia[]): void;
  cover(): Cover | null;
  setCover(cover: Cover | null): void;
};

const SHARED_MEDIA: MediaSlot = {
  items: () => post.media,
  setItems: (items) => setPost("media", items),
  cover: () => post.cover,
  setCover: (cover) => setPost("cover", cover),
};

function ownMediaSlot(id: PlatformId): MediaSlot {
  return {
    platform: id,
    items: () => post.ownMedia[id]?.items ?? [],
    setItems: (items) => setPost("ownMedia", id, "items", items),
    cover: () => post.ownMedia[id]?.cover ?? null,
    setCover: (cover) => setPost("ownMedia", id, "cover", cover),
  };
}

const maxFor = (slot: MediaSlot) => (post.kind === "story" ? 1 : slot.platform ? picturesOut(slot.platform) : MAX_IMAGES);

/** Starts a platform off with what it was getting from the shared media. */
function giveOwnMedia(id: PlatformId) {
  const items = post.kind === "image" ? post.media.slice(0, picturesOut(id)) : [...post.media];
  setPost("ownMedia", id, { items, cover: post.cover });
}

function dropOwnMedia(id: PlatformId) {
  const items = post.ownMedia[id]?.items ?? [];
  setPost(
    "ownMedia",
    produce((own) => {
      delete own[id];
    }),
  );
  releaseUnused(items);
}

function MediaSection() {
  const active = () => {
    const current = editing();
    return current !== "all" && post.platforms.includes(current) ? current : "all";
  };
  const own = () => {
    const id = active();
    return id !== "all" && post.ownMedia[id] ? id : undefined;
  };
  const shown = () => (own() ? ownMediaSlot(own()!) : SHARED_MEDIA);
  const hint = () => {
    const id = active();
    if (id !== "all" && !own()) return t("Same as all platforms");
    if (shown().items()[0]?.kind === "image") return t("{count} of {max} pictures", { count: shown().items().length, max: maxFor(shown()) });
    return id === "all" ? undefined : t("Only for {platform}", { platform: socialPlatform(id).name });
  };

  const canBeStory = () =>
    active() === "all" && (post.kind === "story" || (!Object.keys(post.ownMedia).length && post.media.length + (post.project ? 1 : 0) === 1));
  const toggleStory = () =>
    setKind(post.kind !== "story" ? "story" : post.project || post.media[0]?.kind === "video" ? "video" : "image");

  return (
    <FormSection
      title={t("Media")}
      hint={hint()}
      action={
        <>
          <Show when={canBeStory()}>
            <Button variant="link" size="small" onClick={toggleStory}>
              {post.kind === "story" ? t("Make it a post") : t("Make it a story")}
            </Button>
          </Show>
          <Show when={own()}>
            {(id) => (
              <Button variant="link" size="small" onClick={() => dropOwnMedia(id())}>
                {t("Use the shared media")}
              </Button>
            )}
          </Show>
        </>
      }
    >
      <Switch>
        <Match when={active() === "all"}>
          <MediaEditor slot={SHARED_MEDIA} />
          <SharedMediaNote />
        </Match>
        <Match when={own()} keyed>
          {(id) => <MediaEditor slot={ownMediaSlot(id)} />}
        </Match>
        <Match when={active() !== "all" && (active() as PlatformId)} keyed>
          {(id) => <SharedMediaNotice platform={id} />}
        </Match>
      </Switch>
    </FormSection>
  );
}

/** Under the shared media: who goes out with something else, and who skips pictures. */
function SharedMediaNote() {
  const owners = () => post.platforms.filter((id) => post.ownMedia[id]);
  const skipping = () =>
    post.media[0]?.kind === "image" ? sharingMedia().filter((id) => picturesOut(id) < post.media.length) : [];

  return (
    <Show when={owners().length || skipping().length}>
      <div class="flex flex-col gap-0.5 text-xs leading-4 text-muted-foreground">
        <Show when={owners().length}>
          <span>
            {t("{count, plural, one {{names} goes out with its own media.} other {{names} go out with their own media.}}", { count: owners().length, names: listNames(owners()) })}
          </span>
        </Show>
        <For each={skipGroups(skipping())}>
          {(group) => (
            <span>
              {t("{count, plural, one {{names} takes the first {out} and skips the rest.} other {{names} take the first {out} and skip the rest.}}", {
                count: group.ids.length,
                names: listNames(group.ids),
                out: group.out,
              })}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

function skipGroups(ids: readonly PlatformId[]): { out: number; ids: PlatformId[] }[] {
  const groups = new Map<number, PlatformId[]>();
  for (const id of ids) groups.set(picturesOut(id), [...(groups.get(picturesOut(id)) ?? []), id]);
  return [...groups].sort(([a], [b]) => a - b).map(([out, list]) => ({ out, ids: list }));
}

/** A platform on the shared media: what it gets from it, and the way to give it its own. */
function SharedMediaNotice(props: { platform: PlatformId }) {
  const name = () => socialPlatform(props.platform).name;
  const out = () => (post.media[0]?.kind === "image" ? Math.min(post.media.length, picturesOut(props.platform)) : post.media.length);
  const skipped = () => post.media.length - out();
  const detail = () => {
    if (!post.media.length) {
      return post.project
        ? t("The linked project's video goes out here too.")
        : t("Add media under All platforms, or give {platform} files of its own.", { platform: name() });
    }
    if (skipped()) {
      return t("It takes the first {out} of the {total} pictures and skips the other {skipped, plural, =1 {one} other {#}}.", {
        out: out(),
        total: post.media.length,
        skipped: skipped(),
      });
    }
    return t("Everything under All platforms goes to {platform} as well.", { platform: name() });
  };

  return (
    <div class="flex flex-col gap-3 rounded-xl border border-border-strong bg-accent/30 p-3">
      <Show when={post.media.length}>
        <div class="flex flex-wrap gap-1.5">
          <For each={post.media}>
            {(item, index) => (
              <div
                class="relative h-16 overflow-hidden rounded-md bg-black"
                style={{ "aspect-ratio": `${item.width || 9} / ${item.height || 16}` }}
                classList={{ "opacity-35 grayscale": index() >= out() }}
                title={index() >= out() ? t("Skipped on {platform}", { platform: name() }) : undefined}
              >
                <img src={item.poster} alt="" class="size-full object-cover" draggable={false} />
                <Show when={index() >= out()}>
                  <span class="absolute inset-x-0 bottom-0 bg-black/70 py-px text-center text-xs font-medium text-white">{t("Skipped")}</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
      <div class="flex items-center gap-3">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="text-xs text-foreground">{t("{platform} posts the shared media", { platform: name() })}</span>
          <span class="text-xs leading-4 text-muted-foreground">{detail()}</span>
        </div>
        <Button variant="secondary" class="shrink-0" onClick={() => giveOwnMedia(props.platform)}>
          {t("Use different media")}
        </Button>
      </div>
    </div>
  );
}

function MediaEditor(props: { slot: MediaSlot }) {
  const slot = props.slot;
  const items = () => slot.items();
  const navigate = useNavigate();
  const returnHere = useReturnHere();
  const [, setParams] = useSearchParams();
  const [dragging, setDragging] = createSignal(false);
  const [reading, setReading] = createSignal(false);
  const [opening, setOpening] = createSignal(false);

  /** Files of the wrong kind for this post: offer to switch to the kind that takes them. */
  const offerKind = (kind: PostKind, files: File[]) =>
    toast(t(KIND_MEDIA[post.kind]), {
      action: {
        label: kind === "video" ? t("Make it a video post") : t("Make it an image post"),
        onClick: () => {
          setKind(kind);
          void addFiles(files);
        },
      },
    });

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    let videos = files.filter((file) => mediaKind(file) === "video");
    let images = files.filter((file) => mediaKind(file) === "image");
    if (!videos.length && !images.length) {
      toast(t("Only videos and pictures can be posted"));
      return;
    }
    if (post.kind === "image") {
      if (!images.length) {
        offerKind("video", videos);
        return;
      }
      videos = [];
    } else if (post.kind === "video") {
      if (!videos.length) {
        offerKind("image", images);
        return;
      }
      images = [];
    } else if (post.kind === "story") {
      if (files.length > 1) toast(t(KIND_MEDIA.story));
      const first = files.find((file) => mediaKind(file));
      videos = videos.filter((file) => file === first);
      images = images.filter((file) => file === first);
    }
    if (videos.length > 1) {
      toast(t("A post takes one video"), {
        description: t("Bulk tools posts many at once."),
        action: { label: t("Open Bulk tools"), onClick: () => setParams({ dashboard: "bulk-tools" }) },
      });
    }

    setReading(true);
    try {
      if (videos.length) {
        const read = await readMedia(videos[0]!);
        const replaced = items();
        batch(() => {
          slot.setItems([read]);
          slot.setCover(null);
        });
        releaseUnused(replaced);
        void keepInLibrary([read]);
        return;
      }

      const turnedAway = images.map(imageFileProblem).filter((problem) => problem !== null);
      if (turnedAway.length) {
        toast.error(t("{count, plural, =1 {Can't post that picture} other {Can't post # of those pictures}}", { count: turnedAway.length }), {
          description: turnedAway.length === 1 ? t(turnedAway[0]!) : t("Pictures need to be JPG or PNG, up to 8 MB each."),
        });
      }
      const postable = images.filter((file) => !imageFileProblem(file));
      if (!postable.length) return;
      const before = items();
      const keep = before[0]?.kind === "image" && post.kind !== "story" ? before : [];
      const room = maxFor(slot) - keep.length;
      if (postable.length > room && post.kind !== "story") {
        toast(
          slot.platform
            ? t("{count, plural, one {{platform} takes up to # picture} other {{platform} takes up to # pictures}}", {
                count: maxFor(slot),
                platform: socialPlatform(slot.platform).name,
              })
            : t("{count, plural, one {A post takes up to # picture} other {A post takes up to # pictures}}", { count: MAX_IMAGES }),
        );
      }
      const read: PostMedia[] = [];
      for (const file of postable.slice(0, Math.max(0, room))) {
        try {
          read.push(await readMedia(file));
        } catch (error) {
          toast.error(t("Could not read a picture"), { description: (error as Error).message });
        }
      }
      batch(() => {
        slot.setItems([...keep, ...read]);
        slot.setCover(null);
      });
      if (keep !== before) releaseUnused(before);
      void keepInLibrary(read);
    } catch (error) {
      toast.error(t("Could not read the video"), { description: (error as Error).message });
    } finally {
      setReading(false);
    }
  };

  const pick = async () =>
    void addFiles(
      await pickFiles({ accept: post.kind === "image" ? POSTABLE_IMAGES : post.kind === "video" ? POSTABLE_VIDEOS : POSTABLE_FILES }),
    );

  const remove = (id: string) => {
    const gone = items().filter((entry) => entry.id === id);
    batch(() => {
      slot.setItems(items().filter((entry) => entry.id !== id));
      if (!items().some((entry) => entry.kind === "video")) slot.setCover(null);
    });
    releaseUnused(gone);
  };

  const pickExport = async () => void addFiles(await pickFiles({ accept: POSTABLE_VIDEOS }));

  const openProject = (key: string) => navigate(projectRoute(key), { state: returnHere() });

  const openInEditor = async () => {
    if (post.project) {
      openProject(post.project.key);
      return;
    }
    const video = post.media[0];
    if (!video || video.kind !== "video" || opening()) return;
    setOpening(true);
    try {
      const project = await createPostProject([video.file], { layoutId: "fullscreen", captions: null });
      if (!project) return;
      await attachProject(project);
      track("post_opened_in_editor");
      openProject(projectKey(project));
    } catch (error) {
      toast.error(t("Could not open it in the editor"), { description: (error as Error).message });
    } finally {
      setOpening(false);
    }
  };

  const handlers = createDropHandlers((files) => void addFiles(files), setDragging, droppedFiles);
  const libraryKinds = () => (post.kind === "image" ? (["image"] as const) : post.kind === "video" ? (["video"] as const) : (["video", "image"] as const));
  const video = () => (items()[0]?.kind === "video" ? items()[0] : undefined);
  const youtube = () => (slot.platform ? slot.platform === "youtube" : sharingMedia().includes("youtube"));

  return (
    <>
      <Switch>
        <Match when={!items().length && (slot.platform || !post.project)}>
          <DropZone
            class="py-8"
            title={reading() ? t("Reading…") : t(DROP_TITLES[post.kind])}
            hint={slot.platform ? ownDropHint(slot.platform) : t(DROP_HINTS[post.kind], { count: MEDIA_LIMITS.maxImages })}
            pickLabel={post.kind === "image" ? t("Choose pictures") : post.kind === "video" ? t("Choose a video") : t("Choose a file")}
            dragging={dragging()}
            onPick={() => void pick()}
            handlers={handlers}
            actions={
              <>
                <MediaPicker class={dropZoneAction} kinds={libraryKinds()} max={post.kind === "image" ? maxFor(slot) : 1} onPick={(files) => void addFiles(files)}>
                  <Icon name="all-media-types" class="-ml-1.5 size-5" />
                  {t("From library")}
                </MediaPicker>
                <Show when={post.kind !== "image" && !slot.platform}>
                  <ProjectPicker class={dropZoneAction} onPick={(project) => void attachProject(project)}>
                    <Icon name="navigation.folder" class="-ml-1.5 size-5" />
                    {t("Use a project")}
                  </ProjectPicker>
                </Show>
              </>
            }
          />
        </Match>
        <Match when={!items().length && !slot.platform && post.project}>
          {(project) => (
            <div
              class="flex flex-col gap-3 rounded-xl border p-3 transition-colors"
              classList={{ "border-primary bg-primary/5": dragging(), "border-border-strong bg-accent/30": !dragging() }}
              {...handlers}
            >
              <div class="flex gap-4">
                <CoverImage src={project().cover} class="h-24 w-36 rounded-xl" />
                <div class="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
                  <span class="flex items-center gap-1 text-xs text-muted-foreground">
                    <Icon name="link" class="-ml-1 size-4" />
                    {t("Linked project")}
                  </span>
                  <span class="truncate text-xs text-foreground">{project().name}</span>
                  <span class="text-xs text-muted-foreground">{formatEditedAt(project().modifiedAt)}</span>
                  <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
                    <Button variant="secondary" class="gap-1 pl-1" onClick={() => openProject(project().key)}>
                      <Icon name="edit-video" class="size-5" />
                      {t("Open project")}
                    </Button>
                    <ProjectPicker class={cx(buttonVariants({ variant: "secondary" }))} onPick={(next) => void attachProject(next)}>
                      {t("Change")}
                    </ProjectPicker>
                    <span class="flex-1" />
                    <Button variant="ghost" size="icon-square" aria-label={t("Unlink project")} onClick={() => setPost("project", null)}>
                      <Icon name="close-remove" class="size-5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </div>
              <ProjectExportStatus
                projectKey={project().key}
                reading={reading()}
                onPick={() => void pickExport()}
              />
            </div>
          )}
        </Match>
        <Match when={video()}>
          {(item) => (
            <div
              class="flex flex-col gap-4 rounded-xl border p-3 transition-colors"
              classList={{ "border-primary bg-primary/5": dragging(), "border-border-strong bg-accent/30": !dragging() }}
              {...handlers}
            >
              <div class="flex gap-4">
                <div
                  class="relative w-24 shrink-0 overflow-hidden rounded-xl bg-black"
                  style={{ "aspect-ratio": `${item().width || 9} / ${item().height || 16}` }}
                >
                  <img src={slot.cover()?.src ?? item().poster} alt="" class="size-full object-cover" draggable={false} />
                  <span class="absolute bottom-1 right-1 rounded-md bg-black/75 px-1 text-xs font-medium text-white tabular-nums">
                    {formatDuration(item().duration)}
                  </span>
                </div>
                <div class="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
                  <span class="truncate text-xs text-foreground">{item().file.name}</span>
                  <span class="text-xs text-muted-foreground">
                    {item().width}×{item().height} · {formatBytes(item().file.size)}
                  </span>
                  <span class="text-xs text-muted-foreground">
                    {item().height > item().width ? t("Vertical") : item().height === item().width ? t("Square") : t("Horizontal")}
                    {youtube()
                      ? ` · ${youtubeFormat(summarizeMedia(items())) === "short" ? t("YouTube files it as a Short") : t("YouTube files it as a video")}`
                      : ""}
                  </span>
                  <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
                    <Button variant="secondary" onClick={() => void pick()}>
                      {t("Replace")}
                    </Button>
                    <MediaPicker class={cx(buttonVariants({ variant: "secondary" }))} kinds={libraryKinds()} max={1} onPick={(files) => void addFiles(files)}>
                      {t("From library")}
                    </MediaPicker>
                    <Show when={!slot.platform}>
                      <Button variant="secondary" class="gap-1 pl-1" disabled={opening()} onClick={() => void openInEditor()}>
                        <Show when={opening()} fallback={<Icon name="edit-video" class="size-5" />}>
                          <Icon name="spinner-loader" class="size-5 animate-spin" />
                        </Show>
                        {post.project ? t("Open project") : t("Edit in plan.video")}
                      </Button>
                    </Show>
                    <Show when={!post.project && !slot.platform}>
                      <ProjectPicker
                        class={cx(buttonVariants({ variant: "ghost" }), "gap-1 pl-1 text-muted-foreground")}
                        onPick={(project) => void attachProject(project)}
                      >
                        <Icon name="link" class="size-5" />
                        {t("Link a project")}
                      </ProjectPicker>
                    </Show>
                    <span class="flex-1" />
                    <Button variant="ghost" size="icon-square" aria-label={t("Remove video")} onClick={() => remove(item().id)}>
                      <Icon name="trash" class="size-5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </div>
              <MediaProblems slot={slot} />
              <Show when={post.kind !== "story" && takesCover(slot.platform)}>
                <CoverPicker slot={slot} media={item()} />
              </Show>
              <Show when={!slot.platform}>
                <LinkedProjectRow />
              </Show>
            </div>
          )}
        </Match>
        <Match when={items()[0]?.kind === "image"}>
          <ImageGrid slot={slot} dragging={dragging()} handlers={handlers} onAdd={() => void pick()} onRemove={remove} />
          <MediaProblems slot={slot} />
          <Show when={!slot.platform}>
            <LinkedProjectRow framed />
          </Show>
        </Match>
      </Switch>
    </>
  );
}

function ownDropHint(id: PlatformId): string {
  const name = socialPlatform(id).name;
  if (post.kind === "image") {
    const out = picturesOut(id);
    return t("{count, plural, one {Only {platform} gets these. Up to # JPG or PNG picture.} other {Only {platform} gets these. Up to # JPG or PNG pictures.}}", {
      count: out,
      platform: name,
    });
  }
  if (post.kind === "video") {
    return t("Only {platform} gets this. An MP4 or MOV up to {duration}.", { platform: name, duration: formatDuration(socialPlatform(id).maxVideoSeconds) });
  }
  return t("Only {platform} gets this. One JPG or PNG, or an MP4 or MOV up to a minute.", { platform: name });
}

/** How the linked project's video is coming along, while the post has none yet. */
function ProjectExportStatus(props: { projectKey: string; reading: boolean; onPick(): void }) {
  const state = () => {
    const run = projectExport();
    return run?.key === props.projectKey ? run : null;
  };
  const failed = () => (state()?.error ? state() : null);

  return (
    <div class="flex items-center gap-3 rounded-xl border border-dashed border-(--border-input) px-3 py-2.5">
      <Show
        when={failed()}
        fallback={<Icon name="spinner-loader" class="size-6 shrink-0 animate-spin text-muted-foreground" />}
      >
        <Icon name="alert-warning" class="size-6 shrink-0 text-destructive" />
      </Show>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <Show
          when={failed()}
          fallback={
            <>
              <span class="flex items-baseline gap-2 text-xs text-foreground">
                {props.reading ? t("Reading…") : t("Exporting the video")}
                <span class="ml-auto text-xs text-muted-foreground tabular-nums">{state()?.progress ?? 0}%</span>
              </span>
              <span class="h-1 overflow-hidden rounded-full bg-(--plane-fill-subtle)" role="progressbar" aria-valuenow={state()?.progress ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={t("Export progress")}>
                <span class="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${state()?.progress ?? 0}%` }} />
              </span>
              <span class="text-xs leading-4 text-muted-foreground">{t("It's added to the post when it's done. Posting or scheduling waits for it.")}</span>
            </>
          }
        >
          {(run) => (
            <>
              <span class="text-xs text-foreground">{t("Couldn't export the video")}</span>
              <span class="line-clamp-2 text-xs leading-4 text-muted-foreground">{t(run().error ?? "")}</span>
            </>
          )}
        </Show>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <Show when={failed()}>
          <button type="button" class={dropZoneAction} onClick={() => exportLinkedProject(props.projectKey)}>
            <span class="cap-centered">{t("Retry")}</span>
          </button>
        </Show>
        <button
          type="button"
          class={dropZoneAction}
          title={t("Use a video file instead of the project's export")}
          onClick={props.onPick}
        >
          <span class="cap-centered">{failed() ? t("Choose video") : t("Use a file")}</span>
        </button>
      </div>
    </div>
  );
}

/** What keeps the media from going out anywhere. */
function MediaProblems(props: { slot: MediaSlot }) {
  const problems = createMemo(() => mediaProblems(props.slot.items()));
  const video = () => props.slot.items()[0]?.kind === "video";

  return (
    <Show when={problems().length}>
      <div class="flex items-start gap-2 rounded-xl bg-destructive/10 px-2.5 py-2 text-xs">
        <Icon name="alert-warning" class="-my-0.5 size-5 shrink-0 text-destructive" />
        <div class="flex min-w-0 flex-col gap-0.5">
          <For each={problems()}>{(problem) => <span class="text-foreground">{t(problem)}</span>}</For>
          <Show when={video()}>
            <span class="text-xs leading-4 text-muted-foreground">{t("Edit it in plan.video to trim or reframe it, then export again.")}</span>
          </Show>
        </div>
      </div>
    </Show>
  );
}

/** The project the media comes from, under the media it was exported as. */
function LinkedProjectRow(props: { framed?: boolean }) {
  return (
    <Show when={post.project}>
      {(project) => (
        <div
          class="flex items-center gap-2.5"
          classList={{
            "border-t border-border-strong pt-3": !props.framed,
            "rounded-xl border border-border-strong bg-accent/30 p-2": props.framed,
          }}
        >
          <CoverImage src={project().cover} class="h-8 w-12 rounded-md" />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate text-xs text-foreground">{project().name}</span>
            <span class="truncate text-xs text-muted-foreground">{t("Linked project · {edited}", { edited: formatEditedAt(project().modifiedAt) })}</span>
          </div>
          <ProjectPicker
            class={cx(buttonVariants({ variant: "ghost" }), "text-muted-foreground")}
            placement="bottom-end"
            onPick={(next) => void attachProject(next)}
          >
            {t("Change")}
          </ProjectPicker>
          <Button variant="ghost" size="icon-square" aria-label={t("Unlink project")} onClick={() => setPost("project", null)}>
            <Icon name="close-remove" class="size-5 text-muted-foreground" />
          </Button>
        </div>
      )}
    </Show>
  );
}

/**
 * A cover only shows where it can go out: on a network's own media if that
 * network takes one, on the shared media if any network sharing it does (or
 * none is picked yet).
 */
const takesCover = (platform: PlatformId | undefined) =>
  platform
    ? !!socialPlatform(platform).customCover
    : !sharingMedia().length || sharingMedia().some((id) => socialPlatform(id).customCover);

/** "0:14.1": a cover can sit between whole seconds. */
const coverClock = (time: number) => `${formatDuration(Math.floor(time))}.${Math.floor((time % 1) * 10)}`;

/** Stills from across the video; the one picked is the cover it goes out with. */
function CoverPicker(props: { slot: MediaSlot; media: PostMedia }) {
  const cover = () => props.slot.cover();
  const [frames, setFrames] = createSignal<{ time: number; src: string }[]>([]);
  const [failed, setFailed] = createSignal(false);

  createEffect(
    on(
      () => props.media.id,
      () => {
        let current = true;
        setFrames([]);
        setFailed(false);
        void videoFrames(props.media, COVER_FRAMES)
          .then((next) => current && setFrames(next))
          .catch(() => current && setFailed(true));
        onCleanup(() => {
          current = false;
        });
      },
    ),
  );

  const ownCover = () =>
    props.slot.platform ? [] : sharingMedia().filter((id) => !socialPlatform(id).customCover && socialPlatform(id).maxVideoSeconds > 0);

  // Dragging asks for far more stills than the video can seek to, so one is
  // read at a time and only the latest time asked for waits its turn.
  let reading = false;
  let wanted: number | null = null;
  const sharpen = async (time: number) => {
    wanted = time;
    if (reading) return;
    reading = true;
    try {
      while (wanted !== null) {
        const next = wanted;
        wanted = null;
        try {
          const src = await videoStill(props.media, next);
          if (cover()?.time === next) props.slot.setCover({ time: next, src });
        } catch {
          // The last still stays.
        }
      }
    } finally {
      reading = false;
    }
  };

  const choose = (frame: Cover) => {
    if (cover()?.time === frame.time) {
      props.slot.setCover(null);
      return;
    }
    props.slot.setCover({ time: frame.time, src: frame.src });
    void sharpen(frame.time);
  };

  const scrub = (time: number) => {
    const nearest = frames().reduce<Cover | undefined>(
      (best, frame) => (!best || Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best),
      undefined,
    );
    props.slot.setCover({ time, src: cover()?.src ?? nearest?.src ?? props.media.poster });
    void sharpen(time);
  };

  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("Cover")}</span>
        <span class="tabular-nums">{cover() ? t("From {time}", { time: coverClock(cover()!.time) }) : t("The platform picks one")}</span>
      </div>
      <Show
        when={!failed()}
        fallback={<span class="text-xs leading-4 text-muted-foreground">{t("Couldn't read frames from this video.")}</span>}
      >
      <div class="grid gap-1" style={{ "grid-template-columns": `repeat(${COVER_FRAMES}, minmax(0, 1fr))` }}>
        <Show
          when={frames().length}
          fallback={
            <For each={Array.from({ length: COVER_FRAMES })}>
              {() => <span class="aspect-[9/12] animate-pulse rounded-md bg-accent" />}
            </For>
          }
        >
          <For each={frames()}>
            {(frame) => (
              <button
                type="button"
                aria-pressed={cover()?.time === frame.time}
                aria-label={t("Cover from {time}", { time: formatDuration(frame.time) })}
                class="relative aspect-[9/12] overflow-hidden rounded-md bg-black press focus-ring"
                classList={{
                  "ring-2 ring-primary": cover()?.time === frame.time,
                  "opacity-60 hover:opacity-100": cover() !== null && cover()!.time !== frame.time,
                }}
                onClick={() => choose(frame)}
              >
                <img src={frame.src} alt="" class="size-full object-cover" draggable={false} />
              </button>
            )}
          </For>
        </Show>
      </div>
      <Show when={frames().length && props.media.duration > 0}>
        <Slider
          minValue={0}
          maxValue={props.media.duration}
          step={1 / 30}
          value={[cover()?.time ?? 0]}
          getValueLabel={({ values }) => coverClock(values[0] ?? 0)}
          onChange={([time]) => time !== undefined && scrub(time)}
          class="py-1.5"
        >
          <SliderLabel class="sr-only">{t("Cover time")}</SliderLabel>
          <SliderTrack>
            <SliderThumb classList={{ "opacity-50": !cover() }} />
          </SliderTrack>
        </Slider>
        <span class="text-xs leading-4 text-muted-foreground">{t("Drag to pick any moment, or tap a frame.")}</span>
      </Show>
      </Show>
      <Show when={ownCover().length}>
        <span class="text-xs leading-4 text-muted-foreground">
          {t("{count, plural, one {{names} picks its own cover.} other {{names} pick their own cover.}}", { count: ownCover().length, names: listNames(ownCover()) })}
        </span>
      </Show>
    </div>
  );
}

function ImageGrid(props: {
  slot: MediaSlot;
  dragging: boolean;
  handlers: ReturnType<typeof createDropHandlers>;
  onAdd(): void;
  onRemove(id: string): void;
}) {
  const [moving, setMoving] = createSignal<number | null>(null);

  const moveTo = (from: number, to: number) => {
    if (from === to) return;
    const list = [...props.slot.items()];
    const [item] = list.splice(from, 1);
    if (item) list.splice(to, 0, item);
    props.slot.setItems(list);
  };

  return (
    <div
      class="grid grid-cols-5 gap-2 rounded-xl border p-2 transition-colors"
      classList={{ "border-primary bg-primary/5": props.dragging, "border-border-strong bg-accent/30": !props.dragging }}
      {...props.handlers}
    >
      <For each={props.slot.items()}>
        {(item, index) => (
          <div
            draggable={true}
            onDragStart={(event) => {
              setMoving(index());
              event.dataTransfer?.setData("text/plain", item.id);
            }}
            onDragOver={(event) => {
              const from = moving();
              if (from === null) return;
              event.preventDefault();
              event.stopPropagation();
              moveTo(from, index());
              setMoving(index());
            }}
            onDrop={(event) => {
              if (moving() === null) return;
              event.preventDefault();
              setMoving(null);
            }}
            onDragEnd={() => setMoving(null)}
            class="group relative aspect-square cursor-grab overflow-hidden rounded-xl bg-black active:cursor-grabbing"
            classList={{ "opacity-40": moving() === index() }}
          >
            <img src={item.url} alt="" class="size-full object-cover" draggable={false} />
            <span class="absolute left-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-black/70 px-1 text-xs font-medium text-white tabular-nums">
              {index() + 1}
            </span>
            <button
              type="button"
              aria-label={t("Remove picture")}
              class="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 press hover:bg-black group-hover:opacity-100 focus-visible:opacity-100 focus-ring"
              onClick={() => props.onRemove(item.id)}
            >
              <Icon name="close-remove-small" class="size-4" />
            </button>
          </div>
        )}
      </For>
      <Show when={props.slot.items().length < maxFor(props.slot)}>
        <button
          type="button"
          aria-label={t("Add pictures")}
          class="grid aspect-square place-items-center rounded-xl border border-dashed border-(--border-input) text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-ring"
          onClick={() => props.onAdd()}
        >
          <Icon name="plus-add" class="size-6" />
        </button>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates

/** Starts the post from a template, or keeps what is set up as one. */
function TemplatesMenu(props: { canSave: boolean }) {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  const [saving, setSaving] = createSignal(false);
  createEffect(() => loadTemplates(auth.ownerId()));
  const shown = () => sortTemplates(postTemplates()).slice(0, 8);

  return (
    <>
      <DropdownMenu placement="bottom-end">
        <DropdownMenuTrigger as={Button} variant="ghost" class="gap-0.5 pr-1 text-muted-foreground">
          {t("Templates")}
          <Icon name="chevron-down" class="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="w-64">
            <Show when={shown().length}>
              <DropdownMenuGroup>
                <DropdownMenuGroupLabel>{t("Start from")}</DropdownMenuGroupLabel>
                <For each={shown()}>
                  {(template) => (
                    <DropdownMenuItem tone="neutral" onSelect={() => applyTemplate(template)}>
                      <span class="min-w-0 flex-1 truncate">{template.name}</span>
                      <PlatformLogos ids={template.platforms} max={3} logoClass="size-3.5" />
                    </DropdownMenuItem>
                  )}
                </For>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </Show>
            <DropdownMenuItem tone="neutral" disabled={!props.canSave} onSelect={() => setSaving(true)}>
              {t("Save as template…")}
            </DropdownMenuItem>
            <DropdownMenuItem tone="neutral" onSelect={() => setParams({ dashboard: "templates", date: undefined, view: undefined })}>
              {postTemplates().length ? t("Manage templates") : t("About templates")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
      <Show when={saving()}>
        <SaveTemplateDialog onClose={() => setSaving(false)} />
      </Show>
    </>
  );
}

function SaveTemplateDialog(props: { onClose(): void }) {
  const [name, setName] = createSignal("");
  const [keepTime, setKeepTime] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  let input: HTMLInputElement | undefined;
  /** "every week on Monday", lowercase only where the sentence needs it. */
  const repeats = () => (post.repeat ? cadencePhrase(post.repeat, post.day) : null);

  const kept = () => {
    const parts: string[] = [];
    if (post.platforms.length) parts.push(listNames(post.platforms));
    if (post.caption.trim()) parts.push(t("the caption"));
    const own = Object.keys(post.overrides).length;
    if (own) parts.push(t("{count, plural, one {# caption of its own} other {# captions of their own}}", { count: own }));
    if (platformsWithSettings(post.kind, post.platforms).length) parts.push(t("platform settings"));
    if (post.when === "queue") parts.push(t("the queue"));
    return parts;
  };

  const save = () => {
    const made = createTemplate(templateDraft(name(), keepTime()));
    if ("error" in made) return setError(made.error);
    track("post_template_saved", { platforms: post.platforms.length });
    toast.success(t("Saved as a template"), { description: post.media.length || post.project ? t("The media is left out, so the next post brings its own.") : undefined });
    props.onClose();
  };

  return (
    <Dialog open preventScroll={false} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogContent
          showCloseButton={false}
          class="flex w-[440px] max-w-11/12 flex-col gap-0 overflow-hidden rounded-xl border-border p-0"
          onKeyDown={(event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.isComposing) {
              event.preventDefault();
              save();
            }
          }}
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            input?.focus();
          }}
        >
          <div class="flex h-11 items-center gap-2 border-b border-border pl-4 pr-1.5">
            <p class="min-w-0 flex-1 truncate text-xs text-foreground">{t("Save as template")}</p>
            <Button size="icon-square" variant="ghost" aria-label={t("Close")} onClick={() => props.onClose()}>
              <Icon name="close-remove" class="text-foreground" />
            </Button>
          </div>
          <div class="flex flex-col gap-4 px-4 py-4">
            <label class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t("Name")}</span>
              <input
                ref={input}
                class={fieldControl}
                placeholder={t("Weekly clip")}
                value={name()}
                onInput={(event) => {
                  setName(event.currentTarget.value);
                  setError(null);
                }}
              />
            </label>
            <Show when={post.when === "schedule"}>
              <Toggle checked={keepTime()} onChange={setKeepTime} class="flex items-center gap-4">
                <SwitchLabel class="min-w-0 flex-1 cursor-pointer text-xs font-normal">
                  <span class="block text-foreground">{t("Keep the time")}</span>
                  <span class="mt-0.5 block text-xs text-muted-foreground">
                    {repeats()
                      ? t("Posts from it go out at {time}, {repeats}.", { time: post.time, repeats: repeats() })
                      : t("Posts from it go out at {time}.", { time: post.time })}
                  </span>
                </SwitchLabel>
                <SwitchInput aria-label={t("Keep the time")} />
                <SwitchControl variant="compact">
                  <SwitchThumb variant="compact" />
                </SwitchControl>
              </Toggle>
            </Show>
            <p class="text-xs leading-4 text-muted-foreground">
              {kept().length
                ? t("Keeps {items}. The media and the day stay with this post.", { items: listItems(kept()) })
                : t("The media and the day stay with this post.")}
            </p>
            <Show when={error()}>
              <p class="text-xs text-destructive">{t(error() ?? "")}</p>
            </Show>
          </div>
          <div class="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <Button variant="secondary" onClick={() => props.onClose()}>
              {t("Cancel")}
            </Button>
            <Button class="px-3" disabled={!name().trim()} onClick={save}>
              {t("Save template")}
            </Button>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

const ITEM_LIST = localized((locale) => new Intl.ListFormat(locale, { type: "conjunction" }), "en-GB");

/** "a", "a and b", "a, b and c". */
function listItems(parts: readonly string[]): string {
  return ITEM_LIST().format(parts);
}

// ---------------------------------------------------------------------------
// Caption

function CaptionSection() {
  const auth = useAuth();

  createEffect(() => loadVault(auth.ownerId()));

  onMount(() => {
    const waiting = takeVaultInsert();
    if (waiting) setPost("caption", insertVaultText(post.caption, waiting));
  });
  const active = () => {
    const current = editing();
    return current !== "all" && post.platforms.includes(current) ? current : "all";
  };

  const value = () => {
    const id = active();
    return id === "all" ? post.caption : captionFor(id);
  };

  const write = (text: string) => {
    const id = active();
    if (id === "all") setPost("caption", text);
    else setPost("overrides", id, text);
  };

  /** Starts the caption with what the video's captions say, ahead of anything already in it, such as music credits. */
  const takeVideoWords = () => write([linkedProjectWords(), value().trim()].filter(Boolean).join("\n\n"));

  const resetOverride = (id: PlatformId) =>
    setPost(
      "overrides",
      produce((overrides) => {
        delete overrides[id];
      }),
    );

  /** The tightest limit among the platforms that use the shared caption. */
  const limit = () => {
    const id = active();
    if (id !== "all") return { limit: socialPlatform(id).captionLimit, name: socialPlatform(id).name };
    const sharing = post.platforms.filter((platform) => post.overrides[platform] === undefined);
    const tightest = sharing.map(socialPlatform).sort((a, b) => a.captionLimit - b.captionLimit)[0];
    return tightest ? { limit: tightest.captionLimit, name: tightest.name } : null;
  };

  const signed = () => appendSignature(value(), signatureText());
  const tags = () => hashtagCount(signed());

  const saveToVault = () => {
    const made = createVaultItem({ kind: "caption", title: "", body: value() });
    if ("error" in made) toast.error(t("Could not save to the vault"), { description: t(made.error) });
    else toast.success(t("Saved to the vault"));
  };

  let field: HTMLTextAreaElement | undefined;

  return (
    <FormSection
      title={t("Caption")}
      hint={active() === "all" ? undefined : t("Only for {platform}", { platform: socialPlatform(active() as PlatformId).name })}
      action={
        <>
          <Show when={active() !== "all" && post.overrides[active() as PlatformId] !== undefined}>
            <Button variant="link" size="small" onClick={() => resetOverride(active() as PlatformId)}>
              {t("Use the shared caption")}
            </Button>
          </Show>
          <Show when={linkedProjectWords() && !value().includes(linkedProjectWords())}>
            <Button variant="link" size="small" onClick={takeVideoWords}>
              {t("Use the video's words")}
            </Button>
          </Show>
          <Show when={value().trim()}>
            <Button variant="link" size="small" onClick={saveToVault}>
              {t("Save to vault")}
            </Button>
          </Show>
        </>
      }
    >
      <div class="flex flex-col overflow-hidden rounded-xl border border-(--border-input) bg-input transition-colors focus-within:border-primary">
        <textarea
          ref={field}
          class="min-h-40 w-full resize-y bg-transparent px-3.5 pt-3 pb-2.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={active() === "all" ? t("Write a caption. Add #hashtags and @mentions.") : t("Write a caption just for this platform.")}
          value={value()}
          onInput={(event) => write(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            captionShortcut(event);
          }}
        />
        <Show when={vaultSignature()}>
          {(signature) => (
            <div class="flex items-start gap-3 border-t border-border-strong px-3 py-2">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="text-xs text-muted-foreground">
                  {post.signature ? t("Ends with your signature") : t("Signature left off this post")} · {signature().title}
                </span>
                <p
                  class="line-clamp-3 whitespace-pre-line break-words text-xs leading-relaxed transition-opacity"
                  classList={{ "text-foreground/70": post.signature, "text-muted-foreground/50 line-through": !post.signature }}
                >
                  {signature().body}
                </p>
              </div>
              <Button variant="ghost" size="small" class="shrink-0 text-muted-foreground" onClick={() => setPost("signature", !post.signature)}>
                {post.signature ? t("Leave off") : t("Add it back")}
              </Button>
            </div>
          )}
        </Show>
        <div class="flex h-10 items-center gap-3 border-t border-border-strong pr-3 pl-1.5 text-xs">
          <CaptionTools field={() => field} onVaultPick={(item) => write(insertVaultText(value(), item))} />
          <span class="flex-1" />
          <Show when={tags()}>
            <span class="text-muted-foreground">{t("{count, plural, one {# hashtag} other {# hashtags}}", { count: tags() })}</span>
          </Show>
          <Show when={limit()}>
            {(current) => (
              <span class="flex items-center gap-1.5">
                <Show when={active() === "all" && post.platforms.length > 1}>
                  <span class="text-muted-foreground">{current().name}</span>
                </Show>
                <CharCount count={captionLength(signed())} limit={current().limit} />
              </span>
            )}
          </Show>
        </div>
      </div>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------
// Thread

/**
 * Follow-ups the publisher posts under the post once it's out, each a while
 * after the one before. Shown while the post goes to a network that takes
 * them, or already has some.
 */
function ThreadSection() {
  const networks = () => threadPlatforms(post.platforms);
  const others = () => post.platforms.filter((id) => !THREAD_PLATFORMS.includes(id));
  /** The tightest limit among the networks the thread goes out on. */
  const limit = () => {
    const tightest = [...networks()].sort((a, b) => replyLimit(a) - replyLimit(b))[0];
    return tightest ? { limit: replyLimit(tightest), name: socialPlatform(tightest).name } : null;
  };
  const hint = () => {
    const replying = networks().filter((id) => id !== "linkedin");
    const commenting = networks().includes("linkedin");
    if (replying.length && commenting) return t("Replies under the post on {names}, comments on LinkedIn", { names: listNames(replying) });
    if (replying.length) return t("Replies under the post on {names}", { names: listNames(replying) });
    if (commenting) return t("Comments on the post on LinkedIn");
    return t("Only X, LinkedIn and Bluesky post threads");
  };
  let focusNext = false;
  const add = () => {
    focusNext = true;
    setPost("thread", (list) => [...list, { id: newId(), text: "", delay: 0, media: [] }]);
  };
  const remove = (index: number) => {
    const gone = post.thread[index]?.media ?? [];
    setPost("thread", (list) => list.filter((_, at) => at !== index));
    releaseUnused(gone);
  };

  return (
    <Show when={networks().length || post.thread.length}>
      <FormSection
        title={t("Thread")}
        hint={hint()}
        action={
          <Show when={post.thread.length && post.thread.length < MAX_REPLIES}>
            <Button variant="link" size="small" onClick={add}>
              {t("Add another")}
            </Button>
          </Show>
        }
      >
        <For each={post.thread}>
          {(reply, index) => (
            <div class="flex flex-col overflow-hidden rounded-xl border border-(--border-input) bg-input transition-colors focus-within:border-primary">
              <textarea
                ref={(field) => {
                  if (!focusNext) return;
                  focusNext = false;
                  queueMicrotask(() => field.focus());
                }}
                class="min-h-24 w-full resize-y bg-transparent px-3.5 pt-3 pb-2.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
                aria-label={t("Follow-up {number}", { number: index() + 1 })}
                placeholder={index() === 0 ? t("Write what goes under the post, like a link or the next part.") : t("Write the next part.")}
                value={reply.text}
                onInput={(event) => setPost("thread", index(), "text", event.currentTarget.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  captionShortcut(event);
                }}
              />
              <ReplyMedia index={index()} />
              <div class="flex h-10 items-center gap-1 border-t border-border-strong pr-2 pl-1.5 text-xs">
                <ReplyMediaButton index={index()} />
                <DelaySelect value={reply.delay} first={index() === 0} onChange={(minutes) => setPost("thread", index(), "delay", minutes)} />
                <span class="flex-1" />
                <Show when={limit()}>
                  {(current) => (
                    <span class="flex items-center gap-1.5">
                      <Show when={networks().length > 1}>
                        <span class="text-muted-foreground">{current().name}</span>
                      </Show>
                      <CharCount count={captionLength(reply.text.trim())} limit={current().limit} />
                    </span>
                  )}
                </Show>
                <Button variant="ghost" class="text-muted-foreground" onClick={() => remove(index())}>
                  {t("Remove")}
                </Button>
              </div>
            </div>
          )}
        </For>
        <Show when={!post.thread.length}>
          <button
            type="button"
            class="flex h-10 items-center gap-1.5 rounded-xl border border-dashed border-(--border-input) px-3 text-sm text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring"
            disabled={!networks().length}
            onClick={add}
          >
            <Icon name="plus-add" class="size-5" />
            {t("Add a follow-up")}
          </button>
        </Show>
        <Show when={post.thread.length && others().length}>
          <p class="text-xs text-muted-foreground">
            {t("{count, plural, one {{names} gets the post alone.} other {{names} get the post alone.}}", { count: others().length, names: listNames(others()) })}
          </p>
        </Show>
      </FormSection>
    </Show>
  );
}

/**
 * Puts files in a follow-up: one video, or up to 4 pictures. A video takes
 * the place of what it had, and so do pictures put in after a video.
 */
async function addReplyMedia(index: number, files: readonly File[]) {
  const reply = post.thread[index];
  if (!reply || !files.length) return;
  const video = files.find((file) => mediaKind(file) === "video");
  const pictures = files.filter((file) => mediaKind(file) === "image");
  const unusable = pictures.map(imageFileProblem).find(Boolean);
  if (unusable) toast.error(unusable);
  const usable = pictures.filter((file) => !imageFileProblem(file));
  const keep = video || reply.media.some((item) => item.kind === "video") ? [] : reply.media;
  const room = MAX_REPLY_PICTURES - keep.length;
  if (!video && usable.length > room) toast(t("A follow-up takes up to {count} pictures.", { count: MAX_REPLY_PICTURES }));
  const chosen = video ? [video] : usable.slice(0, Math.max(0, room));
  if (!chosen.length) return;
  let read: PostMedia[];
  try {
    read = await Promise.all(chosen.map(readMedia));
  } catch (error) {
    toast.error(t("Could not open those files"), { description: (error as Error).message });
    return;
  }
  // The follow-up may have gone, or moved, while the files were read.
  const at = post.thread.findIndex((item) => item.id === reply.id);
  if (at === -1) {
    for (const item of read) releaseMedia(item);
    return;
  }
  const replaced = post.thread[at]!.media.filter((item) => !keep.includes(item));
  setPost("thread", at, "media", [...keep, ...read]);
  releaseUnused(replaced);
}

/** What a follow-up carries, in a row of small tiles, each with a way to take it off. */
function ReplyMedia(props: { index: number }) {
  const media = () => post.thread[props.index]?.media ?? [];
  const remove = (id: string) => {
    const gone = media().filter((item) => item.id === id);
    setPost("thread", props.index, "media", (list) => list.filter((item) => item.id !== id));
    releaseUnused(gone);
  };
  return (
    <Show when={media().length}>
      <div class="flex flex-wrap gap-2 px-3.5 pb-3">
        <For each={media()}>
          {(item) => (
            <div class="group/tile relative size-16 overflow-hidden rounded-lg border border-border bg-accent">
              <img src={item.kind === "image" ? item.url : item.poster} alt="" class="size-full object-cover" draggable={false} />
              <Show when={item.kind === "video"}>
                <span class="absolute bottom-1 left-1 rounded-sm bg-black/70 px-1 text-[10px] font-medium text-white tabular-nums">{formatDuration(item.duration)}</span>
              </Show>
              <RemoveButton
                label={t("Remove {name}", { name: baseName(item.file) })}
                class="absolute top-1 right-1 opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100"
                onClick={() => remove(item.id)}
              />
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

/** Opens the file chooser for a follow-up's pictures or video. Shown while the thread goes to a network that posts them. */
function ReplyMediaButton(props: { index: number }) {
  const takes = () => REPLY_MEDIA_PLATFORMS.some((id) => post.platforms.includes(id));
  const full = () => {
    const media = post.thread[props.index]?.media ?? [];
    return media.some((item) => item.kind === "video") || media.length >= MAX_REPLY_PICTURES;
  };
  const pick = async () => addReplyMedia(props.index, await pickFiles({ accept: POSTABLE_FILES }));
  return (
    <Show when={takes()}>
      <Tooltip>
        <TooltipTrigger
          as={Button}
          variant="ghost"
          size="icon-square"
          class="text-muted-foreground"
          aria-label={full() ? t("Replace the media") : t("Add pictures or a video")}
          onClick={() => void pick()}
        >
          <Icon name="all-media-types" class="size-5" />
        </TooltipTrigger>
        <TooltipContent>{full() ? t("Replace the media") : t("Add pictures or a video")}</TooltipContent>
      </Tooltip>
    </Show>
  );
}

type DelayChoice = { id: string; minutes: number; label: string };

/** "5 minutes after the post", "Right after the one before". */
function delayLabel(minutes: number, label: string, first: boolean) {
  if (!minutes) return first ? t("Right after the post") : t("Right after the one before");
  return first ? t("{delay} after the post", { delay: t(label) }) : t("{delay} after the one before", { delay: t(label) });
}

/** How long after the post, or the follow-up before it, one goes out. */
function DelaySelect(props: { value: number; first: boolean; onChange(minutes: number): void }) {
  const options = (): DelayChoice[] => REPLY_DELAYS.map((option) => ({ id: String(option.minutes), minutes: option.minutes, label: option.label }));
  return (
    <Select<DelayChoice>
      options={options()}
      value={options().find((option) => option.minutes === props.value) ?? options()[0]}
      onChange={(option) => option && props.onChange(option.minutes)}
      optionValue="id"
      optionTextValue="label"
      gutter={4}
      itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{t(itemProps.item.rawValue.label)}</SelectItem>}
    >
      <SelectTrigger
        aria-label={props.first ? t("When it goes out after the post") : t("When it goes out after the follow-up before")}
        class="w-auto bg-transparent pl-2 hover:bg-accent"
      >
        <SelectValue<DelayChoice>>
          {(state) => (
            <span class="text-muted-foreground">{delayLabel(state.selectedOption()?.minutes ?? 0, state.selectedOption()?.label ?? "", props.first)}</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectPortal>
        <SelectContent />
      </SelectPortal>
    </Select>
  );
}

/** One row of platform tabs for the media and caption: all platforms, or one on its own. */
function EditingTabs() {
  const active = () => {
    const current = editing();
    return current !== "all" && post.platforms.includes(current) ? current : "all";
  };
  /** The tabs' name, as a screen reader says it. */
  const what = () => (post.kind === "story" ? t("media for") : post.kind === "text" ? t("caption for") : t("media and caption for"));
  const pick = (id: PlatformId | "all") => {
    setEditing(id);
    if (id !== "all") setPreviewing(id);
  };

  return (
    <Show when={post.platforms.length > 1}>
      <div class={cx(TAB_LIST, "-mb-4")} role="tablist" aria-label={what()}>
        <PlatformTab selected={active() === "all"} onClick={() => pick("all")}>
          {t("All platforms")}
        </PlatformTab>
        <For each={post.platforms}>
          {(id) => (
            <PlatformTab selected={active() === id} onClick={() => pick(id)}>
              <PlatformLogo id={id} class="size-4" />
              {socialPlatform(id).name}
              <Show when={post.ownMedia[id] || post.overrides[id] !== undefined}>
                <span class="size-1.5 rounded-full bg-primary" title={t("Changed for this platform")} />
              </Show>
            </PlatformTab>
          )}
        </For>
      </div>
    </Show>
  );
}

/** A row of platform tabs, framed as one switch like `Segmented`. */
const TAB_LIST = "flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-lg bg-accent p-0.5";

function PlatformTab(props: { selected: boolean; onClick(): void; children: JSX.Element }) {
  const label = capCentered(() => props.children);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.selected}
      class="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm press focus-ring"
      classList={{
        "bg-background text-foreground shadow-xs": props.selected,
        "text-muted-foreground hover:text-foreground": !props.selected,
      }}
      onClick={() => props.onClick()}
    >
      {label()}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Per-platform settings

/** One platform's settings at a time, the same one the preview shows. */
function PlatformSettingsSection(props: { issues: PostIssue[] }) {
  const settings = (...args: unknown[]) => (setPost as (...path: unknown[]) => void)("settings", ...args);
  const shown = () => platformsWithSettings(post.kind, post.platforms);
  const current = () => (shown().includes(previewing()) ? previewing() : shown()[0]!);
  const blocked = (id: PlatformId) => props.issues.some((issue) => issue.platform === id && issue.level === "error");
  const [open, setOpen] = createSignal(false);
  // YouTube's title, description and privacy status are shown as soon as YouTube is picked, as its rules ask.
  createEffect(on(() => shown().includes("youtube"), (youtube) => youtube && setOpen(true)));
  return (
    <Show when={shown().length}>
      <section class="flex flex-col gap-3">
        <button
          type="button"
          aria-expanded={open()}
          class="-mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent focus-ring"
          onClick={() => setOpen(!open())}
        >
          <Icon name="chevron-down" class={cx("size-5 shrink-0 text-muted-foreground transition-transform", !open() && "-rotate-90")} />
          <span class="text-sm font-medium text-foreground">{t("Platform settings")}</span>
          <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{listNames(shown())}</span>
          <Show when={!open() && shown().some(blocked)}>
            <span class="text-xs text-destructive">{t("Needs a look")}</span>
          </Show>
        </button>
        <Show when={open()}>
        <Show when={shown().length > 1}>
          <div class={TAB_LIST} role="tablist" aria-label={t("Settings for")}>
            <For each={shown()}>
              {(id) => (
                <PlatformTab selected={current() === id} onClick={() => setPreviewing(id)}>
                  <PlatformLogo id={id} class="size-4" />
                  {socialPlatform(id).name}
                  <Show when={blocked(id)}>
                    <span class="size-1.5 rounded-full bg-destructive" title={t("Needs something before it can post")} />
                  </Show>
                </PlatformTab>
              )}
            </For>
          </div>
        </Show>
        <PlatformSettingsFields
          kind={post.kind}
          platforms={post.platforms}
          only={current()}
          settings={post.settings}
          onChange={settings as SetStoreFunction<PlatformSettings>}
          tiktokAccount={() => accountsFor("tiktok", post.accounts).find((account) => account.tiktok)}
          youtubeChannels={() => accountsFor("youtube", post.accounts)}
          youtubeDescription={{
            value: () => captionFor("youtube"),
            onInput: (text) => setPost("overrides", "youtube", text),
            own: () => post.overrides.youtube !== undefined,
            reset: () =>
              setPost(
                "overrides",
                produce((overrides) => {
                  delete overrides.youtube;
                }),
              ),
          }}
        />
        </Show>
      </section>
    </Show>
  );
}

/** The bottom bar's date and time: shows when a post goes out later, and opens the fields to change it. */
function WhenButton(props: { problem: string | null; queuedAt: Date | null }) {
  const later = () => (post.when === "queue" ? "queue" : "schedule");
  const label = () => {
    if (later() === "queue") return props.queuedAt ? t("Queue · {date}", { date: formatWhen(props.queuedAt) }) : t("Queue");
    const at = atLocal(post.day, post.time);
    return at ? formatWhen(at) : t("Pick a time");
  };
  let content: HTMLDivElement | undefined;
  return (
    <Popover placement="top-start">
      <PopoverTrigger
        as="button"
        type="button"
        aria-label={t("When it goes out: {when}", { when: label() })}
        class="flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-(--border-input) bg-input pl-2 pr-1 text-sm text-foreground press hover:bg-accent focus-ring"
        classList={{ "border-destructive/60": !!props.problem }}
      >
        <Icon name="calendar" class="size-5 shrink-0 text-muted-foreground" />
        <span class="cap-centered truncate">{label()}</span>
        <Show when={later() === "schedule" && post.repeat}>
          <span class="cap-centered shrink-0 text-xs text-muted-foreground">· {t("Repeats")}</span>
        </Show>
        <Icon name="chevron-down" class="size-5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          ref={content}
          tabIndex={-1}
          class="flex max-h-[min(36rem,var(--kb-popper-content-available-height))] w-[22rem] flex-col overflow-y-auto rounded-xl p-0 shadow-none"
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault();
            content?.focus();
          }}
        >
          <WhenFields problem={props.problem} queuedAt={props.queuedAt} />
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Scheduling

/**
 * What the When popup holds: times to take with one press, like a menu, then
 * the post's own date and time and how it repeats. With the queue picked, the
 * queue's slots stand where the date and time were.
 */
function WhenFields(props: { problem: string | null; queuedAt: Date | null }) {
  const openQueueSettings = useOpenQueueSettings();
  const choose = (at: Date) =>
    batch(() => {
      setPost("when", "schedule");
      setPost("day", localDateKey(at));
      setPost("time", timeOf(at));
    });

  const [now, setNow] = createSignal(new Date());
  const clock = setInterval(() => setNow(new Date()), 30_000);
  onCleanup(() => clearInterval(clock));

  const earliestTime = (day: string) => (day === localDateKey(now()) ? timeOf(new Date(now().getTime() + 60_000)) : undefined);
  // A running series shows its next run.
  const at = () => nextSeriesRun() ?? atLocal(post.day, post.time);
  const queued = () => post.when === "queue";

  return (
    <>
      <div class="p-1">
        <WhenOptions
          platforms={post.platforms}
          picked={at()}
          now={now()}
          onChoose={choose}
          queue={{
            at: props.queuedAt,
            hasSlots: queueSlots().length > 0,
            selected: queued(),
            onChoose: () => setPost("when", "queue"),
            onSetUp: openQueueSettings,
          }}
        />
      </div>
      <Show when={!queued() || queueSlots().length || props.problem}>
        <div class="h-px bg-border" />
        <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 p-3">
          <Show
            when={!queued()}
            fallback={
              <Show when={queueSlots().length}>
                <span class="whitespace-nowrap text-xs text-foreground">{t("Posting queue")}</span>
                <span class="flex h-7 min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span class="truncate">
                    {describeQueue()} · {timeZoneName()}
                  </span>
                  <Button variant="link" size="small" class="h-4 shrink-0" onClick={openQueueSettings}>
                    {t("Edit slots")}
                  </Button>
                </span>
              </Show>
            }
          >
            <span class="whitespace-nowrap text-xs text-foreground">{t("Date and time")}</span>
            <DateTimePicker
              label={t("Date and time")}
              day={post.day}
              time={post.time}
              minDay={localDateKey(now())}
              maxDay={localDateKey(latestSchedule())}
              minTime={earliestTime}
              onChange={(day, time) =>
                batch(() => {
                  setPost("day", day);
                  setPost("time", time);
                })
              }
            />
            <span class="self-start pt-1.5 whitespace-nowrap text-xs text-foreground">{t("Repeat")}</span>
            <RepeatField value={post.repeat} day={post.day} onChange={(repeat) => setPost("repeat", repeat)} />
            <Show when={post.repeat}>
              <span class="self-start pt-1.5 whitespace-nowrap text-xs text-foreground">{t("Ends")}</span>
              <RepeatEndField value={post.repeatEnd} repeat={post.repeat} day={post.day} onChange={(end) => setPost("repeatEnd", end)} />
            </Show>
          </Show>
          <Show when={props.problem}>{(problem) => <p class="col-span-2 text-xs text-destructive">{t(problem())}</p>}</Show>
        </div>
      </Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// Preview

// By default the preview keeps to the right: a third of the page, no wider
// than 560px on big screens. Dragging its edge sets a width of its own.
const PREVIEW_PANEL = "relative hidden w-[320px] shrink-0 flex-col border-l border-border-strong bg-sidebar/40 @3xl:flex @5xl:w-[min(36%,560px)]";
/** Narrowest the preview column can be dragged, and the room the form keeps. */
const PREVIEW_MIN = 240;
const FORM_MIN = 440;
/** A dragged width. Absent until the divider moves, so the column stays responsive. */
const [previewWidth, setPreviewWidth] = createSignal<number | null>(null);

function clampPreview(width: number, container: number): number {
  const max = Math.max(PREVIEW_MIN, container - FORM_MIN);
  return Math.round(Math.min(max, Math.max(PREVIEW_MIN, width)));
}

/** The preview column, with a divider that widens it to the left and narrows it to the right. */
function PreviewAside(props: { children: JSX.Element }) {
  let aside!: HTMLElement;
  const [resizing, setResizing] = createSignal(false);
  let restoreDrag: (() => void) | undefined;
  onCleanup(() => restoreDrag?.());

  onMount(() => {
    const parent = aside.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => {
      const current = previewWidth();
      if (current == null) return;
      const next = clampPreview(current, parent.clientWidth);
      if (next !== current) setPreviewWidth(next);
    });
    observer.observe(parent);
    onCleanup(() => observer.disconnect());
  });

  const startResize = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = aside.getBoundingClientRect().width;
    setResizing(true);
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const move = (ev: PointerEvent) => {
      if (!handle.hasPointerCapture(ev.pointerId)) return;
      const container = aside.parentElement?.clientWidth ?? startWidth;
      setPreviewWidth(clampPreview(startWidth + (startX - ev.clientX), container));
    };
    const end = () => {
      restoreDrag = undefined;
      setResizing(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    restoreDrag = end;
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const nudge = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const container = aside.parentElement?.clientWidth ?? aside.clientWidth;
    const step = event.shiftKey ? 48 : 16;
    const delta = event.key === "ArrowLeft" ? step : -step;
    setPreviewWidth(clampPreview(aside.getBoundingClientRect().width + delta, container));
  };

  return (
    <aside
      ref={aside}
      class={PREVIEW_PANEL}
      style={previewWidth() != null ? { width: `${previewWidth()}px` } : undefined}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("Resize preview")}
        aria-valuemin={PREVIEW_MIN}
        aria-valuenow={previewWidth() ?? undefined}
        tabIndex={0}
        class="group absolute inset-y-0 left-0 z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none focus-ring"
        onPointerDown={startResize}
        onKeyDown={nudge}
      >
        <div
          class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-primary"
          classList={{ "bg-primary": resizing() }}
        />
      </div>
      {props.children}
    </aside>
  );
}

/** The phone at its own size, before the stage scales it. */
const PHONE = { width: 286, height: 588 };

/**
 * Scales the phone to the column. Until the divider is dragged it stops at
 * one and a half times, which is the size the preview opened at before.
 */
/** Room kept on the phone's left, which moves it right of the panel's center by half this. */
const PREVIEW_NUDGE = 64;

function PreviewStage(props: { children: JSX.Element }) {
  const [scale, setScale] = createSignal(1);
  let stage!: HTMLDivElement;
  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (stage.clientWidth <= 0 || stage.clientHeight <= 0) return;
      const fit = Math.min((stage.clientWidth - 48 - PREVIEW_NUDGE) / PHONE.width, (stage.clientHeight - 48) / PHONE.height);
      setScale(previewWidth() == null ? Math.min(1.5, Math.max(0.8, fit)) : Math.max(0.45, fit));
    });
    observer.observe(stage);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div ref={stage} class="flex min-h-0 flex-1 flex-col overflow-auto" style={{ "padding-left": `${PREVIEW_NUDGE}px` }}>
      <div class="m-auto w-[272px]" style={{ zoom: String(scale()) }}>
        {props.children}
      </div>
    </div>
  );
}

function PreviewPanel(props: { issues: PostIssue[] }) {
  const platform = () => (post.platforms.includes(previewing()) ? previewing() : (post.platforms[0] ?? platformsFor(post.kind)[0]!));
  const [previewAccountId, setPreviewAccountId] = createSignal<string>();
  const previewAccounts = () => accountsFor(platform(), post.accounts);
  const previewAccount = () => previewAccounts().find((account) => account.id === previewAccountId()) ?? previewAccounts()[0];
  const issuesOf = (id: PlatformId) => props.issues.filter((issue) => issue.platform === id);

  return (
    <PreviewAside>
      <div class="flex h-11 shrink-0 items-center justify-center gap-3 border-b border-border-strong px-3">
        <Show when={post.platforms.length} fallback={<span class="text-sm font-medium text-foreground">{t("Preview")}</span>}>
          <div class="flex min-w-0 items-center gap-0.5" role="tablist" aria-label={t("Preview platform")}>
            <For each={post.platforms}>
              {(id) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={platform() === id}
                  aria-label={socialPlatform(id).name}
                  class="relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs press focus-ring"
                  classList={{
                    "bg-secondary text-foreground": platform() === id,
                    "text-muted-foreground hover:bg-accent hover:text-foreground": platform() !== id,
                  }}
                  onClick={() => setPreviewing(id)}
                >
                  <PlatformLogo id={id} class="size-4.5" />
                  <Show when={platform() === id}>
                    <span class="cap-centered pr-0.5">{socialPlatform(id).name}</span>
                  </Show>
                  <Show when={issuesOf(id).some((issue) => issue.level === "error")}>
                    <span class="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-destructive" />
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={previewAccounts().length > 1}>
          <div class="flex shrink-0 items-center gap-0.5 border-l border-border-strong pl-3" role="tablist" aria-label={t("Preview account")}>
            <For each={previewAccounts()}>
              {(account) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewAccount()?.id === account.id}
                  class="cap-trim h-6 max-w-32 truncate rounded-full px-2 text-xs press focus-ring"
                  classList={{
                    "bg-secondary text-foreground": previewAccount()?.id === account.id,
                    "text-muted-foreground hover:bg-accent hover:text-foreground": previewAccount()?.id !== account.id,
                  }}
                  onClick={() => setPreviewAccountId(account.id)}
                >
                  {accountLabel(account)}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <PreviewStage>
        <PostPreview
          platform={platform()}
          account={previewAccount()?.id}
          media={mediaFor(platform())}
          story={post.kind === "story"}
          caption={post.kind === "story" ? "" : finalCaption(platform())}
          thread={
            post.kind !== "story" && THREAD_PLATFORMS.includes(platform())
              ? keptReplies().map((reply) => ({ text: reply.text, media: REPLY_MEDIA_PLATFORMS.includes(platform()) ? reply.media : [] }))
              : undefined
          }
          title={platformTitle(post.settings, platform())}
          cover={
            coverFor(platform())?.src ??
            (post.ownMedia[platform()] || post.media.length ? undefined : (post.project?.cover ?? undefined))
          }
        />
      </PreviewStage>

      <Show when={issuesOf(platform()).length}>
        <ul class="mx-auto flex max-w-md shrink-0 flex-col gap-1 px-6 pb-6">
          <For each={issuesOf(platform())}>
            {(issue) => (
              <li class="flex items-start gap-2 text-xs text-muted-foreground">
                <span
                  class={cx("mt-1.5 size-1.5 shrink-0 rounded-full", issue.level === "error" ? "bg-destructive/80" : "bg-meter-yellow/80")}
                />
                {t(issue.message)}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </PreviewAside>
  );
}
