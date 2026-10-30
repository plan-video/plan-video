/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { For, Match, Show, Switch, batch, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { toast } from "somoto";

import { Button, buttonVariants } from "@/components/ui/button";
import { capCentered } from "@/components/ui/cap-label";
import { Checkbox, CheckboxControl, CheckboxInput } from "@/components/ui/checkbox";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { DashboardPageHeader } from "@/components/dashboard/page-header";
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
import { setPostThumbnail } from "@/components/calendar/store";
import { thumbnailFromFile } from "@/lib/post-thumbnail";
import { cadencePhrase, formatDay as formatCalendarDay, localDateKey, newId, resolveRepeatEnd, shiftDay } from "@/components/calendar/utils";
import { useAuth } from "@/context/auth";
import { askForAccount } from "@/lib/guest";
import { droppedFiles, pickFiles } from "@/engine/asset-actions";
import { track } from "@/lib/analytics";
import { cx } from "@/lib/cva";
import { msg, rich, t } from "@/lib/i18n";
import { keepInLibrary } from "@/lib/media-library";
import { rememberPinterestBoard } from "@/lib/pinterest-boards";
import {
  PUBLISHING_PLATFORMS,
  captionLength,
  checkPost,
  defaultPlatformSettings,
  instagramPostSettings,
  tiktokPostSettings,
  xPostSettings,
  youtubePostSettings,
  formatDuration,
  hashtagCount,
  listNames,
  platformTitle,
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
import { zonedParts } from "@/lib/time-zone";
import {
  POSTABLE_FILES,
  baseName,
  fileKey,
  formatBytes,
  imageFileProblem,
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

type Spacing = "hours" | "days";
type CaptionMode = "replace" | "append";
type ScheduleMode = "spread" | "queue" | "best";

type BulkPost = {
  id: string;
  media: PostMedia;
  caption: string;
  overrides: Partial<Record<PlatformId, string>>;
  story: boolean;
  platforms: PlatformId[];
  accounts: AccountChoices;
  day: string;
  time: string;
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
  mode: CaptionMode;
  startDay: string;
  startTime: string;
  every: number;
  unit: Spacing;
  skipWeekends: boolean;
};

function freshBulk(): Bulk {
  return {
    posts: [],
    selected: [],
    platforms: DEFAULT_PLATFORMS,
    accounts: {},
    template: "",
    mode: "replace",
    startDay: shiftDay(localDateKey(new Date()), 1),
    startTime: "09:00",
    every: 1,
    unit: "days",
    skipWeekends: false,
  };
}

const [bulk, setBulk] = createStore<Bulk>(freshBulk());
const [settings, setSettings] = createStore<PlatformSettings>(defaultPlatformSettings());
const [scheduleMode, setScheduleMode] = createSignal<ScheduleMode>("spread");
const [signed, setSigned] = createSignal(true);
const [editing, setEditing] = createSignal<string | null>(null);

const signedCaption = (caption: string) => appendSignature(caption, signed() ? vaultSignature()?.body : undefined);
const kindOf = (post: BulkPost): PostKind => (post.story ? "story" : post.media.kind);
const captionFor = (post: BulkPost, id: PlatformId) => post.overrides[id] ?? post.caption;
const finalCaption = (post: BulkPost, id: PlatformId) => (post.story ? "" : signedCaption(captionFor(post, id)));
const titleFor = (post: BulkPost, index: number, id: PlatformId) =>
  fillTemplate(platformTitle(settings, id), post, index, bulk.posts.length).trim() || baseName(post.media.file).slice(0, 100);
const isLive = (id: PlatformId) => PUBLISHING_PLATFORMS.includes(id);
const sendable = (post: BulkPost) => !post.story && post.platforms.some(isLive);
const livePlatforms = (posts: readonly BulkPost[]) => sortPlatforms(new Set(posts.filter(sendable).flatMap((post) => post.platforms.filter(isLive))));
const ownCaptions = (post: BulkPost) =>
  Object.fromEntries(post.platforms.filter((id) => id !== "youtube").map((id) => [id, finalCaption(post, id)]));

type Issue = { level: "error" | "warning"; message: string; platform?: PlatformId };

function postIssues(post: BulkPost, index: number): Issue[] {
  const issues: Issue[] = [];
  if (!post.platforms.length) issues.push({ level: "error", message: msg("Pick at least one platform.") });
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
      title: (id) => titleFor(post, index, id),
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

const isWeekend = (date: Date) => {
  const weekday = zonedParts(date).weekday;
  return weekday === 0 || weekday === 6;
};

const daysLater = (date: Date, days: number, time = timeOf(date)) => atLocal(shiftDay(localDateKey(date), days), time) ?? date;

function spread(count: number, start: Date, every: number, unit: Spacing, skipWeekends: boolean): Date[] {
  const times: Date[] = [];
  let at = new Date(start);
  for (let i = 0; i < count; i++) {
    while (skipWeekends && isWeekend(at)) at = daysLater(at, 1, unit === "hours" ? timeOf(start) : timeOf(at));
    times.push(at);
    at = unit === "days" ? daysLater(at, every) : new Date(at.getTime() + every * 60 * 60 * 1000);
  }
  return times;
}

function fillTemplate(template: string, post: BulkPost, index: number, count: number): string {
  const at = atLocal(post.day, post.time);
  return template
    .replaceAll("{name}", baseName(post.media.file))
    .replaceAll("{n}", String(index + 1))
    .replaceAll("{count}", String(count))
    .replaceAll("{date}", at ? formatDay(at) : "");
}

function setStory(ids: ReadonlySet<string>, story: boolean) {
  setBulk(
    "posts",
    (post) => ids.has(post.id),
    produce((post) => {
      post.story = story;
      if (!story) return;
      const fitting = post.platforms.filter((id) => STORY_PLATFORMS.includes(id));
      post.platforms = fitting.length ? fitting : STORY_PLATFORMS.filter((id) => connectionsFor(id).length > 0);
      post.accounts = accountsForPlatforms(post.platforms, post.accounts);
    }),
  );
}

const TOKENS = [
  { token: "{name}", label: msg("Insert file name") },
  { token: "{n}", label: msg("Insert number") },
  { token: "{date}", label: msg("Insert date") },
] as const;

const SCHEDULE_MODES: { id: ScheduleMode; label: string }[] = [
  { id: "spread", label: msg("Spread out") },
  { id: "queue", label: msg("Queue") },
  { id: "best", label: msg("Best times") },
];

const SPACING_OPTIONS: { id: Spacing; label: string }[] = [
  { id: "hours", label: msg("Hours") },
  { id: "days", label: msg("Days") },
];

const CAPTION_MODES: { id: CaptionMode; label: string }[] = [
  { id: "replace", label: msg("Replace") },
  { id: "append", label: msg("Add to end") },
];

const POST_AS: { id: "post" | "story"; label: string }[] = [
  { id: "post", label: msg("Posts") },
  { id: "story", label: msg("Stories") },
];

export function DashboardBulkToolsView() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  createEffect(() => loadVault(auth.user()?.id));
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
  const target = () => (bulk.selected.length ? bulk.posts.filter((post) => bulk.selected.includes(post.id)) : bulk.posts);
  const editingIndex = () => bulk.posts.findIndex((post) => post.id === editing());
  const room = () => MAX_POSTS - bulk.posts.length;

  const addFiles = async (dropped: File[]) => {
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

    setReading({ done: 0, total: queue.length });
    let failed = 0;
    try {
      for (const file of queue) {
        try {
          const media = await readMedia(file);
          void keepInLibrary([media]);
          const last = bulk.posts.at(-1);
          const lastAt = last ? atLocal(last.day, last.time) : null;
          const at = lastAt
            ? spread(2, lastAt, bulk.every, bulk.unit, bulk.skipWeekends)[1]!
            : (atLocal(bulk.startDay, bulk.startTime) ?? nextSlot());
          setBulk("posts", bulk.posts.length, {
            id: newId(),
            media,
            caption: "",
            overrides: {},
            story: false,
            platforms: [...bulk.platforms],
            accounts: accountsForPlatforms(bulk.platforms, bulk.accounts),
            day: localDateKey(at),
            time: timeOf(at),
            repeat: "",
            repeatEnd: "",
          });
        } catch {
          failed++;
        }
        setReading((current) => current && { ...current, done: current.done + 1 });
      }
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
    });
  };

  const clearAll = () => {
    for (const post of bulk.posts) releaseMedia(post.media);
    batch(() => {
      setBulk("posts", []);
      setBulk("selected", []);
      setSettings(reconcile(defaultPlatformSettings()));
      setEditing(null);
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
        title: postTitle(post.story ? "" : post.caption, post.story ? t("Story · {name}", { name: baseName(post.media.file) }) : titleFor(post, index, "youtube")),
        caption: post.story ? "" : signedCaption(post.caption),
        platforms: post.platforms,
        accounts: accountsForPlatforms(post.platforms, post.accounts),
        link: !post.story && post.platforms.includes("pinterest") ? settings.pinterest.link : undefined,
        tiktok: !post.story && post.platforms.includes("tiktok") ? tiktokPostSettings(settings) : undefined,
        youtube:
          !post.story && post.platforms.includes("youtube")
            ? youtubePostSettings(settings, finalCaption(post, "youtube"), {
                title: titleFor(post, index, "youtube"),
                short: youtubeFormat(summarizeMedia([post.media])) === "short",
              })
            : undefined,
        instagram: !post.story && post.platforms.includes("instagram") ? instagramPostSettings(settings) : undefined,
        x: !post.story && post.platforms.includes("x") ? xPostSettings(settings) : undefined,
        pinterest:
          !post.story && post.platforms.includes("pinterest") ? { title: titleFor(post, index, "pinterest"), board: settings.pinterest.board.trim() } : undefined,
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

  const save = async (status: "draft" | "scheduled", guestReason: "schedule" | "post" = "schedule") => {
    if (saving() || !bulk.posts.length) return;
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
    if (saving() || blocked().length) return;
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
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const fromLibrary = (class_: string) => (
    <MediaPicker class={class_} kinds={["video", "image"]} max={Math.max(1, room())} onPick={(files) => void addFiles(files)}>
      <Icon name="all-media-types" class="-ml-1.5 size-5" />
      {t("From library")}
    </MediaPicker>
  );

  return (
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <main class="flex min-w-0 flex-1 flex-col">
        <DashboardPageHeader>
          <Show when={reading()}>
            {(progress) => (
              <span class="flex items-center gap-1 text-xs text-muted-foreground">
                <Icon name="spinner-loader" class="size-5 animate-spin" />
                {t("Reading {count} of {total}", { count: progress().done + 1, total: progress().total })}
              </span>
            )}
          </Show>
          <Switch>
            <Match when={bulk.selected.length}>
              <span class="px-1 text-xs text-muted-foreground">{t("{count, plural, one {# selected} other {# selected}}", { count: bulk.selected.length })}</span>
              <Button variant="ghost" onClick={() => setBulk("selected", [])}>
                {t("Deselect")}
              </Button>
              <Button variant="secondary" class="gap-1 pl-1" onClick={() => remove(bulk.selected)}>
                <Icon name="trash" class="size-5" />
                {t("Remove")}
              </Button>
            </Match>
            <Match when={bulk.posts.length}>
              <Button variant="ghost" class="text-muted-foreground" onClick={clearAll}>
                {t("Clear all")}
              </Button>
              <Show when={room() > 0}>{fromLibrary(cx(buttonVariants({ variant: "secondary" }), "gap-1 pl-2.5"))}</Show>
              <Button variant="secondary" class="gap-1 pl-1" disabled={room() <= 0} onClick={() => void pick()}>
                <Icon name="plus-add" class="size-5" />
                {t("Add files")}
              </Button>
            </Match>
          </Switch>
          <Show when={bulk.posts.length && !bulk.selected.length}>
            <span class="order-first px-1 text-xs tabular-nums text-muted-foreground">{t("{count} of {max}", { count: bulk.posts.length, max: MAX_POSTS })}</span>
          </Show>
        </DashboardPageHeader>

        <Show
          when={bulk.posts.length}
          fallback={
            <EmptyState dragging={dragging()} reading={!!reading()} onPick={() => void pick()} handlers={handlers} actions={fromLibrary(dropZoneAction)} />
          }
        >
          <div class="relative min-h-0 flex-1 overflow-auto" {...handlers}>
            <PostTable issues={issues()} onRemove={(id) => remove([id])} />

            <Show when={dragging()}>
              <div class="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border border-dashed border-primary bg-primary/5">
                <span class="rounded-md bg-background px-3 py-1.5 text-xs text-foreground shadow-md">{t("Drop to add posts")}</span>
              </div>
            </Show>
          </div>

          <footer class="flex shrink-0 items-center gap-6 border-t border-border-strong px-6 py-3">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <div class="flex min-h-6 min-w-0 items-center gap-1.5 text-xs">
                <Show
                  when={blocked().length}
                  fallback={
                    <>
                      <Icon name="circle-check" class="-my-1 size-5 shrink-0 text-primary" />
                      <span class="truncate text-muted-foreground">
                        {t("{count, plural, one {# post ready} other {# posts ready}}", { count: bulk.posts.length })}
                        <ScheduleRange posts={bulk.posts} />
                      </span>
                    </>
                  }
                >
                  <Icon name="alert-warning" class="-my-1 size-5 shrink-0 text-destructive" />
                  <span class="truncate text-foreground">
                    {t("{count, plural, one {# post needs a fix} other {# posts need a fix}}", { count: blocked().length })}
                  </span>
                  <Button variant="link" size="small" class="ml-1" onClick={() => setBulk("selected", blocked().map((post) => post.id))}>
                    {t("{count, plural, one {Select it} other {Select them}}", { count: blocked().length })}
                  </Button>
                  <Show when={blocked().length === 1}>
                    <Button variant="link" size="small" onClick={() => setEditing(blocked()[0]!.id)}>
                      {t("Open it")}
                    </Button>
                  </Show>
                </Show>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button variant="secondary" disabled={!!saving()} onClick={() => void save("draft")}>
                {t("Save as drafts")}
              </Button>
              <Show when={bulk.posts.some(sendable)}>
                <Tooltip>
                  <TooltipTrigger as={Button} variant="secondary" class="gap-1.5" disabled={!!saving() || blocked().length > 0} onClick={() => void postNow()}>
                    <Show
                      when={saving() === "now"}
                      fallback={<PlatformLogo id={livePlatforms(bulk.posts)[0]!} class="size-4" />}
                    >
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
                <TooltipTrigger as={Button} class="gap-1.5 px-3" disabled={!!saving() || blocked().length > 0} onClick={() => void save("scheduled")}>
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
        <Show when={editingIndex() >= 0} fallback={<BatchPanel target={target()} />}>
          <PostPanel index={editingIndex()} issues={issues().get(bulk.posts[editingIndex()]!.id) ?? []} />
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

function EmptyState(props: {
  dragging: boolean;
  reading: boolean;
  onPick(): void;
  handlers: ReturnType<typeof createDropHandlers>;
  actions: JSX.Element;
}) {
  const features = [
    { icon: "text", title: msg("Caption them together"), text: msg("One template, with each file's name or number filled in.") },
    { icon: "calendar", title: msg("Space them out"), text: msg("Every few hours or days, in your queue, or at your audience's best times.") },
    { icon: "download", title: msg("Bring a spreadsheet"), text: msg("Captions and times from a CSV, matched to files by name.") },
  ];

  return (
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
        <DropZone
          icon="layers"
          title={props.reading ? t("Reading…") : t("Drop a batch of videos or pictures")}
          hint={t("Each file becomes its own post or story: an MP4 or MOV up to 5 minutes, or a JPG or PNG. Up to {count} at a time.", { count: MAX_POSTS })}
          pickLabel={t("Choose files")}
          dragging={props.dragging}
          onPick={() => props.onPick()}
          actions={props.actions}
          handlers={props.handlers}
          class="py-16"
        />
        <div class="grid grid-cols-3 gap-4">
          <For each={features}>
            {(feature) => (
              <div class="flex flex-col gap-1.5">
                <Icon name={feature.icon} class="-ml-1 size-6 text-muted-foreground" />
                <span class="text-xs font-medium text-foreground">{t(feature.title)}</span>
                <span class="text-xs leading-4 text-muted-foreground">{t(feature.text)}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

const ROW_GRID = "grid grid-cols-[1rem_minmax(10rem,1fr)_minmax(12rem,1.6fr)_6.5rem_10.5rem_1.25rem_1.75rem] items-center gap-3 px-6";

function PostTable(props: { issues: Map<string, Issue[]>; onRemove(id: string): void }) {
  const allSelected = () => bulk.posts.length > 0 && bulk.selected.length === bulk.posts.length;
  const toggleAll = () => setBulk("selected", allSelected() ? [] : bulk.posts.map((post) => post.id));

  return (
    <div class="min-w-[52rem]">
      <div class={`${ROW_GRID} sticky top-0 z-10 h-9 border-b border-border-strong bg-background text-xs text-muted-foreground`}>
        <Checkbox
          checked={allSelected()}
          indeterminate={bulk.selected.length > 0 && !allSelected()}
          onChange={toggleAll}
          class="flex items-center"
        >
          <CheckboxInput aria-label={t("Select all")} />
          <CheckboxControl />
        </Checkbox>
        <span>{t({ message: "Post", context: "noun" })}</span>
        <span>{t("Caption")}</span>
        <span>{t("Platforms")}</span>
        <span>{t("When · {zone}", { zone: timeZoneName() })}</span>
        <span class="sr-only">{t("Checks")}</span>
        <span class="sr-only">{t("Remove")}</span>
      </div>
      <For each={bulk.posts}>
        {(post, index) => <PostRow post={post} index={index()} issues={props.issues.get(post.id) ?? []} onRemove={() => props.onRemove(post.id)} />}
      </For>
    </div>
  );
}

function PostRow(props: { post: BulkPost; index: number; issues: Issue[]; onRemove(): void }) {
  const selected = () => bulk.selected.includes(props.post.id);
  const open = () => editing() === props.post.id;
  const toggle = () =>
    setBulk("selected", (ids) => (ids.includes(props.post.id) ? ids.filter((id) => id !== props.post.id) : [...ids, props.post.id]));
  const update = <K extends keyof BulkPost>(key: K, value: BulkPost[K]) => setBulk("posts", props.index, key, value);

  const errors = () => props.issues.filter((issue) => issue.level === "error");
  const media = () => props.post.media;
  const ownCaptions = () => Object.keys(props.post.overrides).length;

  return (
    <div
      class={cx(ROW_GRID, "group border-b border-border-strong/60 py-2 transition-colors")}
      classList={{ "bg-accent/50": open(), "bg-primary/5": selected() && !open(), "hover:bg-accent": !selected() && !open() }}
    >
      <Checkbox checked={selected()} onChange={toggle} class="flex items-center">
        <CheckboxInput aria-label={t("Select {name}", { name: media().file.name })} />
        <CheckboxControl />
      </Checkbox>

      <button
        type="button"
        class="flex min-w-0 items-center gap-2.5 rounded-md text-left focus-ring"
        title={t("Open this post")}
        onClick={() => setEditing(open() ? null : props.post.id)}
      >
        <div class="relative h-12 w-9 shrink-0 overflow-hidden rounded-md bg-black">
          <img src={media().kind === "video" ? media().poster : media().url} alt="" class="size-full object-cover" draggable={false} />
          <Show when={media().kind === "video"}>
            <span class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent pt-2 pb-0.5 text-center text-xs font-medium text-white tabular-nums">
              {formatDuration(media().duration)}
            </span>
          </Show>
        </div>
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="truncate text-xs text-foreground group-hover:underline group-hover:underline-offset-2" title={media().file.name}>
            {media().file.name}
          </span>
          <span class="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
            <Show when={props.post.story}>
              <span class="shrink-0 rounded-md bg-primary/15 px-1 leading-4 text-primary">{t("Story")}</span>
            </Show>
            <span class="truncate">
              {media().kind === "video" ? t("Video") : t("Picture")} · {media().width}×{media().height} · {formatBytes(media().file.size)}
            </span>
            <Show when={props.post.repeat}>
              <Icon name="loop" class="-my-1 size-4 shrink-0" />
            </Show>
          </span>
        </div>
      </button>

      <Show
        when={!props.post.story}
        fallback={<span class="text-xs text-muted-foreground">{t("Stories go out without a caption.")}</span>}
      >
        <div class="relative">
          <textarea
            aria-label={t("Caption for {name}", { name: media().file.name })}
            class={cx(fieldControlBase, "h-12 resize-none py-1.5 leading-4")}
            placeholder={t("Write a caption…")}
            value={props.post.caption}
            onInput={(event) => update("caption", event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <Show when={ownCaptions()}>
            <span class="pointer-events-none absolute right-1.5 bottom-1 rounded-md bg-background/80 px-1 text-xxs leading-4 text-muted-foreground">
              {t("{count, plural, one {+# own} other {+# own}}", { count: ownCaptions() })}
            </span>
          </Show>
        </div>
      </Show>

      <RowPlatforms
        story={props.post.story}
        value={props.post.platforms}
        accounts={props.post.accounts}
        onChange={(ids, accounts) => batch(() => {
          update("platforms", ids);
          setBulk("posts", props.index, "accounts", reconcile(accounts));
        })}
      />

      <DateTimePicker
        label={t("When {name} goes out", { name: media().file.name })}
        day={props.post.day}
        time={props.post.time}
        minDay={localDateKey(new Date())}
        maxDay={localDateKey(latestSchedule())}
        minTime={earliestTimeOn}
        onChange={(day, time) =>
          batch(() => {
            update("day", day);
            update("time", time);
          })
        }
      />

      <Tooltip>
        <TooltipTrigger
          as="span"
          tabIndex={0}
          aria-label={props.issues.length === 0 ? t("Ready") : t("{count, plural, one {# issue} other {# issues}}", { count: props.issues.length })}
          class="grid size-5 place-items-center rounded-full focus-ring"
        >
          <Show when={props.issues.length} fallback={<Icon name="circle-check" class="size-5 text-primary" />}>
            <Icon name="alert-warning" class={cx("size-5", errors().length ? "text-destructive" : "text-meter-yellow")} />
          </Show>
        </TooltipTrigger>
        <TooltipContent class="max-w-64">
          <Show when={props.issues.length} fallback={t("Ready to go")}>
            <IssueList issues={props.issues} />
          </Show>
        </TooltipContent>
      </Tooltip>

      <Button
        variant="ghost"
        size="icon-square"
        aria-label={t("Remove {name}", { name: media().file.name })}
        class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => props.onRemove()}
      >
        <Icon name="trash" class="size-5 text-muted-foreground" />
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
  story: boolean;
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
        class="flex h-7 min-w-0 items-center gap-1 rounded-md border border-(--border-input) bg-input pl-1.5 pr-0.5 press hover:bg-accent focus-ring"
        classList={{ "border-destructive/60": !props.value.length }}
      >
        <Show when={props.value.length} fallback={<span class="cap-centered flex-1 text-left text-xs text-muted-foreground">{t("Choose")}</span>}>
          <PlatformLogos ids={props.value} max={3} class="flex-1" />
        </Show>
        <Icon name="chevron-down" class="size-5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="w-80 rounded-xl p-2">
          <PlatformPicker
            value={props.value}
            accounts={props.accounts}
            available={props.story ? STORY_PLATFORMS : undefined}
            onChange={props.onChange}
            columns={2}
          />
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function BatchPanel(props: { target: BulkPost[] }) {
  const [, setParams] = useSearchParams();
  let templateField: HTMLTextAreaElement | undefined;
  const count = () => props.target.length;
  const targetIds = () => new Set(props.target.map((post) => post.id));

  const shared = () => {
    const [first, ...rest] = props.target;
    if (!first) return [];
    return first.platforms.filter((id) => rest.every((post) => post.platforms.includes(id)));
  };

  const sharedAccounts = (): AccountChoices => {
    const [first, ...rest] = props.target;
    if (!first) return {};
    const accounts: AccountChoices = {};
    for (const id of shared()) {
      const choice = first.accounts[id];
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
      setBulk("platforms", next);
      setBulk("accounts", reconcile(accountsForPlatforms(next, accounts)));
      setBulk(
        "posts",
        (post) => ids.has(post.id),
        produce((post) => {
          const fits = (id: PlatformId) => !post.story || STORY_PLATFORMS.includes(id);
          post.platforms = sortPlatforms(new Set([...post.platforms.filter((id) => !removed.includes(id)), ...added.filter(fits)]));
          post.accounts = accountsForPlatforms(post.platforms, { ...readChoices(post.accounts), ...accounts });
        }),
      );
    });
  };

  const insertToken = (token: string) => {
    const field = templateField;
    if (!field) return;
    const start = field.selectionStart ?? bulk.template.length;
    const end = field.selectionEnd ?? start;
    const text = bulk.template.slice(0, start) + token + bulk.template.slice(end);
    setBulk("template", text);
    queueMicrotask(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const applyCaption = () => {
    const template = bulk.template.trim();
    if (!template) return;
    const ids = targetIds();
    const total = bulk.posts.length;
    setBulk(
      "posts",
      produce((list) => {
        list.forEach((post, index) => {
          if (!ids.has(post.id)) return;
          const filled = fillTemplate(template, post, index, total);
          post.caption = bulk.mode === "replace" || !post.caption.trim() ? filled : `${post.caption.trimEnd()}\n\n${filled}`;
        });
      }),
    );
    toast.success(t("{count, plural, one {Caption applied to # post} other {Caption applied to # posts}}", { count: count() }));
  };

  const start = () => atLocal(bulk.startDay, bulk.startTime);
  const plan = () => {
    const at = start();
    return at ? spread(count(), at, Math.max(1, bulk.every), bulk.unit, bulk.skipWeekends) : [];
  };

  const openQueueSettings = useOpenQueueSettings();
  useQueueSlots();
  const queuePlan = createMemo(() => {
    if (scheduleMode() !== "queue") return [];
    const ids = targetIds();
    const others = bulk.posts.filter((post) => !ids.has(post.id)).map((post) => `${post.day} ${post.time}`);
    return nextQueueTimes(count(), { alsoHeld: others });
  });
  const bestPlan = createMemo(() => {
    if (scheduleMode() !== "best") return [];
    const platforms = sortPlatforms(new Set(props.target.flatMap((post) => post.platforms)));
    return dailyBestTimes(platforms, count()).map((suggestion) => suggestion.at);
  });

  const assign = (times: readonly Date[]) => {
    const ids = targetIds();
    let next = 0;
    setBulk(
      "posts",
      produce((list) => {
        for (const post of list) {
          if (!ids.has(post.id) || next >= times.length) continue;
          const at = times[next++]!;
          post.day = localDateKey(at);
          post.time = timeOf(at);
        }
      }),
    );
  };

  const range = (times: readonly Date[]) =>
    times.length === 1 ? formatWhen(times[0]!) : t("{first} to {last}", { first: formatWhen(times[0]!), last: formatWhen(times.at(-1)!) });

  const fillQueue = () => {
    const times = queuePlan();
    if (!times.length) return;
    assign(times);
    const short = count() - times.length;
    toast.success(t("{count, plural, one {Queued # post} other {Queued # posts}}", { count: times.length }), {
      description: short
        ? t(
            "{count, plural, one {# post kept its time: the queue has no more open slots in the next two months.} other {# posts kept their time: the queue has no more open slots in the next two months.}}",
            { count: short },
          )
        : range(times),
    });
  };

  const spaceOut = () => {
    const times = plan();
    if (!times.length) return;
    assign(times);
    toast.success(t("{count, plural, one {Spaced out # post} other {Spaced out # posts}}", { count: times.length }), { description: range(times) });
  };

  const useBestTimes = () => {
    const times = bestPlan();
    if (!times.length) return;
    assign(times);
    const short = count() - times.length;
    toast.success(t("{count, plural, one {Moved # post to their best times} other {Moved # posts to their best times}}", { count: times.length }), {
      description: short
        ? t("{count, plural, one {# post kept its time: there are no more days to schedule on.} other {# posts kept their time: there are no more days to schedule on.}}", { count: short })
        : range(times),
    });
  };

  const importCsv = async () => {
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
          if (row.caption !== undefined) post.caption = row.caption;
          if (row.day) post.day = row.day;
          if (row.time) post.time = row.time;
          if (row.platforms) {
            post.platforms = row.platforms;
            post.accounts = accountsForPlatforms(row.platforms, post.accounts);
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
  };

  return (
    <aside class="flex w-[320px] shrink-0 flex-col border-l border-border-strong bg-sidebar/40">
      <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border-strong px-4">
        <span class="text-sm font-medium text-foreground">{t("Apply to")}</span>
        <span class="flex-1" />
        <span class="text-xs text-muted-foreground">
          {bulk.selected.length
            ? t("{count, plural, one {# post selected} other {# posts selected}}", { count: count() })
            : t("{count, plural, one {All # post} other {All # posts}}", { count: count() })}
        </span>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <PanelSection title={t("Platforms")}>
          <AccountGroupPicker platforms={shared()} accounts={sharedAccounts()} onPick={setPlatforms} class="mb-2" />
          <PlatformPicker value={shared()} accounts={sharedAccounts()} onChange={setPlatforms} columns={2} />
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

        <PanelSection title={t("Post as")}>
          <Segmented options={POST_AS} value={postAs()} onChange={(as) => setStory(targetIds(), as === "story")} label={t("Post as")} />
          <p class="text-xs leading-4 text-muted-foreground">
            {postAs() === "story"
              ? t("Stories go to {platforms}, with no caption, and are gone after a day.", { platforms: listNames(STORY_PLATFORMS) })
              : t("Each file goes out as a post: a video, or a single picture.")}
          </p>
        </PanelSection>

        <Show when={platformsWithSettings(feedKind(), feedPlatforms()).length}>
          <PanelSection title={t("Platform settings")} hint={t("Shared by every post")}>
            <PlatformSettingsFields
              kind={feedKind()}
              mixed={mixed()}
              platforms={feedPlatforms()}
              settings={settings}
              onChange={setSettings}
              tiktokAccount={bulkTikTokAccount}
            />
            <Show when={feedPlatforms().some((id) => id === "youtube" || id === "pinterest")}>
              <p class="text-xs leading-4 text-muted-foreground">
                {t("Titles take {nameToken}, {numberToken} and {dateToken} too. Left empty, each post is titled after its file.", {
                  nameToken: "{name}",
                  numberToken: "{n}",
                  dateToken: "{date}",
                })}
              </p>
            </Show>
          </PanelSection>
        </Show>

        <PanelSection title={t("Caption")} action={<VaultPicker placement="bottom-end" onPick={(item) => setBulk("template", insertVaultText(bulk.template, item))} />}>
          <textarea
            ref={templateField}
            class={cx(fieldControlBase, "min-h-24 resize-y py-2 leading-relaxed")}
            placeholder={t("Fresh clip: {nameToken} #gaming", { nameToken: "{name}" })}
            value={bulk.template}
            onInput={(event) => setBulk("template", event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <div class="flex flex-wrap gap-1">
            <For each={TOKENS}>
              {(item) => (
                <button
                  type="button"
                  class="cap-trim h-5 rounded-md bg-accent px-1.5 font-mono text-xs text-muted-foreground press hover:bg-secondary hover:text-foreground focus-ring"
                  title={t(item.label)}
                  onClick={() => insertToken(item.token)}
                >
                  {item.token}
                </button>
              )}
            </For>
          </div>
          <Segmented options={CAPTION_MODES} value={bulk.mode} onChange={(mode) => setBulk("mode", mode)} label={t("How to apply")} />
          <Button variant="secondary" class="w-full" disabled={!bulk.template.trim()} onClick={applyCaption}>
            {t("{count, plural, one {Apply to # post} other {Apply to # posts}}", { count: count() })}
          </Button>
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

        <PanelSection title={t({ message: "Schedule", context: "noun" })}>
          <Segmented options={SCHEDULE_MODES} value={scheduleMode()} onChange={setScheduleMode} label={t("How to schedule")} />
          <Show when={scheduleMode() === "queue"}>
            <Show
              when={queueSlots().length}
              fallback={
                <p class="text-xs leading-4 text-muted-foreground">
                  {t("Set the days and times you post each week, and each post takes the next open one.")}
                </p>
              }
            >
              <div class="flex items-start gap-2">
                <p class="min-w-0 flex-1 text-xs leading-4 text-foreground">{describeQueue()}</p>
                <Button variant="link" size="small" class="h-4 shrink-0" onClick={openQueueSettings}>
                  {t("Edit")}
                </Button>
              </div>
              <p class="text-xs leading-4 text-muted-foreground">
                <Show when={queuePlan().length} fallback={t("Every slot in the next two months is taken.")}>
                  {range(queuePlan())}
                  <Show when={queuePlan().length < count()}>, {t("{count} of {total} fit", { count: queuePlan().length, total: count() })}</Show>
                </Show>
              </p>
            </Show>
            <Show
              when={queueSlots().length}
              fallback={
                <Button variant="secondary" class="w-full" onClick={openQueueSettings}>
                  {t("Set up queue")}
                </Button>
              }
            >
              <Button variant="secondary" class="w-full" disabled={!queuePlan().length} onClick={fillQueue}>
                {t("{count, plural, one {Queue # post} other {Queue # posts}}", { count: count() })}
              </Button>
            </Show>
          </Show>
          <Show when={scheduleMode() === "best"}>
            <p class="text-xs leading-4 text-muted-foreground">
              {t("One a day, at the hour your audience is around most, from the heatmap on Analytics. Hours that already hold a post are skipped.")}
            </p>
            <p class="text-xs leading-4 text-muted-foreground">
              <Show when={bestPlan().length} fallback={t("There are no days left to schedule on.")}>
                {range(bestPlan())}
                <Show when={bestPlan().length < count()}>, {t("{count} of {total} fit", { count: bestPlan().length, total: count() })}</Show>
              </Show>
            </p>
            <Button variant="secondary" class="w-full" disabled={!bestPlan().length} onClick={useBestTimes}>
              {t("{count, plural, one {Use best times for # post} other {Use best times for # posts}}", { count: count() })}
            </Button>
          </Show>
          <Show when={scheduleMode() === "spread"}>
            <div class="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-xs text-muted-foreground">{t("Starting")}</span>
                <DatePicker
                  value={bulk.startDay}
                  min={localDateKey(new Date())}
                  max={localDateKey(latestSchedule())}
                  onChange={(day) => setBulk("startDay", day)}
                />
              </div>
              <div class="flex min-w-0 flex-col gap-1">
                <span class="text-xs text-muted-foreground">{t("At")}</span>
                <TimePicker value={bulk.startTime} min={earliestTimeOn(bulk.startDay)} onChange={(time) => setBulk("startTime", time)} />
              </div>
            </div>
            <Field label={t("Every")}>
              <div class="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                <input
                  class={cx(fieldControl, "tabular-nums")}
                  type="number"
                  min={1}
                  max={30}
                  value={bulk.every}
                  onInput={(event) => {
                    const value = Math.round(Number(event.currentTarget.value));
                    if (Number.isFinite(value) && value >= 1) setBulk("every", Math.min(value, bulk.unit === "days" ? 30 : 72));
                  }}
                  onKeyDown={(event) => event.stopPropagation()}
                />
                <Segmented options={SPACING_OPTIONS} value={bulk.unit} onChange={(unit) => setBulk("unit", unit)} label={t("Spacing")} />
              </div>
            </Field>
            <SwitchRow label={t("Skip weekends")} checked={bulk.skipWeekends} onChange={(on) => setBulk("skipWeekends", on)} />
            <Show when={plan().length}>
              <p class="text-xs leading-4 text-muted-foreground">{range(plan())}</p>
            </Show>
            <Button variant="secondary" class="w-full" disabled={!plan().length} onClick={spaceOut}>
              {t("{count, plural, one {Space out # post} other {Space out # posts}}", { count: count() })}
            </Button>
          </Show>
        </PanelSection>

        <PanelSection title={t("Import captions")}>
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
          <Button variant="secondary" class="w-full gap-1 pl-1" onClick={() => void importCsv()}>
            <Icon name="download" class="size-5" />
            {t("Import CSV")}
          </Button>
        </PanelSection>
      </div>
    </aside>
  );
}

function PostPanel(props: { index: number; issues: Issue[] }) {
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
  const choose = (when: Date) =>
    batch(() => {
      update("day", localDateKey(when));
      update("time", timeOf(when));
    });
  const repeats = () => {
    const cadence = cadencePhrase(post().repeat, post().day);
    if (!cadence) return null;
    const end = resolveRepeatEnd(post().repeatEnd, post().repeat, post().day);
    return end ? t("{cadence} until {date}", { cadence, date: formatCalendarDay(end) }) : cadence;
  };
  const timeProblem = () => scheduleProblem(at());

  return (
    <aside class="flex w-[340px] shrink-0 flex-col border-l border-border-strong bg-sidebar/40">
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

      <div class="min-h-0 flex-1 overflow-y-auto">
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
              title={titleFor(post(), props.index, platform())}
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

        <PanelSection title={t("Post as")}>
          <Segmented
            options={POST_AS}
            value={post().story ? "story" : "post"}
            onChange={(as) => setStory(new Set([post().id]), as === "story")}
            label={t("Post as")}
          />
        </PanelSection>

        <PanelSection title={t("Post to")}>
          <AccountGroupPicker
            platforms={post().platforms}
            accounts={post().accounts}
            available={platformsFor(kind())}
            onPick={(ids, accounts) => batch(() => {
              update("platforms", ids);
              setBulk("posts", props.index, "accounts", reconcile(accounts));
            })}
            class="mb-2"
          />
          <PlatformPicker
            value={post().platforms}
            accounts={post().accounts}
            available={platformsFor(kind())}
            onChange={(ids, accounts) => batch(() => {
              update("platforms", ids);
              setBulk("posts", props.index, "accounts", reconcile(accounts));
            })}
            columns={2}
          />
        </PanelSection>

        <Show when={!post().story}>
          <CaptionFields index={props.index} />
        </Show>

        <Show when={platformsWithSettings(kind(), post().platforms).length}>
          <PanelSection title={t("Platform settings")} hint={t("Shared by every post")}>
            <PlatformSettingsFields
              kind={kind()}
              platforms={post().platforms}
              settings={settings}
              onChange={setSettings}
              tiktokAccount={bulkTikTokAccount}
            />
          </PanelSection>
        </Show>

        <PanelSection title={t("When")}>
          <div class="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t("Date")}</span>
              <DatePicker value={post().day} min={localDateKey(now())} max={localDateKey(latestSchedule())} onChange={(day) => update("day", day)} />
            </div>
            <div class="flex min-w-0 flex-col gap-1">
              <span class="text-xs text-muted-foreground">{t("Time")}</span>
              <TimePicker value={post().time} min={earliestTimeOn(post().day)} zone={timeZoneName()} onChange={(time) => update("time", time)} />
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
    if (id === "all") setBulk("posts", props.index, "caption", text);
    else setBulk("posts", props.index, "overrides", id, text);
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
          onKeyDown={(event) => event.stopPropagation()}
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

function PanelSection(props: { title: string; hint?: string; action?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-2.5 border-b border-border-strong px-4 py-4">
      <div class="flex min-h-6 items-center gap-2">
        <h2 class="text-xs font-medium text-foreground">{props.title}</h2>
        <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{props.hint}</span>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}
