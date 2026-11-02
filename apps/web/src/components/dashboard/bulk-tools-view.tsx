/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Index, Match, Show, Switch, batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { toast } from "somoto";

import { Button } from "@/components/ui/button";
import { capCentered } from "@/components/ui/cap-label";
import { Checkbox, CheckboxControl, CheckboxInput } from "@/components/ui/checkbox";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
import { SeePlansButton } from "@/components/dashboard/paid-lock";
import { Popover, PopoverContent, PopoverPortal, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CharCount,
  DropZone,
  Field,
  PlatformLogo,
  PlatformLogos,
  PlatformPicker,
  Segmented,
  SwitchRow,
  createDropHandlers,
  dropZoneAction,
  fieldControl,
  fieldControlBase,
} from "@/components/publish/controls";
import { AccountGroupPicker } from "@/components/publish/account-group-picker";
import { dailyBestTimes } from "@/components/publish/best-times";
import { MOST_A_DAY, assignTimes, fillCaptions, fillDown, fillTitlesDown, moveItem, plannedPosts, readInOrder, restorablePosts, shuffled, spread, spreadsheetColumn, suggestTime } from "@/components/publish/bulk-plan";
import { fileMatchKey, readCaptionRows } from "@/components/publish/csv";
import { DatePicker, DateTimePicker, TimePicker } from "@/components/publish/date-time-picker";
import { MediaPicker } from "@/components/publish/media-picker";
import { PlatformSettingsFields, platformsWithSettings, tiktokLimitIssues } from "@/components/publish/platform-settings";
import { PostPreview } from "@/components/publish/post-preview";
import { sendPost } from "@/components/publish/publisher";
import { RepeatEndField, RepeatField } from "@/components/publish/repeat-field";
import {
  atLocal,
  formatDay,
  formatWhen,
  latestSchedule,
  nextSlot,
  postTitle,
  savePosts,
  scheduleProblem,
  timeOf,
  timeZoneName,
} from "@/components/publish/save";
import { VaultPicker } from "@/components/publish/vault-picker";
import { WhenOptions, untilLabel } from "@/components/publish/when-fields";
import { hydrateCalendar, isOnCalendar, setPostThumbnail } from "@/components/calendar/store";
import { BULK_DATABASE, clearBatchFiles, dropBatchFiles, readBatchFiles, writeBatchFile, type BatchFile } from "@/lib/bulk-batch";
import { thumbnailFromFile } from "@/lib/post-thumbnail";
import { cadencePhrase, formatDay as formatCalendarDay, localDateKey, newId, resolveRepeatEnd, shiftDay } from "@/components/calendar/utils";
import { useAuth } from "@/context/auth";
import { askForAccount } from "@/lib/guest";
import { droppedFiles, pickFiles } from "@/engine/asset-actions";
import { track } from "@/lib/analytics";
import { cx } from "@/lib/cva";
import { msg, rich, t } from "@/lib/i18n";
import { paidToolsLocked } from "@/lib/paid-tools";
import { keepInLibrary } from "@/lib/media-library";
import { rememberPinterestBoard } from "@/lib/pinterest-boards";
import {
  PUBLISHING_PLATFORMS,
  captionLength,
  checkPost,
  defaultPlatformSettings,
  instagramPostSettings,
  settingsIssues,
  tiktokPostSettings,
  xPostSettings,
  youtubePostSettings,
  formatDuration,
  hashtagCount,
  listNames,
  youtubeFormat,
  platformsFor,
  socialPlatform,
  sortPlatforms,
  type PlatformId,
  type PlatformSettings,
  type PostKind,
} from "@/lib/social";
import { nextQueueTimes } from "@/components/publish/queue";
import { useOpenQueueSettings, useQueueSlots } from "@/components/publish/queue-slots";
import { describeQueue, queueSlots } from "@/lib/queue-slots";
import { appendSignature, createVaultItem, insertVaultText, loadVault, vaultSignature } from "@/lib/vault";
import {
  accountsFor,
  accountsForPlatforms,
  connectionsFor,
  loadSocialConnections,
  readChoices,
  sameChoices,
  type AccountChoices,
} from "@/lib/social-connections";
import { META_NAMES, META_NETWORKS, type MetaNetwork } from "@/lib/meta";
import { activeWorkspaceId, loadWorkspaces, workspaceDatabase, workspaceKey } from "@/lib/workspaces";
import {
  POSTABLE_FILES,
  baseName,
  fileKey,
  imageFileProblem,
  mediaFromSaved,
  mediaKind,
  mediaProblems,
  readMedia,
  releaseMedia,
  summarizeMedia,
  type PostMedia,
} from "@/lib/social-media";

const MAX_POSTS = 50;
const DEFAULT_PLATFORMS: PlatformId[] = ["tiktok", "instagram", "youtube"];
const STORY_PLATFORMS = platformsFor("story");
const READ_AT_ONCE = 4;

type ScheduleMode = "spread" | "queue" | "best";

type BulkPost = {
  id: string;
  media: PostMedia;
  caption: string;
  /** Written on this post, or picked for it while selected: the shared caption leaves it alone. */
  ownCaption: boolean;
  overrides: Partial<Record<PlatformId, string>>;
  /** For the networks that ask for one. Empty uses the file's name. */
  title: string;
  story: boolean;
  platforms: PlatformId[];
  accounts: AccountChoices;
  day: string;
  time: string;
  /** Timed by hand, or while selected: the plan under When leaves it alone. */
  ownTime: boolean;
  /** The calendar's repeat rule; `""` for once. */
  repeat: string;
  /** `""` never, `on:YYYY-MM-DD`, or `after:N` posts. */
  repeatEnd: string;
};

type Bulk = {
  posts: BulkPost[];
  selected: string[];
  platforms: PlatformId[];
  accounts: AccountChoices;
  template: string;
  startDay: string;
  /** The clock times of each posting day, one per post. */
  times: string[];
  /** Days. */
  every: number;
  skipWeekends: boolean;
};

function freshBulk(): Bulk {
  return {
    posts: [],
    selected: [],
    platforms: [],
    accounts: {},
    template: "",
    startDay: shiftDay(localDateKey(new Date()), 1),
    times: ["09:00"],
    every: 1,
    skipWeekends: false,
  };
}

const [bulk, setBulk] = createStore<Bulk>(freshBulk());
const [settings, setSettings] = createStore<PlatformSettings>(defaultPlatformSettings());
const [scheduleMode, setScheduleMode] = createSignal<ScheduleMode>("spread");
const [signed, setSigned] = createSignal(true);
const [editing, setEditing] = createSignal<string | null>(null);
const [batchOpen, setBatchOpen] = createSignal(false);
const [selectionCaption, setSelectionCaption] = createSignal("");
const [movingPost, setMovingPost] = createSignal<string | null>(null);
let modeChosen = false;

const signedCaption = (caption: string) => appendSignature(caption, signed() ? vaultSignature()?.body : undefined);
const kindOf = (post: BulkPost): PostKind => (post.story ? "story" : post.media.kind);
const takes = (post: BulkPost, id: PlatformId) => socialPlatform(id).kinds.includes(kindOf(post));
const captionFor = (post: BulkPost, id: PlatformId) => post.overrides[id] ?? post.caption;
const finalCaption = (post: BulkPost, id: PlatformId) => (post.story ? "" : signedCaption(captionFor(post, id)));
const takesTitle = (post: BulkPost) => !post.story && post.platforms.some((id) => socialPlatform(id).title);
const titleFor = (post: BulkPost, index: number) => fillTemplate(post.title, post, index, bulk.posts.length).trim() || baseName(post.media.file).slice(0, 100);
const isLive = (id: PlatformId) => PUBLISHING_PLATFORMS.includes(id);
const sendable = (post: BulkPost) => !post.story && post.platforms.some(isLive);
const livePlatforms = (posts: readonly BulkPost[]) => sortPlatforms(new Set(posts.filter(sendable).flatMap((post) => post.platforms.filter(isLive))));
const ownCaptions = (post: BulkPost) =>
  Object.fromEntries(post.platforms.filter((id) => id !== "youtube").map((id) => [id, finalCaption(post, id)]));

type Issue = { level: "error" | "warning"; message: string; platform?: PlatformId };

function postIssues(post: BulkPost, index: number): Issue[] {
  const issues: Issue[] = [];
  if (!post.platforms.length) {
    const noneFit = bulk.platforms.length > 0 && bulk.platforms.every((id) => !takes(post, id));
    issues.push({ level: "error", message: noneFit ? msg("None of the networks you picked take this file.") : msg("Pick at least one platform.") });
  }
  const when = scheduleProblem(atLocal(post.day, post.time));
  if (when) issues.push({ level: "error", message: when });
  if (post.repeat && post.repeatEnd.startsWith("on:") && post.repeatEnd.slice(3) < post.day) {
    issues.push({ level: "error", message: msg("Pick a repeat end on or after the first post.") });
  }
  for (const message of mediaProblems([post.media])) issues.push({ level: "error", message });
  const summary = summarizeMedia([post.media]);
  issues.push(
    ...checkPost({
      kind: kindOf(post),
      platforms: post.platforms,
      caption: (id) => finalCaption(post, id),
      title: () => titleFor(post, index),
      media: () => summary,
      settings,
    }),
    ...tiktokLimitIssues(kindOf(post), post.platforms, summary?.kind === "video" ? summary.duration : null),
  );
  return issues;
}

function bulkTikTokAccount() {
  const post = bulk.posts.find((item) => item.platforms.includes("tiktok") && !item.story);
  return post ? accountsFor("tiktok", post.accounts).find((account) => account.tiktok) : undefined;
}

const earliestTimeOn = (day: string) => (day === localDateKey(new Date()) ? timeOf(new Date(Date.now() + 60_000)) : undefined);

function fillTemplate(template: string, post: BulkPost, index: number, count: number): string {
  const at = atLocal(post.day, post.time);
  return template
    .replaceAll("{name}", baseName(post.media.file))
    .replaceAll("{n}", String(index + 1))
    .replaceAll("{count}", String(count))
    .replaceAll("{date}", at ? formatDay(at) : "");
}

const refillCaptions = () =>
  setBulk(
    "posts",
    produce((posts) => fillCaptions(posts, bulk.template, (template, post, index) => fillTemplate(template, post, index, posts.length))),
  );

function planTimes(count: number, others: readonly string[], platforms: readonly PlatformId[]): Date[] {
  const mode = scheduleMode();
  if (mode === "queue") return nextQueueTimes(count, { alsoHeld: others });
  if (mode === "best") return dailyBestTimes(platforms, count).map((suggestion) => suggestion.at);
  return spread(count, { startDay: bulk.startDay, times: bulk.times, every: Math.max(1, bulk.every), skipWeekends: bulk.skipWeekends, after: new Date() });
}

function replan(only?: ReadonlySet<string>) {
  const moving = plannedPosts(bulk.posts, only);
  if (!moving.length) return;
  const staying = bulk.posts.filter((post) => !moving.includes(post)).map((post) => `${post.day} ${post.time}`);
  const times = planTimes(moving.length, staying, sortPlatforms(new Set(moving.flatMap((post) => post.platforms))));
  batch(() => {
    setBulk("posts", produce((posts) => assignTimes(posts, times, only)));
    refillCaptions();
  });
}

/** Times and `{n}` follow the rows. */
const afterReorder = () =>
  batch(() => {
    replan();
    refillCaptions();
  });

const replanTarget = () => replan(bulk.selected.length ? new Set(bulk.selected) : undefined);

/** Lets ⌘↵ through to the page's Schedule shortcut. */
function fieldKeys(event: KeyboardEvent) {
  if (!(event.key === "Enter" && (event.metaKey || event.ctrlKey))) event.stopPropagation();
}

function setStory(ids: ReadonlySet<string>, story: boolean) {
  setBulk(
    "posts",
    (post) => ids.has(post.id),
    produce((post) => {
      post.story = story;
      if (story) {
        const fitting = post.platforms.filter((id) => STORY_PLATFORMS.includes(id));
        post.platforms = fitting.length ? fitting : STORY_PLATFORMS.filter((id) => connectionsFor(id).length > 0);
      } else {
        const wanted = bulk.platforms.filter((id) => takes(post, id));
        if (wanted.length) post.platforms = wanted;
      }
      post.accounts = accountsForPlatforms(post.platforms, post.accounts);
    }),
  );
}

const [restoring, setRestoring] = createSignal(true);
const FIELDS_DELAY = 200;
let batchDatabase: string | null = null;
// The fields live in localStorage: it writes at once, so even the last keystroke before a refresh is kept, and a batch with no fields can't come back.
let batchKey = "";
let restored: Promise<void> = Promise.resolve();
let writtenFields: string | undefined;
let fieldsTimer: ReturnType<typeof setTimeout> | undefined;
let warnedAboutKeeping = false;

function warnNotKept() {
  if (warnedAboutKeeping) return;
  warnedAboutKeeping = true;
  toast(t("This device is short on space"), { description: t("Some files won't come back if you refresh. They're safe until then.") });
}

function fieldsNow(): string {
  return JSON.stringify({
    posts: bulk.posts.map(({ media, ...post }) => ({ ...post, media: { kind: media.kind, width: media.width, height: media.height, duration: media.duration } })),
    platforms: bulk.platforms,
    accounts: bulk.accounts,
    template: bulk.template,
    startDay: bulk.startDay,
    times: bulk.times,
    every: bulk.every,
    skipWeekends: bulk.skipWeekends,
    settings,
    scheduleMode: scheduleMode(),
    signed: signed(),
    modeChosen,
  });
}

function writeFieldsNow() {
  clearTimeout(fieldsTimer);
  fieldsTimer = undefined;
  if (!batchDatabase || restoring() || !bulk.posts.length) return;
  const fields = fieldsNow();
  if (fields === writtenFields) return;
  writtenFields = fields;
  try {
    localStorage.setItem(batchKey, fields);
  } catch {
    warnNotKept();
  }
}

function forgetBatch() {
  clearTimeout(fieldsTimer);
  fieldsTimer = undefined;
  writtenFields = undefined;
  if (!batchDatabase) return;
  localStorage.removeItem(batchKey);
  void clearBatchFiles(batchDatabase).catch(() => {});
}

type SavedPost = Omit<BulkPost, "media"> & { media: Pick<PostMedia, "kind" | "width" | "height" | "duration"> };

function readFields(text: string | null): (Partial<Omit<Bulk, "posts">> & { posts: SavedPost[]; settings?: Partial<PlatformSettings>; scheduleMode?: ScheduleMode; signed?: boolean; modeChosen?: boolean }) | null {
  try {
    const fields = text ? JSON.parse(text) : null;
    return Array.isArray(fields?.posts) ? fields : null;
  } catch {
    return null;
  }
}

function emptyBatch() {
  for (const post of bulk.posts) releaseMedia(post.media);
  batch(() => {
    setBulk(reconcile(freshBulk()));
    setSettings(reconcile(defaultPlatformSettings()));
    setEditing(null);
    setBatchOpen(false);
  });
}

/** One batch per workspace: switching puts this one away and brings out the other's. */
async function openBatch(database: string, key: string) {
  writeFieldsNow();
  const switching = batchDatabase !== null;
  batchDatabase = database;
  batchKey = key;
  writtenFields = undefined;
  setRestoring(true);
  if (switching) emptyBatch();
  const [files] = await Promise.all([readBatchFiles(database).catch(() => new Map<string, BatchFile>()), hydrateCalendar()]);
  if (batchDatabase !== database) return;
  const fields = readFields(localStorage.getItem(key));
  const { posts, missing } = restorablePosts(fields?.posts ?? [], files, isOnCalendar);
  const kept = new Set(posts.map(({ post }) => post.id));
  const stray = [...files.keys()].filter((id) => !kept.has(id));
  if (!posts.length) {
    localStorage.removeItem(key);
    void clearBatchFiles(database).catch(() => {});
  } else if (stray.length) {
    void dropBatchFiles(database, stray).catch(() => {});
  }

  if (fields && posts.length) {
    const defaults = defaultPlatformSettings();
    const mergedSettings = Object.fromEntries(
      Object.entries(defaults).map(([id, value]) => [id, { ...value, ...fields.settings?.[id as keyof PlatformSettings] }]),
    ) as PlatformSettings;
    const today = localDateKey(new Date());
    batch(() => {
      setBulk({
        platforms: fields.platforms ?? [],
        accounts: fields.accounts ?? {},
        template: fields.template ?? "",
        startDay: fields.startDay && fields.startDay >= today ? fields.startDay : shiftDay(today, 1),
        times: fields.times?.length ? fields.times : ["09:00"],
        every: fields.every ?? 1,
        skipWeekends: !!fields.skipWeekends,
        posts: posts.map(({ post, file }) => ({
          ...post,
          title: post.title ?? "",
          accounts: accountsForPlatforms(post.platforms, post.accounts),
          media: mediaFromSaved({ ...post.media, file: file.file, poster: file.poster }),
        })),
      });
      setSettings(reconcile(mergedSettings));
      setScheduleMode(fields.scheduleMode ?? "spread");
      setSigned(fields.signed ?? true);
      modeChosen = !!fields.modeChosen;
      // A time that passed since can't go out, so what the plan set moves on; a time set by hand is left for the person to see.
      if (bulk.posts.some((post) => !post.ownTime && scheduleProblem(atLocal(post.day, post.time)))) replan();
    });
    if (missing) {
      toast.error(t("{count, plural, one {# file didn't come back} other {# files didn't come back}}", { count: missing }), { description: t("Add them again to carry on.") });
    }
  }
  setRestoring(false);
}

const SCHEDULE_MODES: { id: ScheduleMode; label: string }[] = [
  { id: "spread", label: msg("Spread out") },
  { id: "queue", label: msg({ message: "Auto-schedule", context: "short label" }) },
  { id: "best", label: msg("Best times") },
];

const PANEL = "flex w-[340px] shrink-0 flex-col border-l border-border-strong bg-sidebar/40 max-md:w-full max-md:border-l-0";
const PLATFORM_SETTINGS_ID = "bulk-platform-settings";

const POST_AS: { id: "post" | "story"; label: string }[] = [
  { id: "post", label: msg("Posts") },
  { id: "story", label: msg("Stories") },
];

export function DashboardBulkToolsView() {
  return (
    <Show
      when={!paidToolsLocked()}
      fallback={
        <div class="flex min-h-0 flex-1 flex-col">
          <DashboardPageHeader />
          <div class="flex flex-col items-center gap-3 px-6 pt-16 text-center">
            <h2 class="text-sm font-medium text-foreground">{t("Bulk tools come with a paid plan")}</h2>
            <p class="text-xs text-muted-foreground">{t("Schedule a batch of posts at once, or from a CSV file.")}</p>
            <SeePlansButton />
          </div>
        </div>
      }
    >
      <BulkTools />
    </Show>
  );
}

function BulkTools() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  useQueueSlots();
  createEffect(() => loadVault(auth.user()?.id));
  createEffect(() => {
    const owner = auth.ownerId();
    void activeWorkspaceId();
    if (!owner) return;
    loadWorkspaces(owner);
    const database = workspaceDatabase(BULK_DATABASE);
    if (database !== batchDatabase) restored = openBatch(database, workspaceKey("plan.video.bulk", owner));
  });
  createEffect(() => {
    if (restoring() || !bulk.posts.length) return;
    fieldsNow();
    clearTimeout(fieldsTimer);
    fieldsTimer = setTimeout(writeFieldsNow, FIELDS_DELAY);
  });
  onCleanup(writeFieldsNow);
  createEffect(() => {
    loadSocialConnections(auth.user()?.id);
    const next = accountsForPlatforms(bulk.platforms, bulk.accounts);
    if (!sameChoices(next, bulk.accounts)) setBulk("accounts", reconcile(next));
  });
  const [dragging, setDragging] = createSignal(false);
  const [reading, setReading] = createSignal<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = createSignal<"draft" | "scheduled" | "now" | null>(null);

  const issues = createMemo(() => new Map(bulk.posts.map((post, index) => [post.id, postIssues(post, index)])));
  const blocked = () => bulk.posts.filter((post) => issues().get(post.id)?.some((issue) => issue.level === "error"));
  // Settings are shared, so a problem with them is named once in the footer, not on every row.
  const settingsProblems = createMemo(() => {
    const problems: Issue[] = [];
    for (const id of sortPlatforms(new Set(bulk.posts.filter((post) => !post.story).flatMap((post) => post.platforms)))) {
      settingsIssues(id, settings, (level, message) => {
        if (level === "error") problems.push({ level, message, platform: id });
      });
    }
    return problems;
  });
  const isSettingsProblem = (issue: Issue) => settingsProblems().some((problem) => problem.platform === issue.platform && problem.message === issue.message);
  const rowIssues = (post: BulkPost) => (issues().get(post.id) ?? []).filter((issue) => !isSettingsProblem(issue));
  const blockingSetting = () => settingsProblems().find((problem) => blocked().some((post) => issues().get(post.id)?.some((issue) => issue.platform === problem.platform && issue.message === problem.message)));
  const showFix = () => {
    if (!blockingSetting()) {
      setEditing(blocked()[0]!.id);
      return;
    }
    batch(() => {
      setEditing(null);
      setBatchOpen(true);
    });
    queueMicrotask(() => document.getElementById(PLATFORM_SETTINGS_ID)?.scrollIntoView());
  };
  const target = () => (bulk.selected.length ? bulk.posts.filter((post) => bulk.selected.includes(post.id)) : bulk.posts);
  const editingIndex = () => bulk.posts.findIndex((post) => post.id === editing());
  const room = () => MAX_POSTS - bulk.posts.length;

  const addFiles = async (dropped: File[]) => {
    await restored;
    const known = new Set(bulk.posts.map((post) => fileKey(post.media.file)));
    const turnedAway = dropped.filter((file) => mediaKind(file) === "image" && imageFileProblem(file));
    if (turnedAway.length) {
      toast.error(t("{count, plural, =1 {Can't post that picture} other {Can't post # of those pictures}}", { count: turnedAway.length }), {
        description: turnedAway.length === 1 ? t(imageFileProblem(turnedAway[0]!)!) : t("Pictures need to be JPG or PNG, up to 8 MB each."),
      });
    }
    const files = dropped.filter((file) => !turnedAway.includes(file));
    if (!files.length) return;
    const usable = files.filter((file) => mediaKind(file) && !known.has(fileKey(file)));
    if (!usable.length) {
      toast(files.some((file) => mediaKind(file)) ? t("Those files are already here") : t("Only videos and pictures can be posted"));
      return;
    }
    if (usable.length > room()) toast(t("{count, plural, one {Bulk tools takes up to # post at a time} other {Bulk tools takes up to # posts at a time}}", { count: MAX_POSTS }));
    const queue = usable.slice(0, Math.max(0, room())).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!queue.length) return;
    if (!bulk.posts.length) {
      batch(() => {
        // A batch doesn't start on a network it can't get ready: one with no account, or a TikTok that can't say who may watch.
        if (!bulk.platforms.length) setBulk("platforms", DEFAULT_PLATFORMS.filter((id) => connectionsFor(id).some((account) => id !== "tiktok" || account.tiktok)));
        if (!modeChosen && queueSlots().length) setScheduleMode("queue");
        const today = localDateKey(new Date());
        if (bulk.startDay < today) setBulk("startDay", shiftDay(today, 1));
      });
    }

    setReading({ done: 0, total: queue.length });
    const readOne = () => setReading((current) => current && { ...current, done: Math.min(current.done + 1, current.total - 1) });
    let failed = 0;
    try {
      await readInOrder(
        queue,
        readMedia,
        (media) => {
          void keepInLibrary([media]);
          const id = newId();
          const fitting = bulk.platforms.filter((platform) => socialPlatform(platform).kinds.includes(media.kind));
          if (batchDatabase) void writeBatchFile(batchDatabase, { id, file: media.file, poster: media.poster }).catch(warnNotKept);
          batch(() => {
            setBulk("posts", bulk.posts.length, {
              id,
              media,
              caption: "",
              ownCaption: false,
              overrides: {},
              title: "",
              story: false,
              platforms: fitting,
              accounts: accountsForPlatforms(fitting, bulk.accounts),
              day: bulk.startDay,
              time: bulk.times[0]!,
              ownTime: false,
              repeat: "",
              repeatEnd: "",
            });
            replan();
            readOne();
          });
        },
        () => {
          failed++;
          readOne();
        },
        READ_AT_ONCE,
      );
    } finally {
      setReading(null);
    }
    if (failed) toast.error(t("{count, plural, =1 {Could not read one file} other {Could not read # files}}", { count: failed }));
  };

  const pick = async () => void addFiles(await pickFiles({ accept: POSTABLE_FILES, multiple: true }));
  const handlers = createDropHandlers((files) => void addFiles(files), setDragging, droppedFiles);

  const remove = (ids: readonly string[]) => {
    const gone = new Set(ids);
    for (const post of bulk.posts) if (gone.has(post.id)) releaseMedia(post.media);
    batch(() => {
      setBulk("posts", (posts) => posts.filter((post) => !gone.has(post.id)));
      setBulk("selected", (selected) => selected.filter((id) => !gone.has(id)));
      if (gone.has(editing() ?? "")) setEditing(null);
      replan();
    });
    // The fields go first, so a refresh right now can't find a post whose file has just left.
    if (!bulk.posts.length) {
      forgetBatch();
    } else {
      writeFieldsNow();
      if (batchDatabase) void dropBatchFiles(batchDatabase, ids).catch(() => {});
    }
  };

  const clearAll = () => {
    for (const post of bulk.posts) releaseMedia(post.media);
    forgetBatch();
    batch(() => {
      setBulk("posts", []);
      setBulk("selected", []);
      setBulk("template", "");
      setSettings(reconcile(defaultPlatformSettings()));
      setEditing(null);
      setBatchOpen(false);
    });
  };

  const saveAll = async (status: "draft" | "scheduled", now?: Date) => {
    const planned = bulk.posts.map((post, index) => {
      const at = atLocal(post.day, post.time);
      const day = at ? null : atLocal(post.day, "00:00");
      const goesNow = !!now && sendable(post);
      return {
        post,
        // Same id on every try, so a retry after a partial failure overwrites saved posts instead of adding copies.
        id: post.id,
        title: postTitle(post.story ? "" : post.caption, post.story ? t("Story · {name}", { name: baseName(post.media.file) }) : titleFor(post, index)),
        caption: post.story ? "" : signedCaption(post.caption),
        platforms: post.platforms,
        accounts: accountsForPlatforms(post.platforms, post.accounts),
        link: !post.story && post.platforms.includes("pinterest") ? settings.pinterest.link : undefined,
        tiktok: !post.story && post.platforms.includes("tiktok") ? tiktokPostSettings(settings) : undefined,
        youtube:
          !post.story && post.platforms.includes("youtube")
            ? youtubePostSettings(settings, finalCaption(post, "youtube"), {
                title: titleFor(post, index),
                short: youtubeFormat(summarizeMedia([post.media])) === "short",
              })
            : undefined,
        instagram: !post.story && post.platforms.includes("instagram") ? instagramPostSettings(settings) : undefined,
        x: !post.story && post.platforms.includes("x") ? xPostSettings(settings) : undefined,
        pinterest:
          !post.story && post.platforms.includes("pinterest") ? { title: titleFor(post, index), board: settings.pinterest.board.trim() } : undefined,
        story: post.story,
        captions: post.story ? undefined : ownCaptions(post),
        when: goesNow ? now : (at ?? day ?? nextSlot()),
        untimed: !goesNow && !!day,
        repeat: goesNow ? "" : post.repeat,
        repeatEnd: goesNow || !post.repeat ? "" : post.repeatEnd,
        files: { shared: [post.media.file] },
        status: now
          ? goesNow && post.platforms.every(isLive)
            ? ("scheduled" as const)
            : ("draft" as const)
          : status,
      };
    });
    const error = await savePosts(planned);
    if (error) {
      toast.error(t("Could not save the posts"), { description: t(error) });
      return null;
    }
    void (async () => {
      for (const item of planned) {
        const made = await thumbnailFromFile(item.post.media.file);
        if (made) setPostThumbnail(item.id, made);
      }
    })();
    if (planned.some((item) => !item.post.story && item.platforms.includes("pinterest"))) rememberPinterestBoard(settings.pinterest.board);
    return planned;
  };

  const shuffleAll = () =>
    batch(() => {
      setBulk("posts", (posts) => shuffled(posts));
      afterReorder();
    });

  const save = async (status: "draft" | "scheduled", guestReason: "schedule" | "post" = "schedule") => {
    if (saving() || reading() || !bulk.posts.length) return;
    if (status === "scheduled" && blocked().length) return;
    // Guest mode's demo never sends anything.
    if (status === "scheduled" && auth.isGuest()) {
      askForAccount({ reason: guestReason });
      return;
    }
    setSaving(status);
    try {
      const planned = await saveAll(status);
      if (!planned) return;
      const first = planned.map((post) => post.when).sort((a, b) => a.getTime() - b.getTime())[0]!;
      const count = planned.length;
      track(status === "draft" ? "bulk_drafts_saved" : "bulk_scheduled", { posts: count });
      toast.success(
        status === "draft"
          ? t("{count, plural, one {Saved # draft} other {Saved # drafts}}", { count })
          : t("{count, plural, one {Scheduled # post} other {Scheduled # posts}}", { count }),
        {
          description: t("Starting {date}. They wait on your calendar until you post them.", { date: formatWhen(first) }),
          action: { label: t("Open calendar"), onClick: () => setParams({ dashboard: "calendar", date: localDateKey(first), view: undefined }) },
        },
      );
      clearAll();
    } finally {
      setSaving(null);
    }
  };

  const postNow = async () => {
    if (saving() || reading() || blocked().length) return;
    const sending = bulk.posts.filter(sendable);
    if (!sending.length) return;
    if (auth.isGuest()) return save("scheduled", "post");
    const userId = auth.user()?.id;
    if (!userId) {
      toast.error(t("Sign in before posting."));
      return;
    }
    loadSocialConnections(userId);
    const unconnected = (id: "tiktok" | "youtube" | "bluesky" | "linkedin" | "x" | MetaNetwork) =>
      sending.some((post) => post.platforms.includes(id) && !accountsFor(id, post.accounts).some((account) => account[id]));
    if (unconnected("tiktok")) {
      toast.error(t("Connect TikTok first"), { description: t("Open Connections and sign in with TikTok.") });
      return;
    }
    if (unconnected("youtube")) {
      toast.error(t("Connect YouTube first"), {
        description: t("Open Connections and sign in with the Google account that owns the channel."),
      });
      return;
    }
    if (unconnected("bluesky")) {
      toast.error(t("Connect Bluesky first"), { description: t("Open Connections and sign in with your handle and an app password.") });
      return;
    }
    if (unconnected("linkedin")) {
      toast.error(t("Connect LinkedIn first"), { description: t("Open Connections and sign in with LinkedIn.") });
      return;
    }
    if (unconnected("x")) {
      toast.error(t("Connect X first"), { description: t("Open Connections and sign in with X.") });
      return;
    }
    const meta = META_NETWORKS.find(unconnected);
    if (meta) {
      toast.error(t("Connect {network} first", { network: META_NAMES[meta] }), { description: t("Open Connections and sign in with {network}.", { network: META_NAMES[meta] }) });
      return;
    }
    setSaving("now");
    try {
      const planned = await saveAll("draft", new Date());
      if (!planned) return;
      const sends = planned.filter((item) => sendable(item.post)).map((item) => ({ id: item.id, caption: finalCaption(item.post, "tiktok") }));
      const live = livePlatforms(sending);
      const staying = sortPlatforms(new Set(planned.flatMap((item) => item.platforms.filter((id) => !isLive(id)))));
      const tiktokVideos = sending.some((post) => post.media.kind === "video" && post.platforms.includes("tiktok"));
      track("bulk_posted_now", { posts: planned.length, tiktok: sends.length });
      clearAll();
      toast(t("Publishing to {platforms}", { platforms: listNames(live) }), {
        description: [
          staying.length ? t("{count, plural, one {{names} stays a draft.} other {{names} stay a draft.}}", { count: staying.length, names: listNames(staying) }) : null,
          tiktokVideos ? t("TikTok can take a few minutes to process them before they show on your profile.") : null,
          live.includes("youtube") ? t("YouTube may still be processing them after the upload.") : null,
        ]
          .filter(Boolean)
          .join(" "),
        action: { label: t("Open Posts"), onClick: () => setParams({ dashboard: "posts" }) },
      });
      void (async () => {
        for (const send of sends) await sendPost(send.id, userId, send.caption);
      })();
    } finally {
      setSaving(null);
    }
  };

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      void save("scheduled");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pagehide", writeFieldsNow);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pagehide", writeFieldsNow);
    });
  });

  return (
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <main class={cx("relative flex min-w-0 flex-1 flex-col", (editingIndex() >= 0 || batchOpen()) && "max-md:hidden")} {...handlers}>
        <DashboardPageHeader noPhoneCrumbs={bulk.posts.length > 0}>
          <Show when={reading()}>
            {(progress) => (
              <span class="flex items-center gap-1 text-xs text-muted-foreground max-md:sr-only">
                <Icon name="spinner-loader" class="size-5 animate-spin" />
                {t("Reading {count} of {total}", { count: progress().done + 1, total: progress().total })}
              </span>
            )}
          </Show>
          <Switch>
            <Match when={bulk.selected.length}>
              <Button variant="secondary" class="md:hidden" onClick={() => setBatchOpen(true)}>
                {t("Edit selected")}
              </Button>
              <Button variant="ghost" onClick={() => setBulk("selected", [])}>
                {t("Deselect")}
              </Button>
              <Button variant="secondary" class="gap-1 pl-1" onClick={() => remove(bulk.selected)}>
                <Icon name="trash" class="size-5" />
                {t("Remove")}
              </Button>
            </Match>
            <Match when={bulk.posts.length}>
              <Button variant="secondary" class="md:hidden" onClick={() => setBatchOpen(true)}>
                {t("Edit all")}
              </Button>
              <BatchMenu room={room()} reading={!!reading()} onLibrary={(files) => void addFiles(files)} onShuffle={shuffleAll} onClear={clearAll} />
              <Button variant="secondary" class="gap-1 pl-1 max-md:w-7 max-md:px-0" disabled={room() <= 0} onClick={() => void pick()}>
                <Icon name="plus-add" class="size-5" />
                <span class="max-md:sr-only">{t("Add files")}</span>
              </Button>
            </Match>
          </Switch>
        </DashboardPageHeader>

        <Show
          when={bulk.posts.length}
          fallback={
            <Show when={!restoring()}>
              <EmptyState dragging={dragging()} reading={!!reading()} onPick={() => void pick()} actions={
                <MediaPicker class={dropZoneAction} kinds={["video", "image"]} max={Math.max(1, room())} onPick={(files) => void addFiles(files)}>
                  <Icon name="all-media-types" class="-ml-1.5 size-5" />
                  <span>{t("From library")}</span>
                </MediaPicker>
              } />
            </Show>
          }
        >
          <div data-bulk-rows class="min-h-0 flex-1 overflow-auto">
            <PostTable issuesOf={rowIssues} onRemove={(id) => remove([id])} />
          </div>

          <Show when={dragging()}>
            <div class="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-xl border border-dashed border-primary bg-primary/5">
              <span class="rounded-md bg-background px-3 py-1.5 text-xs text-foreground shadow-md">{t("Drop to add posts")}</span>
            </div>
          </Show>

          <footer class="flex shrink-0 flex-wrap items-center justify-end gap-x-6 gap-y-2 border-t border-border-strong px-5 py-3 max-md:px-3 max-md:py-2">
            <div class="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 text-xs max-md:basis-full">
              <Show
                when={blocked().length}
                fallback={
                  <span class="truncate text-muted-foreground">
                    {t("{count, plural, one {# post ready} other {# posts ready}}", { count: bulk.posts.length })}
                    <ScheduleRange posts={bulk.posts} />
                  </span>
                }
              >
                <Show
                  when={blockingSetting()}
                  fallback={
                    <>
                      <Icon name="alert-warning" class="-my-1 size-5 shrink-0 text-destructive" />
                      <span class="truncate text-foreground">
                        {t("{count, plural, one {# post needs a fix} other {# posts need a fix}}", { count: blocked().length })}
                      </span>
                    </>
                  }
                >
                  {(problem) => (
                    <>
                      <PlatformLogo id={problem().platform!} compact class="size-4" />
                      <span class="truncate text-foreground">{t(problem().message)}</span>
                    </>
                  )}
                </Show>
                <button type="button" class="ml-1 shrink-0 rounded-md text-muted-foreground underline underline-offset-2 hover:text-foreground focus-ring" onClick={showFix}>
                  {t("Show me")}
                </button>
              </Show>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button variant="ghost" class="text-muted-foreground" disabled={!!saving() || !!reading()} onClick={() => void save("draft")}>
                {t("Save as drafts")}
              </Button>
              <Show when={bulk.posts.some(sendable)}>
                <Tooltip>
                  <TooltipTrigger as={Button} variant="secondary" class="gap-1.5 px-3" disabled={!!saving() || !!reading() || blocked().length > 0} onClick={() => void postNow()}>
                    <Show when={saving() === "now"}>
                      <Icon name="spinner-loader" class="-ml-1 size-5 animate-spin" />
                    </Show>
                    {t("Post now")}
                  </TooltipTrigger>
                  <TooltipContent class="max-w-64">
                    {t("Sends the posts to {platforms} now. Other platforms stay drafts.", { platforms: listNames(livePlatforms(bulk.posts)) })}
                  </TooltipContent>
                </Tooltip>
              </Show>
              <Tooltip>
                <TooltipTrigger as={Button} class="gap-1.5 px-3" disabled={!!saving() || !!reading() || blocked().length > 0} onClick={() => void save("scheduled")}>
                  <Show when={saving() === "scheduled"}>
                    <Icon name="spinner-loader" class="-ml-1 size-5 animate-spin" />
                  </Show>
                  {t("{count, plural, one {Schedule # post} other {Schedule # posts}}", { count: bulk.posts.length })}
                </TooltipTrigger>
                <TooltipContent shortcut="⌘↵">{t({ message: "Schedule", context: "verb" })}</TooltipContent>
              </Tooltip>
            </div>
          </footer>
        </Show>
      </main>

      <Show when={bulk.posts.length}>
        <Show when={editingIndex() >= 0} fallback={<BatchPanel target={target()} problem={blockingSetting()} class={batchOpen() ? undefined : "max-md:hidden"} />}>
          <PostPanel index={editingIndex()} issues={issues().get(bulk.posts[editingIndex()]!.id) ?? []} problem={blockingSetting()} />
        </Show>
      </Show>
    </div>
  );
}

function ScheduleRange(props: { posts: readonly BulkPost[] }) {
  const range = () => {
    const times = props.posts
      .map((post) => atLocal(post.day, post.time))
      .filter((at): at is Date => !!at)
      .sort((a, b) => a.getTime() - b.getTime());
    if (!times.length) return "";
    const first = times[0]!;
    const last = times.at(-1)!;
    return localDateKey(first) === localDateKey(last) ? `, ${formatDay(first)}` : `, ${t("{first} to {last}", { first: formatDay(first), last: formatDay(last) })}`;
  };
  return <>{range()}</>;
}

function EmptyState(props: { dragging: boolean; reading: boolean; onPick(): void; actions: JSX.Element }) {
  return (
    <div class="flex min-h-0 flex-1 p-6 max-md:p-3">
      <DropZone
        icon="layers"
        title={props.reading ? t("Reading…") : t("Drop a batch of videos or pictures")}
        hint={t("Each file becomes its own post or story: an MP4 or MOV up to 5 minutes, or a JPG or PNG. Up to {count} at a time.", { count: MAX_POSTS })}
        pickLabel={t("Choose files")}
        dragging={props.dragging}
        onPick={() => props.onPick()}
        actions={props.actions}
        class="flex-1"
      />
    </div>
  );
}

const ROW_GRID = "grid items-center gap-3 px-5 max-md:grid-cols-[1rem_minmax(0,1fr)_minmax(0,1fr)_1.75rem] max-md:gap-x-2 max-md:gap-y-1 max-md:px-3";
const ROW_COLUMNS = "md:grid-cols-[1rem_minmax(11rem,1fr)_minmax(11rem,1fr)_6rem_9rem]";
const ROW_COLUMNS_TITLED = "md:grid-cols-[1rem_minmax(9rem,1fr)_minmax(7rem,1fr)_minmax(7rem,1fr)_5rem_8rem]";
const ROW_CELL = "min-h-8 rounded-md border border-transparent bg-transparent px-2 text-xs transition-colors hover:bg-accent";
const CELL_INSET = "border-x border-transparent px-2";

function PostTable(props: { issuesOf(post: BulkPost): Issue[]; onRemove(id: string): void }) {
  const allSelected = () => bulk.posts.length > 0 && bulk.selected.length === bulk.posts.length;
  const toggleAll = () => setBulk("selected", allSelected() ? [] : bulk.posts.map((post) => post.id));
  const titled = createMemo(() => bulk.posts.some(takesTitle));
  const columns = () => (titled() ? ROW_COLUMNS_TITLED : ROW_COLUMNS);

  return (
    <div class="md:min-w-[46rem]">
      <div class={`${ROW_GRID} ${columns()} sticky top-0 z-10 h-9 border-b border-border-strong bg-background text-xs text-muted-foreground max-md:hidden`}>
        <Checkbox
          checked={allSelected()}
          indeterminate={bulk.selected.length > 0 && !allSelected()}
          onChange={toggleAll}
          class="flex items-center"
        >
          <CheckboxInput aria-label={t("Select all")} />
          <CheckboxControl class="border-(--border-input)" />
        </Checkbox>
        <span>{t({ message: "Post", context: "noun" })}</span>
        <Show when={titled()}>
          <span class={CELL_INSET}>{t("Title")}</span>
        </Show>
        <span class={CELL_INSET}>{t("Caption")}</span>
        <span class={CELL_INSET}>{t("Post to")}</span>
        <span class={cx(CELL_INSET, "-mr-2 truncate text-right")}>{t("When · {zone}", { zone: timeZoneName() })}</span>
      </div>
      <For each={bulk.posts}>
        {(post, index) => <PostRow post={post} index={index()} titled={titled()} columns={columns()} issues={props.issuesOf(post)} onRemove={() => props.onRemove(post.id)} />}
      </For>
    </div>
  );
}

let selectionAnchor: string | null = null;

function PostRow(props: { post: BulkPost; index: number; titled: boolean; columns: string; issues: Issue[]; onRemove(): void }) {
  const selected = () => bulk.selected.includes(props.post.id);
  const open = () => editing() === props.post.id;
  let shifted = false;
  const toggle = () => {
    const anchor = bulk.posts.findIndex((post) => post.id === selectionAnchor);
    if (shifted && anchor >= 0) {
      const range = bulk.posts.slice(Math.min(anchor, props.index), Math.max(anchor, props.index) + 1).map((post) => post.id);
      setBulk("selected", (ids) => [...new Set([...ids, ...range])]);
    } else {
      setBulk("selected", (ids) => (ids.includes(props.post.id) ? ids.filter((id) => id !== props.post.id) : [...ids, props.post.id]));
    }
    selectionAnchor = props.post.id;
  };
  const pasteColumn = (field: "caption" | "title") => (event: ClipboardEvent) => {
    const values = spreadsheetColumn(event.clipboardData?.getData("text/html") ?? "", event.clipboardData?.getData("text/plain") ?? "");
    if (values.length < 2) return;
    event.preventDefault();
    const before = new Map(bulk.posts.map((post) => [post.id, { caption: post.caption, own: post.ownCaption, title: post.title }]));
    let result = { filled: 0, left: 0 };
    batch(() => {
      setBulk("posts", produce((posts) => (result = field === "caption" ? fillDown(posts, props.index, values) : fillTitlesDown(posts, props.index, values, takesTitle))));
      refillCaptions();
    });
    const filled = field === "caption" ? t("{count, plural, one {Filled # caption} other {Filled # captions}}", { count: result.filled }) : t("{count, plural, one {Filled # title} other {Filled # titles}}", { count: result.filled });
    toast(filled, {
      description: result.left ? t("{count, plural, one {# more had no post to go on.} other {# more had no posts to go on.}}", { count: result.left }) : undefined,
      action: {
        label: t("Undo"),
        onClick: () =>
          batch(() => {
            setBulk(
              "posts",
              produce((posts) => {
                for (const post of posts) {
                  const saved = before.get(post.id);
                  if (!saved) continue;
                  post.caption = saved.caption;
                  post.ownCaption = saved.own;
                  post.title = saved.title;
                }
              }),
            );
            refillCaptions();
          }),
      },
    });
  };
  const moveTo = (to: number) => {
    const from = bulk.posts.findIndex((post) => post.id === props.post.id);
    if (to !== from) setBulk("posts", (posts) => moveItem(posts, from, to));
  };
  const startMove = (event: PointerEvent & { currentTarget: HTMLButtonElement }) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const scroller = event.currentTarget.closest<HTMLElement>("[data-bulk-rows]");
    setMovingPost(props.post.id);
    // On the window: reordering moves this row in the page, which would drop a capture held by its handle.
    const follow = (move: PointerEvent) => {
      const row = document.elementsFromPoint(move.clientX, move.clientY).find((element): element is HTMLElement => element instanceof HTMLElement && !!element.dataset.bulkRow);
      if (row) moveTo(Number(row.dataset.bulkRow));
      if (!scroller) return;
      const { top, bottom } = scroller.getBoundingClientRect();
      if (move.clientY < top + 40) scroller.scrollTop -= 16;
      else if (move.clientY > bottom - 40) scroller.scrollTop += 16;
    };
    const stop = () => {
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      setMovingPost(null);
      afterReorder();
    };
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  const moveByKey = (event: KeyboardEvent & { currentTarget: HTMLButtonElement }) => {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const to = props.index + step;
    if (!step || to < 0 || to >= bulk.posts.length) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    batch(() => {
      moveTo(to);
      afterReorder();
    });
    handle.focus();
  };
  const writeCaption = (text: string) =>
    batch(() => {
      update("caption", text);
      update("ownCaption", !!text.trim());
      if (!text.trim()) refillCaptions();
    });
  const nextField = (selector: string) => (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
    fieldKeys(event);
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.isComposing) return;
    event.preventDefault();
    const fields = [...document.querySelectorAll<HTMLElement>(selector)];
    fields[fields.indexOf(event.currentTarget) + 1]?.focus();
  };
  const update = <K extends keyof BulkPost>(key: K, value: BulkPost[K]) => setBulk("posts", props.index, key, value);

  const errors = () => props.issues.filter((issue) => issue.level === "error");
  const warnings = () => props.issues.filter((issue) => issue.level === "warning");
  const media = () => props.post.media;
  const ownCaptions = () => Object.keys(props.post.overrides).length;
  const issueText = (issues: readonly Issue[]) => issues.map((issue) => t(issue.message)).join("\n");

  return (
    <div
      data-bulk-row={String(props.index)}
      class={cx(ROW_GRID, props.columns, "group relative border-b border-border-strong/60 py-2 transition-colors max-md:pl-6")}
      classList={{ "bg-accent": movingPost() === props.post.id, "bg-accent/50": open() && movingPost() !== props.post.id, "bg-primary/5": selected() && !open() && movingPost() !== props.post.id }}
    >
      <button
        type="button"
        aria-label={t("Move {name}", { name: media().file.name })}
        title={t("Drag to change the order")}
        class="absolute inset-y-0 left-0.5 my-auto grid h-8 w-4 cursor-grab touch-none place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-ring active:cursor-grabbing max-md:opacity-100"
        onPointerDown={startMove}
        onKeyDown={moveByKey}
      >
        <Icon name="grip-vertical" class="size-4" />
      </button>
      <Checkbox
        checked={selected()}
        onChange={toggle}
        onPointerDown={(event: PointerEvent) => (shifted = event.shiftKey)}
        class="flex items-center"
      >
        <CheckboxInput aria-label={t("Select {name}", { name: media().file.name })} />
        <CheckboxControl class="border-(--border-input)" />
      </Checkbox>

      <button
        type="button"
        class="flex min-w-0 items-center gap-2.5 rounded-md text-left focus-ring max-md:col-span-2"
        title={t("Open this post")}
        onClick={() => setEditing(open() ? null : props.post.id)}
      >
        <img src={media().kind === "video" ? media().poster : media().url} alt="" class="size-12 shrink-0 rounded-md bg-black object-cover" draggable={false} />
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="truncate text-xs text-foreground group-hover:underline group-hover:underline-offset-2" title={media().file.name}>
            {media().file.name}
          </span>
          <Show
            when={errors()[0]}
            fallback={
              <span class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <span class="truncate">
                  <Show when={props.post.story}>{t("Story")} · </Show>
                  {media().kind === "video" ? `${t("Video")} · ${formatDuration(media().duration)}` : t("Picture")}
                </span>
                <Show when={props.post.repeat}>
                  <Icon name="loop" class="-my-1 size-4 shrink-0" />
                </Show>
                <Show when={warnings().length}>
                  <span class="-my-1 shrink-0" title={issueText(warnings())}>
                    <Icon name="alert-warning" class="size-4 text-meter-yellow" />
                  </span>
                </Show>
              </span>
            }
          >
            {(issue) => (
              <span class="flex min-w-0 items-start gap-1 text-xs leading-4 text-destructive" title={issueText(errors())}>
                <Show when={issue().platform}>{(id) => <PlatformLogo id={id()} compact class="mt-px size-3.5" />}</Show>
                <span class="line-clamp-2">{t(issue().message)}</span>
                <Show when={errors().length > 1}>
                  <span class="shrink-0">+{errors().length - 1}</span>
                </Show>
              </span>
            )}
          </Show>
        </span>
      </button>

      <Show when={props.titled}>
        <Show when={takesTitle(props.post)} fallback={<span class="max-md:hidden" />}>
          <input
            data-bulk-title
            aria-label={t("Title for {name}", { name: media().file.name })}
            class={cx(ROW_CELL, "w-full text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:bg-input max-md:order-2 max-md:col-span-full")}
            placeholder={baseName(media().file)}
            value={props.post.title}
            onInput={(event) => update("title", event.currentTarget.value)}
            onKeyDown={nextField("[data-bulk-title]")}
            onPaste={pasteColumn("title")}
          />
        </Show>
      </Show>

      <Show
        when={!props.post.story}
        fallback={<span class={cx(CELL_INSET, "text-xs text-muted-foreground max-md:order-2 max-md:col-span-full")}>{t("Stories go out without a caption.")}</span>}
      >
        <div class="relative max-md:order-2 max-md:col-span-full">
          <textarea
            data-bulk-caption
            aria-label={t("Caption for {name}", { name: media().file.name })}
            class={cx(ROW_CELL, "block max-h-12 w-full resize-none py-1.5 leading-4 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground focus:border-primary focus:bg-input")}
            placeholder={t("Write a caption…")}
            value={props.post.caption}
            onInput={(event) => writeCaption(event.currentTarget.value)}
            onKeyDown={nextField("[data-bulk-caption]")}
            onPaste={pasteColumn("caption")}
          />
          <Show when={ownCaptions()}>
            <span class="pointer-events-none absolute right-1.5 bottom-1 rounded-md bg-background/80 px-1 text-xxs leading-4 text-muted-foreground">
              {t("{count, plural, one {+# own} other {+# own}}", { count: ownCaptions() })}
            </span>
          </Show>
        </div>
      </Show>

      <RowPlatforms
        available={platformsFor(kindOf(props.post))}
        value={props.post.platforms}
        accounts={props.post.accounts}
        onChange={(ids, accounts) => batch(() => {
          update("platforms", ids);
          setBulk("posts", props.index, "accounts", reconcile(accounts));
        })}
      />

      <DateTimePicker
        plain
        label={t("When {name} goes out", { name: media().file.name })}
        class={cx(ROW_CELL, "pl-2 max-md:order-2 max-md:col-span-2 md:translate-x-1 md:pr-1 md:text-right data-[expanded]:bg-accent")}
        day={props.post.day}
        time={props.post.time}
        minDay={localDateKey(new Date())}
        maxDay={localDateKey(latestSchedule())}
        minTime={earliestTimeOn}
        onChange={(day, time) =>
          batch(() => {
            update("day", day);
            update("time", time);
            update("ownTime", true);
          })
        }
      />

      <Button
        variant="ghost"
        size="icon-square"
        aria-label={t("Remove {name}", { name: media().file.name })}
        class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 md:absolute md:inset-y-0 md:right-0.5 md:my-auto md:h-8 md:w-4 max-md:order-1 max-md:opacity-100"
        onClick={() => props.onRemove()}
      >
        <Icon name="trash" class="size-5 text-muted-foreground md:size-4" />
      </Button>
    </div>
  );
}

function IssueList(props: { issues: readonly Issue[] }) {
  return (
    <ul class="flex flex-col gap-1">
      <For each={props.issues}>
        {(issue) => (
          <li class="flex items-start gap-1.5">
            <Show when={issue.platform}>{(id) => <PlatformLogo id={id()} class="mt-px size-3.5" />}</Show>
            <span>{t(issue.message)}</span>
          </li>
        )}
      </For>
    </ul>
  );
}

function RowPlatforms(props: {
  available: readonly PlatformId[];
  accounts: AccountChoices;
  value: PlatformId[];
  onChange(ids: PlatformId[], accounts: AccountChoices): void;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <Popover open={open()} onOpenChange={setOpen} placement="bottom-start">
      <PopoverTrigger
        as="button"
        type="button"
        aria-label={props.value.length ? t("Platforms: {names}", { names: props.value.map((id) => socialPlatform(id).name).join(", ") }) : t("Choose platforms")}
        class={cx(ROW_CELL, "flex min-w-0 items-center press data-[expanded]:bg-accent focus-ring max-md:order-2 max-md:col-span-2")}
      >
        <Show when={props.value.length} fallback={<span class="text-left text-xs leading-4 text-muted-foreground">{t("Choose")}</span>}>
          <PlatformLogos ids={props.value} max={3} compact logoClass="size-5" />
        </Show>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="w-80 rounded-xl p-1.5">
          <PlatformPicker
            variant="logos"
            value={props.value}
            accounts={props.accounts}
            available={props.available}
            onChange={props.onChange}
          />
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function PostTo(props: {
  value: readonly PlatformId[];
  accounts: AccountChoices;
  available?: readonly PlatformId[];
  onChange(ids: PlatformId[], accounts: AccountChoices): void;
}) {
  return (
    <div class="flex flex-col rounded-xl border border-(--border-input)">
      <PlatformPicker variant="row" class="p-1" value={props.value} accounts={props.accounts} available={props.available} onChange={props.onChange} />
      <AccountGroupPicker
        class="border-t border-(--border-input) px-3 py-2.5"
        platforms={props.value}
        accounts={props.accounts}
        available={props.available}
        onPick={props.onChange}
      />
    </div>
  );
}

async function importCsv() {
  const [file] = await pickFiles({ accept: ".csv,text/csv,text/plain" });
  if (!file) return;
  const rows = readCaptionRows(await file.text());
  if (!rows.length) {
    toast.error(t("No captions found"), {
      description: t("The first row needs a {file} column, plus {caption}, {date}, {time} or {platforms}.", {
        file: "file",
        caption: "caption",
        date: "date",
        time: "time",
        platforms: "platforms",
      }),
    });
    return;
  }
  const byName = new Map(rows.map((row) => [fileMatchKey(row.file), row]));
  let matched = 0;
  setBulk(
    "posts",
    produce((list) => {
      for (const post of list) {
        const row = byName.get(fileMatchKey(post.media.file.name));
        if (!row) continue;
        matched++;
        if (row.caption !== undefined) {
          post.caption = row.caption;
          post.ownCaption = !!row.caption.trim();
        }
        if (row.day) post.day = row.day;
        if (row.time) post.time = row.time;
        if (row.day || row.time) post.ownTime = true;
        if (row.platforms) {
          post.platforms = row.platforms.filter((id) => takes(post, id));
          post.accounts = accountsForPlatforms(post.platforms, post.accounts);
        }
      }
    }),
  );
  track("bulk_csv_imported", { rows: rows.length, matched });
  if (matched) {
    toast.success(t("Matched {count} of {total} rows", { count: matched, total: rows.length }), {
      description: matched < rows.length ? t("Rows without a matching file were skipped.") : undefined,
    });
  } else {
    toast.error(t("No rows matched a file"), {
      description: t("The {file} column should hold the file names, like {example}.", { file: "file", example: "clip-01.mp4" }),
    });
  }
}

const MENU_ROW = "flex h-7 w-full items-center rounded-md px-2 text-left text-xs text-popover-foreground outline-none hover:bg-input focus-visible:bg-input disabled:pointer-events-none disabled:opacity-50";

function BatchMenu(props: { room: number; reading: boolean; onLibrary(files: File[]): void; onShuffle(): void; onClear(): void }) {
  const [open, setOpen] = createSignal(false);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <Popover open={open()} onOpenChange={setOpen} placement="bottom-end">
      <PopoverTrigger as={Button} variant="ghost" size="icon-square" aria-label={t("More")} class="text-muted-foreground">
        <Icon name="more-three-dots-small-horizontal" class="size-5" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="flex w-40 flex-col gap-0.5 rounded-xl p-1.5">
          <Show when={props.room > 0}>
            <MediaPicker class={MENU_ROW} kinds={["video", "image"]} max={props.room} onPick={props.onLibrary} onClose={() => setOpen(false)}>
              {t("From library")}
            </MediaPicker>
          </Show>
          <ImportCsv class={MENU_ROW} onClose={() => setOpen(false)} />
          <Show when={bulk.posts.length > 1}>
            <button type="button" class={MENU_ROW} onClick={() => choose(props.onShuffle)}>
              {t("Shuffle")}
            </button>
          </Show>
          <div class="my-1 h-px bg-border" />
          <button type="button" class={cx(MENU_ROW, "text-destructive")} disabled={props.reading} onClick={() => choose(props.onClear)}>
            {t("Clear all")}
          </button>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function ImportCsv(props: { class: string; onClose(): void }) {
  const [open, setOpen] = createSignal(false);
  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) props.onClose();
      }}
      placement="bottom-end"
    >
      <PopoverTrigger as="button" type="button" class={props.class}>
        {t("Import CSV")}
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="flex w-80 flex-col gap-2.5 rounded-xl p-3">
          <p class="text-xs leading-4 text-muted-foreground">
            {rich("A CSV with a {file} column, plus any of {caption}, {date}, {time} and {platforms}. Rows match files by name.", {
              file: <span class="text-foreground">file</span>,
              caption: "caption",
              date: "date",
              time: "time",
              platforms: "platforms",
            })}
          </p>
          <pre class="overflow-x-auto rounded-md bg-accent px-2 py-1.5 font-mono text-xxs leading-4 text-muted-foreground">
            {"file,caption,date,time\nclip-01.mp4,First one #fyp,2026-10-02,18:00"}
          </pre>
          <Button
            variant="secondary"
            class="w-full"
            onClick={() => {
              props.onClose();
              void importCsv();
            }}
          >
            {t("Choose a file")}
          </Button>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function BatchPanel(props: { target: BulkPost[]; problem?: Issue; class?: string }) {
  const [, setParams] = useSearchParams();
  const count = () => props.target.length;
  const targetIds = () => new Set(props.target.map((post) => post.id));

  // A network counts as picked when every post that can go there does.
  const offered = () => sortPlatforms(new Set(props.target.flatMap((post) => platformsFor(kindOf(post)))));
  const shared = () => offered().filter((id) => props.target.every((post) => !takes(post, id) || post.platforms.includes(id)));
  const skippedBy = () => shared().filter((id) => props.target.some((post) => !takes(post, id)));

  const sharedAccounts = (): AccountChoices => {
    const accounts: AccountChoices = {};
    for (const id of shared()) {
      const [first, ...rest] = props.target.filter((post) => post.platforms.includes(id));
      const choice = first?.accounts[id];
      if (choice && rest.every((post) => sameChoices({ [id]: post.accounts[id] ?? [] }, { [id]: choice }))) accounts[id] = [...choice];
    }
    return accounts;
  };

  const unconnected = () => shared().filter((id) => connectionsFor(id).length === 0);
  const allStories = () => props.target.length > 0 && props.target.every((post) => post.story);
  const postAs = () => (allStories() ? "story" : "post");

  const feedPosts = () => bulk.posts.filter((post) => !post.story);
  const feedPlatforms = () => sortPlatforms(new Set(feedPosts().flatMap((post) => post.platforms)));
  const feedKind = (): PostKind => (feedPosts().some((post) => post.media.kind === "video") ? "video" : "image");
  const mixed = () => new Set(feedPosts().map((post) => post.media.kind)).size > 1;

  const setPlatforms = (next: PlatformId[], accounts: AccountChoices) => {
    const before = new Set(shared());
    const added = next.filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !next.includes(id));
    const ids = targetIds();
    batch(() => {
      // Files added later still want a network these posts can't take.
      const kept = sortPlatforms(new Set([...next, ...bulk.platforms.filter((id) => !offered().includes(id))]));
      setBulk("platforms", kept);
      setBulk("accounts", reconcile(accountsForPlatforms(kept, accounts)));
      setBulk(
        "posts",
        (post) => ids.has(post.id),
        produce((post) => {
          post.platforms = sortPlatforms(new Set([...post.platforms.filter((id) => !removed.includes(id)), ...added.filter((id) => takes(post, id))]));
          post.accounts = accountsForPlatforms(post.platforms, { ...readChoices(post.accounts), ...accounts });
        }),
      );
      if (scheduleMode() === "best") replanTarget();
    });
  };

  createEffect(on(() => bulk.selected.join(), () => setSelectionCaption(""), { defer: true }));
  const sharedCaption = () => (bulk.selected.length ? selectionCaption() : bulk.template);
  const writeShared = (text: string) =>
    batch(() => {
      if (bulk.selected.length) {
        setSelectionCaption(text);
        const ids = targetIds();
        setBulk(
          "posts",
          produce((list) => {
            list.forEach((post, index) => {
              if (!ids.has(post.id)) return;
              post.caption = text.trim() ? fillTemplate(text, post, index, list.length) : "";
              post.ownCaption = !!text.trim();
            });
          }),
        );
      } else {
        setBulk("template", text);
      }
      refillCaptions();
    });

  const changeWhen = (change: () => void) =>
    batch(() => {
      change();
      replanTarget();
    });
  const setPostsADay = (count: number) =>
    changeWhen(() => {
      const times = bulk.times.slice(0, count);
      while (times.length < count) times.push(suggestTime(times));
      setBulk("times", times.sort());
    });
  const chooseMode = (mode: ScheduleMode) => {
    modeChosen = true;
    changeWhen(() => setScheduleMode(mode));
  };

  const openQueueSettings = useOpenQueueSettings();
  const planned = createMemo(() => {
    if (scheduleMode() === "spread") return 0;
    const moving = plannedPosts(bulk.posts, bulk.selected.length ? new Set(bulk.selected) : undefined);
    const staying = bulk.posts.filter((post) => !moving.includes(post)).map((post) => `${post.day} ${post.time}`);
    return planTimes(moving.length, staying, sortPlatforms(new Set(moving.flatMap((post) => post.platforms)))).length;
  });
  const movingCount = () => plannedPosts(bulk.posts, bulk.selected.length ? new Set(bulk.selected) : undefined).length;

  return (
    <aside class={cx(PANEL, props.class)}>
      <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-strong pr-2 pl-4">
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {bulk.selected.length
            ? t("{count, plural, one {Edit # selected post} other {Edit # selected posts}}", { count: count() })
            : t("{count, plural, one {Edit # post} other {Edit all # posts}}", { count: count() })}
        </span>
        <Button variant="ghost" size="icon-square" class="md:hidden" aria-label={t("Back to posts")} onClick={() => setBatchOpen(false)}>
          <Icon name="close-remove" class="size-5" />
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto pb-16">
        <PanelSection title={t("Post to")}>
          <PostTo value={shared()} accounts={sharedAccounts()} available={offered()} onChange={setPlatforms} />
          <Show when={skippedBy().length}>
            <p class="text-xs leading-4 text-muted-foreground">
              {t("{count, plural, one {{names} skips the files it can't take.} other {{names} skip the files they can't take.}}", { count: skippedBy().length, names: listNames(skippedBy()) })}
            </p>
          </Show>
          <Show when={unconnected().length}>
            <p class="text-xs leading-4 text-muted-foreground">
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
        </PanelSection>

        <PanelSection
          title={t("Post as")}
          action={<Segmented class="w-40" options={POST_AS} value={postAs()} onChange={(as) => setStory(targetIds(), as === "story")} label={t("Post as")} />}
        >
          <Show when={postAs() === "story"}>
            <p class="text-xs leading-4 text-muted-foreground">
              {t("Stories go to {platforms}, with no caption, and are gone after a day.", { platforms: listNames(STORY_PLATFORMS) })}
            </p>
          </Show>
        </PanelSection>

        <Show when={postAs() !== "story"}>
          <PanelSection
            title={t("Caption")}
            hint={bulk.selected.length ? t("For the selected posts") : t("For every empty post")}
            action={<VaultPicker placement="bottom-end" onPick={(item) => writeShared(insertVaultText(sharedCaption(), item))} />}
          >
            <textarea
              class={cx(fieldControlBase, "min-h-16 resize-y py-2 leading-relaxed")}
              placeholder={t("Write a caption…")}
              value={sharedCaption()}
              onInput={(event) => writeShared(event.currentTarget.value)}
              onKeyDown={fieldKeys}
            />
            <Show when={vaultSignature()}>
              {(signature) => (
                <SwitchRow
                  label={t("End with your signature")}
                  description={t("{name}, added to every post when it saves", { name: signature().title })}
                  checked={signed()}
                  onChange={setSigned}
                />
              )}
            </Show>
          </PanelSection>
        </Show>

        <PanelSection title={t("When")}>
          <Segmented options={SCHEDULE_MODES} value={scheduleMode()} onChange={chooseMode} label={t("How to schedule")} />
          <Show when={scheduleMode() === "queue"}>
            <Show
              when={queueSlots().length}
              fallback={
                <>
                  <p class="text-xs leading-4 text-muted-foreground">
                    {t("Set the days and times you post each week, and each post takes the next open one.")}
                  </p>
                  <Button variant="secondary" class="w-full" onClick={openQueueSettings}>
                    {t("Set up Auto-schedule")}
                  </Button>
                </>
              }
            >
              <div class="flex items-start gap-2">
                <p class="min-w-0 flex-1 text-xs leading-4 text-foreground">{describeQueue()}</p>
                <Button variant="link" size="small" class="h-4 shrink-0" onClick={openQueueSettings}>
                  {t("Edit")}
                </Button>
              </div>
              <Show when={planned() < movingCount()}>
                <p class="text-xs leading-4 text-muted-foreground">
                  {planned() ? t("{count} of {total} fit", { count: planned(), total: movingCount() }) : t("All your times in the next two months are taken.")}
                </p>
              </Show>
            </Show>
          </Show>
          <Show when={scheduleMode() === "best"}>
            <p class="text-xs leading-4 text-muted-foreground">
              {t("One a day, at the hour your audience is around most, from the heatmap on Analytics. Hours that already hold a post are skipped.")}
            </p>
            <Show when={planned() < movingCount()}>
              <p class="text-xs leading-4 text-muted-foreground">
                {planned() ? t("{count} of {total} fit", { count: planned(), total: movingCount() }) : t("There are no days left to schedule on.")}
              </p>
            </Show>
          </Show>
          <Show when={scheduleMode() === "spread"}>
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t("Starting")}</span>
              <DatePicker
                value={bulk.startDay}
                min={localDateKey(new Date())}
                max={localDateKey(latestSchedule())}
                onChange={(day) => changeWhen(() => setBulk("startDay", day))}
              />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <Field label={t("Posts a day")}>
                <input
                  class={cx(fieldControl, "tabular-nums")}
                  type="number"
                  min={1}
                  max={MOST_A_DAY}
                  value={bulk.times.length}
                  onInput={(event) => {
                    const value = Math.round(Number(event.currentTarget.value));
                    if (Number.isFinite(value) && value >= 1) setPostsADay(Math.min(value, MOST_A_DAY));
                  }}
                  onKeyDown={fieldKeys}
                />
              </Field>
              <Field label={t("Every")}>
                <span class="relative block">
                  <input
                    class={cx(fieldControl, "pr-12 tabular-nums")}
                    type="number"
                    min={1}
                    max={30}
                    value={bulk.every}
                    onInput={(event) => {
                      const value = Math.round(Number(event.currentTarget.value));
                      if (Number.isFinite(value) && value >= 1) changeWhen(() => setBulk("every", Math.min(value, 30)));
                    }}
                    onKeyDown={fieldKeys}
                  />
                  <span class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
                    {t("{count, plural, one {day} other {days}}", { count: bulk.every })}
                  </span>
                </span>
              </Field>
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t("At")}</span>
              <div class="grid grid-cols-3 gap-2">
                <Index each={bulk.times}>
                  {(time, index) => <TimePicker value={time()} onChange={(next) => changeWhen(() => setBulk("times", index, next))} />}
                </Index>
              </div>
            </div>
            <SwitchRow label={t("Skip weekends")} checked={bulk.skipWeekends} onChange={(skip) => changeWhen(() => setBulk("skipWeekends", skip))} />
          </Show>
        </PanelSection>

        <SettingsSection id={PLATFORM_SETTINGS_ID} kind={feedKind()} mixed={mixed()} platforms={feedPlatforms()} problem={props.problem} />
      </div>
    </aside>
  );
}

function PostPanel(props: { index: number; issues: Issue[]; problem?: Issue }) {
  const post = () => bulk.posts[props.index]!;
  const update = <K extends keyof BulkPost>(key: K, value: BulkPost[K]) => setBulk("posts", props.index, key, value);
  const kind = () => kindOf(post());

  const [chosen, setChosen] = createSignal<PlatformId>();
  const platform = () => {
    const current = chosen();
    return current && post().platforms.includes(current) ? current : (post().platforms[0] ?? platformsFor(kind())[0]!);
  };
  const account = () => accountsFor(platform(), post().accounts)[0]?.id;

  const go = (step: number) => {
    const next = bulk.posts[props.index + step];
    if (next) setEditing(next.id);
  };

  const [now, setNow] = createSignal(new Date());
  const clock = setInterval(() => setNow(new Date()), 30_000);
  onCleanup(() => clearInterval(clock));
  const at = () => atLocal(post().day, post().time);
  const setWhen = (day: string, time: string) =>
    batch(() => {
      update("day", day);
      update("time", time);
      update("ownTime", true);
    });
  const choose = (when: Date) => setWhen(localDateKey(when), timeOf(when));
  const repeats = () => {
    const cadence = cadencePhrase(post().repeat, post().day);
    if (!cadence) return null;
    const end = resolveRepeatEnd(post().repeatEnd, post().repeat, post().day);
    return end ? t("{cadence} until {date}", { cadence, date: formatCalendarDay(end) }) : cadence;
  };
  const timeProblem = () => scheduleProblem(at());

  return (
    <aside class={PANEL}>
      <div class="flex h-11 shrink-0 items-center gap-1 border-b border-border-strong pr-2 pl-4">
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={post().media.file.name}>
          {post().media.file.name}
        </span>
        <span class="shrink-0 px-1 text-xs tabular-nums text-muted-foreground">
          {t("{position} of {total}", { position: props.index + 1, total: bulk.posts.length })}
        </span>
        <Button variant="ghost" size="icon-square" aria-label={t("Previous post")} disabled={props.index === 0} onClick={() => go(-1)}>
          <Icon name="chevron-left" class="size-5" />
        </Button>
        <Button variant="ghost" size="icon-square" aria-label={t("Next post")} disabled={props.index >= bulk.posts.length - 1} onClick={() => go(1)}>
          <Icon name="chevron-right" class="size-5" />
        </Button>
        <Button variant="ghost" size="icon-square" aria-label={t("Back to changes for many")} onClick={() => setEditing(null)}>
          <Icon name="close-remove" class="size-5" />
        </Button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto pb-16">
        <PanelSection title={t("Preview")} hint={socialPlatform(platform()).name}>
          <Show when={post().platforms.length > 1}>
            <div class="grid auto-cols-fr grid-flow-col gap-0.5 rounded-md bg-accent/30 p-0.5" role="tablist" aria-label={t("Preview platform")}>
              <For each={post().platforms}>
                {(id) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={platform() === id}
                    aria-label={socialPlatform(id).name}
                    class="group grid h-7 min-w-0 place-items-center rounded-md press focus-ring"
                    classList={{ "bg-secondary shadow-sm": platform() === id, "hover:bg-accent": platform() !== id }}
                    onClick={() => setChosen(id)}
                  >
                    <PlatformLogo id={id} class="size-4.5" />
                  </button>
                )}
              </For>
            </div>
          </Show>
          <div class="px-1.5">
            <PostPreview
              platform={platform()}
              account={account()}
              media={[post().media]}
              story={post().story}
              caption={finalCaption(post(), platform())}
              title={titleFor(post(), props.index)}
            />
          </div>
          <Show
            when={props.issues.length}
            fallback={
              <p class="flex items-center gap-1 text-xs text-muted-foreground">
                <Icon name="confirm-check" class="-my-1 size-4 text-primary" />
                {t("Ready for {platforms}", { platforms: listNames(post().platforms) })}
              </p>
            }
          >
            <div class="rounded-xl border border-border-strong bg-accent/30 px-2.5 py-2 text-xs leading-4 text-muted-foreground">
              <IssueList issues={props.issues} />
            </div>
          </Show>
        </PanelSection>

        <PanelSection title={t("Post to")}>
          <PostTo
            value={post().platforms}
            accounts={post().accounts}
            available={platformsFor(kind())}
            onChange={(ids, accounts) => batch(() => {
              update("platforms", ids);
              setBulk("posts", props.index, "accounts", reconcile(accounts));
            })}
          />
        </PanelSection>

        <PanelSection
          title={t("Post as")}
          action={
            <Segmented
              class="w-40"
              options={POST_AS}
              value={post().story ? "story" : "post"}
              onChange={(as) => setStory(new Set([post().id]), as === "story")}
              label={t("Post as")}
            />
          }
        />

        <Show when={takesTitle(post())}>
          <PanelSection title={t("Title")} action={<CharCount count={captionLength(post().title)} limit={100} />}>
            <input
              class={fieldControl}
              placeholder={baseName(post().media.file)}
              value={post().title}
              onInput={(event) => update("title", event.currentTarget.value)}
              onKeyDown={fieldKeys}
            />
          </PanelSection>
        </Show>

        <Show when={!post().story}>
          <CaptionFields index={props.index} />
        </Show>

        <PanelSection title={t("When")}>
          <div class="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t("Date")}</span>
              <DatePicker value={post().day} min={localDateKey(now())} max={localDateKey(latestSchedule())} onChange={(day) => setWhen(day, post().time)} />
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t("Time")}</span>
              <TimePicker value={post().time} min={earliestTimeOn(post().day)} zone={timeZoneName()} onChange={(time) => setWhen(post().day, time)} />
            </div>
          </div>
          <Show when={timeProblem()} fallback={
            <Show when={at()}>
              {(when) => (
                <p class="text-xs text-muted-foreground">
                  {repeats()
                    ? rich("Goes out <b>{when}</b>, {until}, then <b>{cadence}</b>", {
                        b: (text) => <span class="text-foreground">{text}</span>,
                        when: formatWhen(when()),
                        until: untilLabel(when().getTime() - now().getTime()),
                        cadence: repeats(),
                      })
                    : rich("Goes out <b>{when}</b>, {until}", {
                        b: (text) => <span class="text-foreground">{text}</span>,
                        when: formatWhen(when()),
                        until: untilLabel(when().getTime() - now().getTime()),
                      })}
                </p>
              )}
            </Show>
          }>
            {(problem) => <p class="text-xs text-destructive">{t(problem())}</p>}
          </Show>
          <WhenOptions platforms={post().platforms} picked={at()} now={now()} onChoose={choose} />
          <div class="flex flex-col gap-1">
            <span class="text-xs text-muted-foreground">{t("Repeat")}</span>
            <RepeatField value={post().repeat} day={post().day} onChange={(repeat) => update("repeat", repeat)} />
          </div>
          <Show when={post().repeat}>
            <div class="flex flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t("Ends")}</span>
              <RepeatEndField value={post().repeatEnd} repeat={post().repeat} day={post().day} onChange={(end) => update("repeatEnd", end)} />
              <p class="pt-0.5 text-xs leading-4 text-muted-foreground">
                {t("Every run shows on the calendar. Skip one there, or pause or end the whole series.")}
              </p>
            </div>
          </Show>
        </PanelSection>

        <SettingsSection kind={kind()} platforms={post().platforms} problem={props.problem} />
      </div>
    </aside>
  );
}

function CaptionFields(props: { index: number }) {
  const [, setParams] = useSearchParams();
  const post = () => bulk.posts[props.index]!;
  const [tab, setTab] = createSignal<PlatformId | "all">("all");
  const active = () => {
    const current = tab();
    return current !== "all" && post().platforms.includes(current) ? current : "all";
  };
  const value = () => {
    const id = active();
    return id === "all" ? post().caption : captionFor(post(), id);
  };
  const write = (text: string) => {
    const id = active();
    if (id === "all") {
      batch(() => {
        setBulk("posts", props.index, "caption", text);
        setBulk("posts", props.index, "ownCaption", !!text.trim());
        if (!text.trim()) refillCaptions();
      });
    } else {
      setBulk("posts", props.index, "overrides", id, text);
    }
  };
  const resetOverride = (id: PlatformId) =>
    setBulk(
      "posts",
      props.index,
      "overrides",
      produce((overrides) => {
        delete overrides[id];
      }),
    );

  const limit = () => {
    const id = active();
    if (id !== "all") return { limit: socialPlatform(id).captionLimit, name: socialPlatform(id).name };
    const sharing = post().platforms.filter((platform) => post().overrides[platform] === undefined);
    const tightest = sharing.map(socialPlatform).sort((a, b) => a.captionLimit - b.captionLimit)[0];
    return tightest ? { limit: tightest.captionLimit, name: tightest.name } : null;
  };
  const withSignature = () => signedCaption(value());

  const saveToVault = () => {
    const made = createVaultItem({ kind: "caption", title: "", body: value() });
    if ("error" in made) toast.error(t("Could not save to the vault"), { description: t(made.error) });
    else toast.success(t("Saved to the vault"));
  };

  return (
    <PanelSection
      title={t("Caption")}
      hint={active() === "all" ? undefined : t("Only for {platform}", { platform: socialPlatform(active() as PlatformId).name })}
      action={
        <div class="flex items-center gap-0.5">
          <Show when={value().trim()}>
            <button
              type="button"
              class="cap-trim h-6 rounded-md px-1.5 text-xs text-muted-foreground press hover:bg-accent hover:text-foreground focus-ring"
              onClick={saveToVault}
            >
              {t("Save to vault")}
            </button>
          </Show>
          <VaultPicker placement="bottom-end" onPick={(item) => write(insertVaultText(value(), item))} />
        </div>
      }
    >
      <Show when={post().platforms.length > 1}>
        <div class="flex flex-wrap items-center gap-1" role="tablist" aria-label={t("Caption for")}>
          <CaptionTab selected={active() === "all"} onClick={() => setTab("all")}>
            {t("All")}
          </CaptionTab>
          <For each={post().platforms}>
            {(id) => (
              <CaptionTab selected={active() === id} label={socialPlatform(id).name} onClick={() => setTab(id)}>
                <PlatformLogo id={id} class="size-4" />
                <Show when={post().overrides[id] !== undefined}>
                  <span class="size-1.5 rounded-full bg-primary" title={t("Has its own caption")} />
                </Show>
              </CaptionTab>
            )}
          </For>
        </div>
      </Show>

      <div class="flex flex-col overflow-hidden rounded-xl border border-(--border-input) bg-input transition-colors focus-within:border-primary">
        <textarea
          class="min-h-28 w-full resize-y bg-transparent px-3 py-2.5 text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={active() === "all" ? t("Write a caption. Add #hashtags and @mentions.") : t("Write a caption just for this platform.")}
          value={value()}
          onInput={(event) => write(event.currentTarget.value)}
          onKeyDown={fieldKeys}
        />
        <Show when={vaultSignature()}>
          {(signature) => (
            <div class="flex items-center gap-2 border-t border-border-strong px-3 py-1.5">
              <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {signed() ? t("Ends with your signature") : t("Signature left off")} · {signature().title}
              </span>
              <Button variant="ghost" size="small" class="shrink-0 text-muted-foreground" onClick={() => setSigned(!signed())}>
                {signed() ? t("Leave off") : t("Add it back")}
              </Button>
            </div>
          )}
        </Show>
        <div class="flex h-8 items-center gap-3 border-t border-border-strong px-3 text-xs">
          <Show
            when={active() !== "all" && post().overrides[active() as PlatformId] !== undefined}
            fallback={<span class="text-muted-foreground">{t("{count, plural, one {# hashtag} other {# hashtags}}", { count: hashtagCount(withSignature()) })}</span>}
          >
            <button
              type="button"
              class="rounded-md text-muted-foreground transition-colors hover:text-foreground focus-ring"
              onClick={() => resetOverride(active() as PlatformId)}
            >
              {t("Use the shared caption")}
            </button>
          </Show>
          <Show when={!vaultSignature()}>
            <button
              type="button"
              class="rounded-md text-muted-foreground transition-colors hover:text-foreground focus-ring"
              title={t("Pick a vault item to end every caption with")}
              onClick={() => setParams({ dashboard: "vault" })}
            >
              {t("Add a signature")}
            </button>
          </Show>
          <span class="flex-1" />
          <Show when={limit()}>
            {(current) => (
              <span class="flex items-center gap-1.5">
                <Show when={active() === "all" && post().platforms.length > 1}>
                  <span class="text-muted-foreground">{current().name}</span>
                </Show>
                <CharCount count={captionLength(withSignature())} limit={current().limit} />
              </span>
            )}
          </Show>
        </div>
      </div>
    </PanelSection>
  );
}

function CaptionTab(props: { selected: boolean; label?: string; onClick(): void; children: JSX.Element }) {
  const label = capCentered(() => props.children);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.selected}
      aria-label={props.label}
      title={props.label}
      class="flex h-6 items-center gap-1.5 rounded-md px-2 text-xs press focus-ring"
      classList={{
        "bg-secondary text-foreground": props.selected,
        "text-muted-foreground hover:bg-accent hover:text-foreground": !props.selected,
      }}
      onClick={() => props.onClick()}
    >
      {label()}
    </button>
  );
}

function SettingsSection(props: { id?: string; kind: PostKind; mixed?: boolean; platforms: readonly PlatformId[]; problem?: Issue }) {
  const [open, setOpen] = createSignal(false);
  // Stays out after its problem is fixed, so the rest of that card can still be set.
  const [kept, setKept] = createSignal<PlatformId>();
  createEffect(() => {
    if (props.problem?.platform) setKept(props.problem.platform);
  });
  const only = () => (open() ? undefined : kept());
  const toggle = () =>
    batch(() => {
      if (open() && !props.problem) setKept(undefined);
      setOpen(!open());
    });

  return (
    <Show when={platformsWithSettings(props.kind, props.platforms).length}>
      <PanelSection id={props.id} title={t("Platform settings")} hint={t("Shared by every post")} open={open()} onToggle={toggle}>
        <Show when={open() || (kept() && props.platforms.includes(kept()!))}>
          <PlatformSettingsFields
            kind={props.kind}
            mixed={props.mixed}
            platforms={props.platforms}
            only={only()}
            noTitles
            settings={settings}
            onChange={setSettings}
            tiktokAccount={bulkTikTokAccount}
          />
        </Show>
      </PanelSection>
    </Show>
  );
}

function PanelSection(props: { id?: string; title: string; hint?: string; action?: JSX.Element; open?: boolean; onToggle?(): void; children?: JSX.Element }) {
  return (
    <section id={props.id} class="flex flex-col gap-2.5 border-b border-border-strong px-4 py-4 last:border-b-0">
      <Show
        when={props.onToggle}
        fallback={
          <div class="flex min-h-6 items-center gap-2">
            <h2 class="shrink-0 text-sm font-medium text-foreground">{props.title}</h2>
            <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{props.hint}</span>
            {props.action}
          </div>
        }
      >
        <button type="button" aria-expanded={props.open} class="flex min-h-6 w-full items-center gap-2 rounded-md text-left focus-ring" onClick={() => props.onToggle?.()}>
          <h2 class="shrink-0 text-sm font-medium text-foreground">{props.title}</h2>
          <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{props.hint}</span>
          <Icon name="chevron-down" class={cx("size-5 shrink-0 text-muted-foreground transition-transform", props.open && "rotate-180")} />
        </button>
      </Show>
      {props.children}
    </section>
  );
}
