/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What guest mode opens on: plan.video's own accounts, without logins, a
// month of posts around today, the clips they use in the media library, a
// posting queue, templates, words in the vault, a plug, and sample numbers in
// Analytics (see `analyticsSources`). The posts are the homepage calendar's,
// with the site's own footage. The demo is made again on another day, so its
// posts stay around today, in another language, so its words are in it, and
// whenever it changes here. Nothing in it goes out, and nothing comes along
// into an account (see lib/guest.ts).

import { writeWorkspaceCalendar } from "@/components/calendar/store";
import type { Calendar, Delivery, StoredEvent } from "@/components/calendar/types";
import { shiftDay } from "@/components/calendar/utils";
import type { AccountGroup } from "@/lib/account-groups";
import { track } from "@/lib/analytics";
import { readGuest, saveGuest, type GuestRecord } from "@/lib/guest";
import { language, msg, t } from "@/lib/i18n";
import { putLibraryItems, type MediaItem } from "@/lib/media-library";
import { plugId, type PlugSetting } from "@/lib/plugs";
import type { PostTemplate } from "@/lib/post-templates";
import type { QueueSlot } from "@/lib/queue-slots";
import { PUBLISHING_PLATFORMS, defaultPlatformSettings, type PlatformId } from "@/lib/social";
import type { SocialConnection } from "@/lib/social-connections";
import { clockAt, dayKeyAt, momentOf, timeZone } from "@/lib/time-zone";
import type { VaultItem } from "@/lib/vault";
import { DEFAULT_WORKSPACE, WORKSPACE_DATABASES, storageKeyFor, workspaceDatabaseFor, type Workspace } from "@/lib/workspaces";
import { eraseProjectsById } from "@/projects/host";

/** Raised when the sample data changes, so a demo made before starts over. */
const VERSION = 2;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Files

/**
 * The site's own footage (see components/site-media.tsx), which the demo's
 * posts go out with. TikTok and Instagram get the upright ones, creator and
 * vlogger, so their previews fill the screen.
 */
const CLIPS = ["creator", "surf", "sunset", "vlogger"] as const;
type Clip = (typeof CLIPS)[number];

/** What the library shows of each clip in public/site: its size in bytes, its frame and its length in seconds. */
const FOOTAGE: Record<Clip, { size: number; width: number; height: number; duration: number }> = {
  creator: { size: 1_033_837, width: 540, height: 960, duration: 9 },
  surf: { size: 783_641, width: 960, height: 540, duration: 10 },
  sunset: { size: 429_810, width: 960, height: 540, duration: 10 },
  vlogger: { size: 210_560, width: 540, height: 960, duration: 4.6 },
};

/** How a demo post names its file: the footage it is. */
const DEMO_FILE = "demo-";

/** One of the demo posts' files, from the site's footage. Null when it isn't one; undefined when it couldn't be fetched. */
export async function demoFile(id: string): Promise<File | null | undefined> {
  const clip = CLIPS.find((name) => id === `${DEMO_FILE}${name}`);
  if (!clip) return null;
  try {
    const response = await fetch(`/site/${clip}.mp4`);
    if (!response.ok) return undefined;
    return new File([await response.blob()], `${clip}.mp4`, { type: "video/mp4", lastModified: Date.now() });
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// What the demo holds

/** plan.video's own accounts, as on the homepage (`SAMPLE_ACCOUNT`). Facebook and Pinterest are left to connect. */
const ACCOUNTS: readonly { platform: PlatformId; handle: string }[] = [
  { platform: "youtube", handle: "planvideo_" },
  { platform: "tiktok", handle: "planvideo_" },
  { platform: "instagram", handle: "planvideo_" },
  { platform: "x", handle: "planvideo_" },
  { platform: "linkedin", handle: "plan.video" },
  { platform: "threads", handle: "planvideo_" },
  { platform: "bluesky", handle: "planvideo.bsky.social" },
];

const accountId = (platform: string) => `demo-${platform}`;

const CALENDARS = [
  { id: "posts", name: msg("Posts"), color: "sky" },
  { id: "launch", name: msg("Launch"), color: "blue" },
  { id: "podcast", name: msg("Podcast"), color: "amber" },
  { id: "studio", name: msg("Behind the scenes"), color: "fuchsia" },
  { id: "qa", name: msg("Q&A"), color: "violet" },
  { id: "updates", name: msg("Updates"), color: "green" },
] as const;

type Sample = {
  title: string;
  /** Days from today, or a Sunday: -1 the last one before today, 1 the next. */
  day: number | { sunday: number };
  time: string;
  calendar: (typeof CALENDARS)[number]["id"];
  platforms: PlatformId[];
  caption: string;
  clip?: Clip;
  /** Later posts are scheduled unless they're drafts. Earlier ones went out. */
  draft?: boolean;
  repeat?: string;
};

const POSTS: readonly Sample[] = [
  { title: msg("Weekly tip"), day: -20, time: "09:00", calendar: "posts", platforms: ["tiktok"], clip: "vlogger", caption: msg("Hold the first frame half a second longer than feels right. #editing") },
  { title: msg("Podcast clip"), day: -18, time: "18:00", calendar: "podcast", platforms: ["youtube", "x"], clip: "creator", caption: msg("Three minutes on finding your first hundred viewers.") },
  { title: msg("Q&A clip"), day: -16, time: "11:00", calendar: "qa", platforms: ["youtube"], clip: "creator", caption: msg("Do you need a good camera to start? No, and here's why.") },
  { title: msg("Sunday vlog"), day: { sunday: -2 }, time: "10:00", calendar: "studio", platforms: ["youtube", "x"], clip: "sunset", caption: msg("Packing up the old studio.") },
  { title: msg("Weekly tip"), day: -13, time: "09:00", calendar: "posts", platforms: ["tiktok"], clip: "vlogger", caption: msg("Cut the first word of every sentence. You won't miss it. #editing") },
  { title: msg("Podcast clip"), day: -11, time: "18:00", calendar: "podcast", platforms: ["youtube", "x"], clip: "creator", caption: msg("Why we stopped posting at nine in the morning.") },
  { title: msg("BTS reel"), day: -9, time: "19:00", calendar: "studio", platforms: ["tiktok", "instagram"], clip: "vlogger", caption: msg("Ten seconds from the shoot that didn't make the cut.") },
  { title: msg("Founder Q&A"), day: -7, time: "17:00", calendar: "qa", platforms: ["instagram", "tiktok"], clip: "creator", caption: msg("You asked, we answered. Ten questions about how the studio runs.") },
  { title: msg("Q&A clip"), day: -6, time: "11:00", calendar: "qa", platforms: ["youtube"], clip: "creator", caption: msg("The question we get asked most, answered in under a minute.") },
  { title: msg("Studio tour"), day: -5, time: "12:00", calendar: "studio", platforms: ["youtube", "x"], clip: "surf", caption: msg("A walk through the new space, cables and all.") },
  { title: msg("Sunday vlog"), day: { sunday: -1 }, time: "10:00", calendar: "studio", platforms: ["youtube", "x"], clip: "sunset", caption: msg("A slow Sunday at the studio.") },
  { title: msg("Weekly tip"), day: -3, time: "09:00", calendar: "posts", platforms: ["tiktok"], clip: "vlogger", caption: msg("One thing that makes your captions easier to read. #editing") },
  { title: msg("Podcast clip"), day: -3, time: "18:00", calendar: "podcast", platforms: ["youtube", "x"], clip: "creator", caption: msg("Forty seconds from this week's episode, on pricing your first product.") },
  { title: msg("Case study"), day: -2, time: "12:30", calendar: "updates", platforms: ["linkedin", "instagram"], clip: "creator", caption: msg("How Lumen Coffee films a week of posts in one morning.") },
  { title: msg("On set"), day: -1, time: "15:00", calendar: "studio", platforms: ["linkedin", "x"], clip: "surf", caption: msg("What the launch shoot looked like from the other side of the camera.") },
  { title: msg("Launch teaser"), day: 0, time: "18:00", calendar: "launch", platforms: ["youtube", "x", "linkedin"], clip: "sunset", caption: msg("Two weeks of work in sixteen seconds. It's out on Thursday. #launch") },
  { title: msg("Launch thread"), day: 0, time: "19:30", calendar: "launch", platforms: ["x", "threads", "bluesky"], draft: true, caption: msg("Everything that's new, in six posts.") },
  { title: msg("Walkthrough"), day: 3, time: "14:00", calendar: "posts", platforms: ["tiktok", "instagram"], clip: "creator", caption: msg("Sixty seconds on the part everyone asks about.") },
  { title: msg("Weekly tip"), day: 4, time: "09:00", calendar: "posts", platforms: ["tiktok"], clip: "vlogger", repeat: "every:1:week", caption: msg("Cut on the breath, not on the word. #editing") },
  { title: msg("Podcast clip"), day: 5, time: "18:00", calendar: "podcast", platforms: ["youtube", "x"], clip: "creator", caption: msg("The one answer from this episode worth a minute of your day.") },
  { title: msg("How it works"), day: 6, time: "10:00", calendar: "posts", platforms: ["youtube"], clip: "vlogger", caption: msg("The full walkthrough: from an empty project to a scheduled post.") },
  { title: msg("Changelog"), day: 7, time: "11:00", calendar: "updates", platforms: ["linkedin"], draft: true, caption: msg("What shipped this month.") },
  { title: msg("Launch recap"), day: 10, time: "17:00", calendar: "launch", platforms: ["youtube", "tiktok", "instagram"], clip: "creator", caption: msg("A week on: what worked, and what we'd do again.") },
  { title: msg("Podcast clip"), day: 12, time: "18:00", calendar: "podcast", platforms: ["youtube", "x"], clip: "creator", caption: msg("Two minutes on why we post every day.") },
  { title: msg("Q&A clip"), day: 14, time: "11:00", calendar: "qa", platforms: ["youtube", "instagram"], clip: "creator", caption: msg("What we'd tell anyone starting a channel this year.") },
  { title: msg("Sunday vlog"), day: { sunday: 2 }, time: "10:00", calendar: "studio", platforms: ["youtube"], clip: "sunset", draft: true, caption: msg("A slow Sunday at the studio, part two.") },
  { title: msg("Podcast clip"), day: 19, time: "18:00", calendar: "podcast", platforms: ["youtube", "x"], clip: "creator", draft: true, caption: msg("The best minute of this month's episodes.") },
  { title: msg("Changelog"), day: 21, time: "11:00", calendar: "updates", platforms: ["linkedin"], draft: true, caption: msg("What shipped this month, part two.") },
];

const pad = (value: number) => String(value).padStart(2, "0");

/** Days from `today` to the post's day. */
function offsetOf(day: Sample["day"], today: string): number {
  if (typeof day === "number") return day;
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const last = weekday === 0 ? -7 : -weekday;
  const next = weekday === 0 ? 7 : 7 - weekday;
  return day.sunday < 0 ? last + 7 * (day.sunday + 1) : next + 7 * (day.sunday - 1);
}

/** The settings New post saves for each network a post goes to. */
function settingsFor(sample: Sample): Partial<StoredEvent> {
  const has = (platform: PlatformId) => sample.platforms.includes(platform);
  return {
    ...(has("tiktok") ? { tiktok: { privacy: "public", comments: true, duet: false, stitch: false, yourBrand: false, brandedContent: false } } : {}),
    ...(has("youtube") ? { youtube: { title: t(sample.title), description: "", privacy: "public", madeForKids: false, tags: [] } } : {}),
    ...(has("instagram") ? { instagram: { shareToFeed: true, collaborators: [] } } : {}),
    ...(has("x") ? { x: { replies: "everyone", community: "" } } : {}),
  };
}

function demoPosts(now: number): { calendars: Calendar[]; events: StoredEvent[] } {
  const zone = timeZone();
  const today = dayKeyAt(now, zone);
  const calendars = CALENDARS.map((calendar, index) => ({ ...calendar, name: t(calendar.name), createdAt: new Date(now - 90 * DAY_MS + index * 1000).toISOString() }));
  const events = POSTS.map((sample, index): StoredEvent => {
    let day = shiftDay(today, offsetOf(sample.day, today));
    let start = sample.time;
    let at = momentOf(day, start, zone)?.getTime() ?? now;
    // Today's scheduled post stays ahead of now, on the half hour, or moves to the same time tomorrow.
    if (day === today && !sample.draft && at < now + HOUR_MS) {
      const next = Math.ceil((now + HOUR_MS) / (HOUR_MS / 2)) * (HOUR_MS / 2);
      if (dayKeyAt(next, zone) === today) {
        start = clockAt(next, zone);
        at = next;
      } else {
        day = shiftDay(today, 1);
        at = momentOf(day, start, zone)?.getTime() ?? now;
      }
    }
    const posted = at <= now && !sample.draft;
    const sentAt = new Date(at + 2 * 60_000).toISOString();
    const deliveries = Object.fromEntries(
      sample.platforms
        .filter((platform) => PUBLISHING_PLATFORMS.includes(platform))
        .map((platform): [string, Delivery] => [platform, { state: "sent", attempts: 1, at: sentAt }]),
    );
    return {
      allDay: false,
      calendarId: sample.calendar,
      createdAt: new Date(Math.min(at, now) - 3 * DAY_MS).toISOString(),
      day,
      description: t(sample.caption),
      duration: 30,
      id: `demo-post-${pad(index + 1)}`,
      link: null,
      platforms: sample.platforms,
      accounts: Object.fromEntries(sample.platforms.map((platform) => [platform, [accountId(platform)]])),
      projectId: null,
      coverTime: null,
      files: sample.clip ? [`${DEMO_FILE}${sample.clip}`] : [],
      ...(sample.clip ? { thumbnail: `/site/${sample.clip}.webp` } : {}),
      ...settingsFor(sample),
      recurrence: sample.repeat ?? null,
      recurrenceExceptions: [],
      recurrenceEnd: null,
      ...(posted && Object.keys(deliveries).length ? { deliveries } : {}),
      sendFrom: new Date(now).toISOString(),
      start,
      status: posted ? "posted" : sample.draft ? "draft" : "scheduled",
      timeZone: zone,
      title: t(sample.title),
    };
  });
  return { calendars, events };
}

/** The clips in the media library, as if uploaded before the posts that use them. */
function demoLibrary(now: number): MediaItem[] {
  return CLIPS.map((clip, index) => {
    const { size, width, height, duration } = FOOTAGE[clip];
    const lastModified = now - (60 - index) * DAY_MS;
    return {
      id: `${DEMO_FILE}${clip}`,
      name: `${clip}.mp4`,
      kind: "video",
      type: "video/mp4",
      size,
      width,
      height,
      duration,
      poster: `/site/${clip}.webp`,
      fingerprint: `${clip}.mp4:${size}:${lastModified}`,
      lastModified,
      createdAt: new Date(lastModified).toISOString(),
      uses: POSTS.filter((sample) => sample.clip === clip).length,
      lastUsedAt: new Date(now - DAY_MS).toISOString(),
    };
  });
}

function demoLists(now: number) {
  const at = (days: number) => new Date(now - days * DAY_MS).toISOString();
  const workspaces: { active: string; list: Workspace[] } = {
    active: DEFAULT_WORKSPACE,
    list: [{ id: DEFAULT_WORKSPACE, name: "plan.video", color: "sky", createdAt: at(90), members: [] }],
  };
  const connections: SocialConnection[] = ACCOUNTS.map(({ platform, handle }) => ({
    id: accountId(platform),
    platform,
    handle,
    connectedAt: at(60),
    avatarUrl: "/apple-touch-icon.png",
  }));
  const groups: AccountGroup[] = [
    { id: "demo-group-video", name: t("Short video"), accounts: ["tiktok", "youtube", "instagram"].map(accountId), createdAt: at(40) },
    { id: "demo-group-words", name: t("Threads and updates"), accounts: ["x", "threads", "bluesky", "linkedin"].map(accountId), createdAt: at(40) },
  ];
  const queue: QueueSlot[] = [
    { id: "demo-slot-1", weekday: 1, time: "09:00" },
    { id: "demo-slot-2", weekday: 2, time: "18:00" },
    { id: "demo-slot-3", weekday: 3, time: "09:00" },
    { id: "demo-slot-4", weekday: 4, time: "18:00" },
    { id: "demo-slot-5", weekday: 5, time: "09:00" },
    { id: "demo-slot-6", weekday: 6, time: "11:00" },
  ];
  const template = (fields: Pick<PostTemplate, "id" | "name" | "platforms" | "caption" | "when" | "time" | "pinned" | "uses"> & { used: number }): PostTemplate => ({
    id: fields.id,
    name: fields.name,
    platforms: fields.platforms,
    accounts: Object.fromEntries(fields.platforms.map((platform) => [platform, [accountId(platform)]])),
    caption: fields.caption,
    overrides: {},
    settings: defaultPlatformSettings(),
    signature: false,
    thread: [],
    when: fields.when,
    time: fields.time,
    repeat: "",
    pinned: fields.pinned,
    uses: fields.uses,
    lastUsedAt: at(fields.used),
    createdAt: at(50),
    updatedAt: at(20),
  });
  const templates: PostTemplate[] = [
    template({ id: "demo-template-tip", name: t("Weekly tip"), platforms: ["tiktok", "instagram"], caption: t("One thing that makes your edits easier. #editing"), when: "queue", time: "09:00", pinned: true, uses: 6, used: 3 }),
    template({ id: "demo-template-podcast", name: t("Podcast clip"), platforms: ["youtube", "x"], caption: t("A minute from this week's episode."), when: "time", time: "18:00", pinned: false, uses: 4, used: 3 }),
    template({ id: "demo-template-launch", name: t("Launch post"), platforms: ["x", "threads", "bluesky", "linkedin"], caption: t("It's out. Everything that's new, in one place."), when: "none", time: "09:00", pinned: false, uses: 1, used: 12 }),
  ];
  const item = (id: string, kind: VaultItem["kind"], title: string, body: string, uses: number): VaultItem => ({
    id,
    kind,
    title,
    body,
    pinned: false,
    uses,
    lastUsedAt: uses ? at(4) : null,
    createdAt: at(45),
    updatedAt: at(45),
  });
  const vault: VaultItem[] = [
    item("demo-vault-editing", "hashtags", t("Editing"), t("#editing #videoediting #creator"), 9),
    item("demo-vault-launch", "hashtags", t("Launch"), t("#launch #buildinpublic"), 2),
    item("demo-vault-episode", "snippet", t("Full episode"), t("The full episode is on our YouTube channel."), 5),
    item("demo-vault-intro", "caption", t("Weekly tip"), t("One thing that makes your edits easier:"), 3),
  ];
  // The homepage's plug: switched on, with the likes it waits for and the reply it posts.
  const plugs: PlugSetting[] = [
    {
      id: plugId(accountId("bluesky"), "auto-plug"),
      accountId: accountId("bluesky"),
      kind: "auto-plug",
      likes: 1000,
      message: t("The full video is on our YouTube channel."),
      activated: true,
      createdAt: at(30),
      updatedAt: at(30),
    },
  ];
  return { workspaces, connections, groups, queue, templates, vault, plugs };
}

// ---------------------------------------------------------------------------
// Making it

/** Puts the demo's posts and lists under `guest`. */
async function seed(guest: string, now: number) {
  const lists = demoLists(now);
  const key = (base: string) => storageKeyFor(base, guest, DEFAULT_WORKSPACE);
  const rows: [string, unknown][] = [
    [`plan.video.workspaces.${guest}`, lists.workspaces],
    [key("plan.video.connections"), lists.connections],
    [key("plan.video.groups"), lists.groups],
    [key("plan.video.queue"), lists.queue],
    [key("plan.video.templates"), lists.templates],
    [key("plan.video.vault"), lists.vault],
    [key("plan.video.plugs"), lists.plugs],
  ];
  for (const [name, value] of rows) localStorage.setItem(name, JSON.stringify(value));
  await writeWorkspaceCalendar(guest, DEFAULT_WORKSPACE, { ...demoPosts(now), media: [] });
  await putLibraryItems(guest, DEFAULT_WORKSPACE, demoLibrary(now));
}

/** Everything kept for an earlier demo: its databases, its lists, and the projects made in it. */
async function forget(old: GuestRecord) {
  for (const base of WORKSPACE_DATABASES) {
    try {
      indexedDB.deleteDatabase(workspaceDatabaseFor(base, old.id, DEFAULT_WORKSPACE));
    } catch {
      // IndexedDB refused, so nothing was kept in it.
    }
  }
  for (const name of Object.keys(localStorage)) {
    if (name.startsWith("plan.video.") && (name.endsWith(`.${old.id}`) || name.includes(`.${old.id}.`))) localStorage.removeItem(name);
  }
  await eraseProjectsById(old.projects ?? []).catch((error: unknown) => console.warn("[guest] An earlier demo's projects stay", error));
}

async function open() {
  const now = Date.now();
  const stamp = `${VERSION}:${dayKeyAt(now)}:${language()}`;
  // Read again: another tab may have just made today's.
  const current = readGuest();
  if (current?.demo === stamp) {
    saveGuest(current);
    return;
  }
  const next: GuestRecord = { id: `guest-${crypto.randomUUID()}`, startedAt: new Date(now).toISOString(), projects: [], demo: stamp };
  try {
    await seed(next.id, now);
  } catch (error) {
    // Storage blocked or full, as in some private windows: the demo opens empty.
    console.warn("[guest] The demo opens without its sample posts", error);
  }
  saveGuest(next);
  if (current) await forget(current);
  else track("guest_started");
}

/**
 * Opens guest mode's demo: today's, or a new one in place of an older one.
 * Tabs take turns, so a new day's demo is made once.
 */
export async function openDemo() {
  if (navigator.locks) await navigator.locks.request("plan.video.guest-demo", open);
  else await open();
}
