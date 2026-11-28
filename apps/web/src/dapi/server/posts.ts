/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The tools agents call at plan.video/mcp, run by services/mcp with no plan.video tab open. They keep the tab's
// rules (lib/post-rules) and save over the version read, as a browser does. The person's yes is asked by their
// agent, which shows each tool's annotations: there's no plan.video tab to ask in.

import { analyticsTool, checkTikTokCreator, DapiError, isDapiError, listMediaTool, tiktokConsent, toolByName, type ToolArgs, type ToolName } from "@plan.video/dapi";

import { isDateKey, newId, resolveRepeatEnd } from "@/components/calendar/utils";
import { inEnglish } from "@/lib/i18n";
import { FREE_SCHEDULED_PER_ACCOUNT } from "@/lib/plans";
import {
  approvalRules,
  assertFits,
  awaitingApproval,
  AWAITING_APPROVAL,
  clock,
  definedOnly,
  isPlatform,
  keptAccountIds,
  mergeAccountChoices,
  pickAccounts,
  heldWarning,
  NEEDS_FILE,
  postTitle,
  postViewOf,
  readChoices,
  readTikTokCreator,
  refuseSoon,
  removedAccountNotes,
  repeatOf,
  requireTikTok,
  scheduleProblem,
  socialSchemaView,
  threadOf,
  tiktokCreatorView,
  tiktokOf,
  toProfile,
  youtubeOf,
  PUBLISHES,
} from "@/lib/post-rules";
import {
  isAspect,
  listNames,
  PUBLISHING_PLATFORMS,
  socialPlatform,
  sortPlatforms,
  type MediaSummary,
  type PlatformId,
  type PostKind,
  type TikTokPostSettings,
  type YouTubePostSettings,
} from "@/lib/social";
import { clockAt, dayKeyAt, momentOf } from "@/lib/time-zone";

import type { AnalyticsArgs } from "@/lib/analytics-answer";

import { readAnalytics, type NetworkReads } from "./analytics";

import type { Delivery, StoredEvent } from "@/components/calendar/types";
import type { AccountChoices } from "@/lib/social-connections";

/** `scope` is what its login was granted; `page` is a LinkedIn company Page. */
export type AgentAccount = { id: string; platform: string; handle: string; ready: boolean; scope: string; page: boolean };

export type LibraryItem = {
  id: string;
  name: string;
  kind: "video" | "image";
  type: string;
  size: number;
  width: number;
  height: number;
  duration: number;
  lastModified: number;
  createdAt: string;
  uses: number;
};

/** What agent_context answers: the workspace open last in the person's dashboard. */
export type AgentContext = {
  owner: string;
  workspace: string;
  name: string;
  role: "owner" | "admin" | "member";
  level: number;
  membersNeedApproval: boolean;
  timeZone: string;
  calendarId: string;
  connections: AgentAccount[];
  library: LibraryItem[];
};

/** As post-sync-core's AccountMedia: what a browser needs to fetch a post's file. */
export type FileDetails = { id: string; name: string; type: string; lastModified: number; cloud?: { key: string; at: string } };

export type PostData = StoredEvent & { media?: FileDetails[] };

export type PostRow = { id: string; version: number; data: PostData; deliveries: Partial<Record<string, { state: string; error?: string }>> };

/** As post_deliveries has them, from the publisher's send route. */
export type DeliveryRow = { platform: string; connection_id: string; state: string; error: string | null };

export type PostFilter = { id?: string; status?: string; from?: string; to?: string };

/** A file copied onto a post, from the library (`media/<id>`) or another post (`posts/<id>`). */
export type FileCopy = { from: string; to: string };

export interface PostingStore extends NetworkReads {
  context(): Promise<AgentContext>;
  posts(scope: AgentContext, filter: PostFilter): Promise<PostRow[]>;
  save(scope: AgentContext, post: PostData, base: number | null): Promise<{ version: number } | { conflict: true }>;
  remove(scope: AgentContext, id: string, base: number): Promise<{ deleted: true } | { conflict: true }>;
  askApproval(scope: AgentContext, id: string, base: number, snapshot: object): Promise<{ version: number; preview: string } | { conflict: true }>;
  copyFiles(scope: AgentContext, copies: FileCopy[]): Promise<void>;
  /** Hands the post to the publisher now. */
  send(id: string): Promise<DeliveryRow[]>;
}

export type ToolOutcome = { text: string; error: boolean };

export type PostingOptions = {
  now?: () => number;
  /** Between looks at a send's progress. */
  sleep?: (ms: number) => Promise<void>;
  /** Where approval links point. */
  site?: string;
};

/** As calendar/store counts the Free plan's waiting posts. */
const GOING_OUT_MS = 5 * 60_000;
const SCHEDULED_LIMIT = "On the Free plan, each account can have 10 scheduled posts waiting at a time. Upgrade for unlimited posts.";
const CONFLICT = "The post changed in plan.video while this was saved, so nothing was changed. Read it again with list_posts and try again.";
/** A send that takes longer goes on without the agent waiting: list_posts tells how it went. */
const SEND_WAIT_MS = 120_000;
const SEND_LOOK_MS = 3_000;

type Attached = { from: string[]; names: { name: string; type: string; lastModified: number }[]; kind: PostKind; media: MediaSummary };

type Session = { scope: AgentContext; store: PostingStore; now: number; options: Required<PostingOptions> };

export function createPostingTools(store: PostingStore, given: PostingOptions = {}) {
  const options: Required<PostingOptions> = {
    now: given.now ?? Date.now,
    sleep: given.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    site: (given.site ?? "https://plan.video").replace(/\/$/, ""),
  };
  return {
    handles: (name: string) => Object.hasOwn(HANDLERS, name) || name === "social_schema",

    async run(name: string, input: unknown): Promise<ToolOutcome> {
      if (!Object.hasOwn(HANDLERS, name) && name !== "social_schema") return { text: `There is no tool named ${name}.`, error: true };
      const schema = name === listMediaTool.name ? listMediaTool.input : name === analyticsTool.name ? analyticsTool.input : toolByName(name as ToolName).input;
      const parsed = schema.safeParse(input ?? {});
      if (!parsed.success) {
        const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
        return { text: `The arguments don't fit ${name}: ${problems}`, error: true };
      }
      try {
        if (name === "social_schema") return { text: JSON.stringify(socialSchemaView((parsed.data as ToolArgs<"social_schema">).platform)), error: false };
        const session: Session = { scope: await store.context(), store, now: options.now(), options };
        const output = await HANDLERS[name as keyof typeof HANDLERS](session, parsed.data as never);
        return { text: JSON.stringify(output), error: false };
      } catch (error) {
        const message = (error as Error).message || String(error);
        return { text: isDapiError(error) ? `${error.code}: ${message}` : message, error: true };
      }
    },
  };
}

const HANDLERS = {
  social_accounts: socialAccounts,
  list_media: listMedia,
  list_posts: listPosts,
  schedule_post: schedulePost,
  copy_post: copyPost,
  update_post: updatePost,
  delete_post: deletePost,
  publish_post: publishPost,
  ask_for_approval: askForApproval,
  tiktok_creator: tiktokCreator,
  analytics: (session: Session, args: AnalyticsArgs) => readAnalytics(session.store, session.scope, args, session.now),
};

// ---------------------------------------------------------------------------
// Accounts, limits and views, with the workspace in hand rather than a store

const connected = (scope: AgentContext) => scope.connections.filter((account) => isPlatform(account.platform));

function accountsFor(scope: AgentContext, platform: string, choices: AccountChoices | undefined): AgentAccount[] {
  const list = scope.connections.filter((account) => account.platform === platform);
  const chosen = readChoices(choices)[platform] ?? [];
  if (chosen.length) return list.filter((account) => chosen.includes(account.id));
  return list.length === 1 ? list : [];
}

/** Only the person's own workspaces on the Free plan; a shared one is on its owner's, which has a team and no limit. */
const scheduledLimit = (scope: AgentContext) => (scope.role === "owner" && scope.level <= 1 ? FREE_SCHEDULED_PER_ACCOUNT : undefined);

function waitingFrom(session: Session, post: StoredEvent): string[] {
  if (post.status !== "scheduled" || post.paused) return [];
  const zone = post.timeZone || session.scope.timeZone;
  const over = post.recurrence
    ? isDateKey(post.recurrenceEnd) && post.recurrenceEnd < dayKeyAt(session.now, zone)
    : (momentOf(post.day, post.allDay ? "00:00" : post.start, zone)?.getTime() ?? 0) < session.now + GOING_OUT_MS;
  if (over) return [];
  return [...new Set(post.platforms.flatMap((platform) => accountsFor(session.scope, platform, post.accounts).map((account) => account.id)))];
}

async function waitingByAccount(session: Session, except?: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const row of await session.store.posts(session.scope, { status: "scheduled" })) {
    if (row.id === except) continue;
    for (const id of waitingFrom(session, row.data)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Only accounts it newly waits on count, so a post already waiting can still be changed. */
async function refuseOverLimit(session: Session, next: StoredEvent, before?: StoredEvent) {
  const limit = scheduledLimit(session.scope);
  if (limit === undefined) return;
  const had = before ? waitingFrom(session, before) : [];
  const added = waitingFrom(session, next).filter((id) => !had.includes(id));
  if (!added.length) return;
  const waiting = await waitingByAccount(session, next.id);
  if (added.some((id) => (waiting.get(id) ?? 0) >= limit)) throw new DapiError("invalid-input", SCHEDULED_LIMIT);
}

function deliveriesOf(row: PostRow): StoredEvent["deliveries"] {
  const out: Partial<Record<string, Delivery>> = {};
  for (const [platform, delivery] of Object.entries(row.deliveries ?? {})) {
    if (!delivery) continue;
    const state = delivery.state === "sent" || delivery.state === "failed" ? delivery.state : "sending";
    out[platform] = { state, ...(delivery.error ? { error: delivery.error } : {}), attempts: 0, at: "" };
  }
  return out;
}

const viewOf = (session: Session, row: PostRow, warnings: string[] = []) =>
  postViewOf({ ...row.data, deliveries: deliveriesOf(row) }, { connections: session.scope.connections, timeZone: session.scope.timeZone }, warnings);

async function postById(session: Session, id: string): Promise<PostRow> {
  const [row] = await session.store.posts(session.scope, { id });
  if (!row) throw new DapiError("not-found", "This post no longer exists.");
  return row;
}

// ---------------------------------------------------------------------------
// Files: from the library by media id, or the ones a post already has

function fromLibrary(scope: AgentContext, media: string | readonly string[]): Attached {
  const items = (typeof media === "string" ? [media] : media).map((reference) => {
    const trimmed = reference.trim();
    if (!trimmed.startsWith("media:")) throw new DapiError("invalid-input", "Pass a media id from list_media, such as media:2f9c1e. Paths and URLs aren't attached.");
    const item = scope.library.find((row) => row.id === trimmed.slice("media:".length));
    if (!item) throw new DapiError("not-found", "That file is no longer in the media library. Ask the user to add it in the dashboard's Media tab.");
    return item;
  });
  const first = items[0]!;
  const names = items.map(({ name, type, lastModified }) => ({ name, type, lastModified }));
  const from = items.map((item) => `media/${item.id}`);
  if (first.kind === "video") {
    if (items.length > 1) throw new DapiError("invalid-input", "A post takes one video, or up to 35 pictures. Attach the video on its own.");
    return { from, names, kind: "video", media: { kind: "video", duration: first.duration, width: first.width, height: first.height } };
  }
  if (items.some((item) => item.kind === "video")) throw new DapiError("invalid-input", "A post takes one video, or up to 35 pictures, not both.");
  const mixedShapes = first.width > 0 && items.some((item) => !isAspect(item.width, item.height, first.width / first.height));
  return { from, names, kind: "image", media: { kind: "images", count: items.length, width: first.width, height: first.height, mixedShapes } };
}

/** Its sizes aren't kept with the post, so they read as unknown, as the tab reads a file it can't open. */
function onPost(post: PostData, ids: readonly string[]): Attached | null {
  if (!ids.length) return null;
  const details = ids.map((id) => post.media?.find((item) => item.id === id) ?? { id, name: "", type: "", lastModified: 0 });
  const names = details.map(({ name, type, lastModified }) => ({ name, type, lastModified }));
  const from = ids.map((id) => `posts/${id}`);
  if (details.some((item) => item.type.startsWith("video/"))) return { from, names, kind: "video", media: { kind: "video", duration: 0, width: 0, height: 0 } };
  return { from, names, kind: "image", media: { kind: "images", count: ids.length, width: 0, height: 0, mixedShapes: false } };
}

function savedMedia(post: PostData) {
  const own: Partial<Record<string, Attached>> = {};
  for (const platform of Object.keys(post.ownFiles ?? {})) {
    const attached = onPost(post, post.ownFiles?.[platform] ?? []);
    if (attached) own[platform] = attached;
  }
  // A post from before posts listed their files may have one under its own id, or none.
  const shared = post.files ? onPost(post, post.files) : post.media?.some((item) => item.id === post.id) ? onPost(post, [post.id]) : null;
  return { shared, own };
}

const mediaOn = (shared: Attached | null, own: Partial<Record<string, Attached>>) => (platform: PlatformId) => (own[platform] ?? shared)?.media ?? null;

const kindOf = (shared: Attached | null, own: Partial<Record<string, Attached>>): PostKind => {
  const all = [shared, ...Object.values(own)].filter((item): item is Attached => !!item);
  return all.some((item) => item.kind === "video") ? "video" : all.length ? "image" : "text";
};

/** A YouTube Short is told by its shape and length, unknown for files already on a post. */
const knownShape = (media: MediaSummary | null) => (media && media.width > 0 ? media : null);

/** Copies each file once, under the post, before the post names them, so no browser or send finds one missing. */
async function copyOnto(session: Session, postId: string, shared: Attached | null, own: Partial<Record<string, Attached>>) {
  const ids = new Map<string, string>();
  const details: FileDetails[] = [];
  const at = new Date(session.now).toISOString();
  const idOf = (from: string, names: Attached["names"][number]) => {
    let id = ids.get(from);
    if (!id) {
      id = `${postId}_${newId().replace(/-/g, "").slice(0, 12)}`;
      ids.set(from, id);
      details.push({ id, name: names.name || "file", type: names.type, lastModified: names.lastModified, cloud: { key: `posts/${session.scope.owner}/${id}`, at } });
    }
    return id;
  };
  const listOf = (attached: Attached) => attached.from.map((from, index) => idOf(from, attached.names[index]!));
  const files = shared ? listOf(shared) : [];
  const ownFiles = Object.fromEntries(Object.entries(own).flatMap(([platform, attached]) => (attached ? [[platform, listOf(attached)]] : [])));
  if (ids.size) await session.store.copyFiles(session.scope, [...ids].map(([from, to]) => ({ from, to })));
  return { files, ownFiles, media: details };
}

// ---------------------------------------------------------------------------
// Saving

/** As the tab's store keeps them: words a network has of its own only where they differ from the caption. */
function withOwnCaptions(post: PostData, own: Partial<Record<string, string>>): PostData {
  const shared = (post.description ?? "").trim();
  const isOwn = (words: string | undefined): words is string => !!words?.trim() && words.trim() !== shared;
  const captions: Partial<Record<string, string>> = {};
  for (const platform of post.platforms) {
    const words = own[platform];
    if (platform !== "youtube" && isOwn(words)) captions[platform] = words;
  }
  const next: PostData = { ...post, captions };
  if (!Object.keys(captions).length) delete next.captions;
  if (next.youtube) next.youtube = { ...next.youtube, description: post.platforms.includes("youtube") && isOwn(own.youtube) ? own.youtube : "" };
  return next;
}

function ownCaptions(post: StoredEvent): Partial<Record<string, string>> {
  const shared = (post.description ?? "").trim();
  const own: Partial<Record<string, string>> = {};
  for (const platform of post.platforms) {
    const words = platform === "youtube" ? post.youtube?.description : post.captions?.[platform];
    if (words?.trim() && words.trim() !== shared) own[platform] = words;
  }
  return own;
}

async function written(session: Session, post: PostData, base: number | null): Promise<PostRow> {
  const saved = await session.store.save(session.scope, post, base);
  if ("conflict" in saved) throw new DapiError("busy", CONFLICT);
  return { id: post.id, version: saved.version, data: post, deliveries: {} };
}

async function creatorOf(session: Session, account: AgentAccount) {
  try {
    const answer = await session.store.network<{ data?: Record<string, unknown> }>("tiktok/creator", { connectionId: account.id });
    const creator = readTikTokCreator(answer.data ?? {});
    if (!creator) throw new Error("TikTok didn't say who can watch this post. Try again in a minute.");
    return creator;
  } catch (cause) {
    throw new DapiError("unsupported", `TikTok (${account.handle}): ${(cause as Error).message}`, { cause });
  }
}

/** TikTok's rules for its profile: the user's yes to TikTok's terms, passed by their agent, and each account's creator info. */
async function tiktokYes(session: Session, choices: AccountChoices | undefined, tiktok: TikTokPostSettings, media: MediaSummary | null, agreed: boolean | undefined, field: string) {
  if (agreed !== true) {
    throw new DapiError(
      "invalid-input",
      `Posting to the TikTok profile needs the user's yes to TikTok's terms. Show them this, word for word: "${tiktokConsent(tiktok.brandedContent)}" Then pass ${field} true once they accept.`,
    );
  }
  let settings = tiktok;
  const warnings: string[] = [];
  for (const account of accountsFor(session.scope, "tiktok", choices)) {
    if (!account.ready) continue;
    const checked = checkTikTokCreator(settings, await creatorOf(session, account), media?.kind === "video" ? media.duration : null);
    if (checked.errors.length) throw new DapiError("invalid-input", checked.errors.join(" "));
    settings = checked.choices;
    warnings.push(...checked.warnings);
  }
  return { tiktok: settings, warnings };
}

/** The workspace's approval rule, as the calendar store applies it in the tab. */
const withRules = <T extends StoredEvent>(session: Session, saved: StoredEvent | undefined, next: T) =>
  approvalRules(saved, next, { approver: session.scope.role !== "member", membersNeedApproval: session.scope.membersNeedApproval }, new Date(session.now).toISOString());

type NewPost = Omit<ToolArgs<"schedule_post">, "media">;

/** `youtube` is a copied post's own settings, whose Short it keeps: a file already on a post has no shape to tell by. */
async function saveNew(session: Session, args: NewPost, shared: Attached | null, own: Partial<Record<string, Attached>>, youtubeBefore?: YouTubePostSettings) {
  const { scope } = session;
  const platforms = sortPlatforms(args.platforms);
  refuseSoon(platforms);
  const choices = pickAccounts(connected(scope), platforms, args.accounts);
  const zone = scope.timeZone;
  const day = args.day ?? dayKeyAt(session.now, zone);
  if (!isDateKey(day)) throw new DapiError("invalid-input", "Day is YYYY-MM-DD.");
  const scheduling = args.draft !== true;
  if (scheduling && (args.day === undefined || args.time === undefined)) {
    throw new DapiError("invalid-input", "Pass a day and a time to schedule, or draft true to save it without a send time.");
  }
  const time = args.time ? clock(args.time) : null;
  const when = momentOf(day, time ?? "00:00", zone);
  if (!when) throw new DapiError("invalid-input", "Pick a date and a time.");
  if (scheduling) {
    const problem = inEnglish(() => scheduleProblem(when, zone, session.now));
    if (problem) throw new DapiError("invalid-input", problem);
  }

  const caption = args.caption;
  const title = postTitle(args.youtube?.title || caption, shared?.names[0]?.name.replace(/\.[^.]+$/, "") || "Untitled post");
  const media = mediaOn(shared, own);
  const youtube = youtubeOf(args.youtube, youtubeBefore, platforms, caption, knownShape(media("youtube")));
  let tiktok = platforms.includes("tiktok") ? tiktokOf(args.tiktok) : undefined;
  requireTikTok(platforms, tiktok, scheduling);
  const warnings = assertFits({ kind: kindOf(shared, own), platforms, caption, title: youtube?.title || title, media });
  if (scheduling && toProfile(platforms, tiktok)) {
    const checked = await tiktokYes(session, choices, tiktok, media("tiktok"), args.tiktok?.agreed, "tiktok.agreed");
    tiktok = checked.tiktok;
    warnings.push(...checked.warnings);
  }
  const { repeat, repeatEnd } = repeatOf(args.repeat, day);
  const thread = threadOf(args.thread, platforms);

  const id = newId();
  const recurrence = repeat || null;
  const post: PostData = withRules(session, undefined, withOwnCaptions(
    {
      allDay: !scheduling && !time,
      calendarId: scope.calendarId,
      createdAt: new Date(session.now).toISOString(),
      day,
      description: caption.trim() || null,
      duration: !scheduling && !time ? 24 * 60 : 15,
      id,
      link: args.link?.trim() || null,
      platforms,
      accounts: choices,
      projectId: null,
      coverTime: null,
      ...(tiktok ? { tiktok } : {}),
      ...(youtube ? { youtube } : {}),
      ...(thread?.length ? { thread } : {}),
      recurrence,
      recurrenceExceptions: [],
      recurrenceEnd: recurrence ? resolveRepeatEnd(repeatEnd || undefined, recurrence, day) : null,
      sendFrom: new Date(session.now).toISOString(),
      start: time ?? "00:00",
      status: scheduling ? "scheduled" : "draft",
      timeZone: zone,
      title: title || "Untitled post",
    },
    { youtube: youtube?.description },
  ));
  await refuseOverLimit(session, post);
  // Files last of all the checks: a copy can't be taken back.
  if (shared || Object.keys(own).length) Object.assign(post, await copyOnto(session, id, shared, own));
  const row = await written(session, post, null);
  return viewOf(session, row, [...warnings, ...heldWarning(post, scheduling)]);
}

// ---------------------------------------------------------------------------
// The tools

async function socialAccounts(session: Session) {
  const { scope } = session;
  const limit = scheduledLimit(scope);
  const waiting = limit === undefined ? new Map<string, number>() : await waitingByAccount(session);
  return {
    timeZone: scope.timeZone,
    accounts: connected(scope).map((account) => {
      const publishes = PUBLISHES.has(account.platform);
      const scheduledRoom = limit === undefined ? null : Math.max(0, limit - (waiting.get(account.id) ?? 0));
      return { id: account.id, platform: account.platform, handle: account.handle, publishes, ready: publishes && account.ready, scheduledRoom };
    }),
  };
}

async function listMedia(session: Session, args: { kind?: "video" | "image"; search?: string; limit?: number }) {
  const words = (args.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matched = session.scope.library
    .filter((item) => (!args.kind || item.kind === args.kind) && words.every((word) => item.name.toLowerCase().includes(word)))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return {
    total: matched.length,
    media: matched.slice(0, args.limit ?? 30).map((item) => ({
      id: `media:${item.id}`,
      name: item.name,
      kind: item.kind,
      seconds: Math.round(item.duration * 10) / 10,
      width: item.width,
      height: item.height,
      bytes: item.size,
      added: item.createdAt,
      uses: item.uses,
    })),
  };
}

async function listPosts(session: Session, args: ToolArgs<"list_posts">) {
  const { scope } = session;
  if (args.id) return { timeZone: scope.timeZone, total: 1, posts: [viewOf(session, await postById(session, args.id))] };
  if (args.from && !isDateKey(args.from)) throw new DapiError("invalid-input", "from is YYYY-MM-DD.");
  if (args.to && !isDateKey(args.to)) throw new DapiError("invalid-input", "to is YYYY-MM-DD.");
  const rows = await session.store.posts(scope, { status: args.status, from: args.from, to: args.to });
  const matched = rows.filter((row) => !args.platform || row.data.platforms.includes(args.platform));
  const sorted = matched.sort((a, b) => a.data.day.localeCompare(b.data.day) || a.data.start.localeCompare(b.data.start));
  return { timeZone: scope.timeZone, total: sorted.length, posts: sorted.slice(0, args.limit ?? 50).map((row) => viewOf(session, row)) };
}

async function schedulePost(session: Session, args: ToolArgs<"schedule_post">) {
  const { media, ...rest } = args;
  return saveNew(session, rest, media ? fromLibrary(session.scope, media) : null, {});
}

async function copyPost(session: Session, args: ToolArgs<"copy_post">) {
  const original = (await postById(session, args.id)).data;
  const platforms = sortPlatforms(args.platforms ?? original.platforms.filter(isPlatform));
  if (platforms.length === 0) throw new DapiError("invalid-input", "The original has no platform. Pass platforms for the copy.");
  const kept = Object.entries(readChoices(original.accounts)).flatMap(([platform, ids]) =>
    (platforms as string[]).includes(platform) ? keptAccountIds(connected(session.scope), platform as PlatformId, ids ?? []) : [],
  );
  const { shared, own } = savedMedia(original);
  const youtube = original.youtube;
  const tiktok = original.tiktok;
  const promotion = tiktok
    ? tiktok.yourBrand && tiktok.brandedContent
      ? "both"
      : tiktok.yourBrand
        ? "your_brand"
        : tiktok.brandedContent
          ? "branded_content"
          : "none"
    : undefined;
  return saveNew(
    session,
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
    shared,
    own,
    youtube,
  );
}

async function updatePost(session: Session, args: ToolArgs<"update_post">) {
  const { scope } = session;
  const row = await postById(session, args.id);
  const existing = row.data;
  if (existing.status === "posted") throw new DapiError("invalid-input", "Posted posts stay as they went out. Post again to make a copy you can change.");

  const platforms = args.platforms ? sortPlatforms(args.platforms) : sortPlatforms(existing.platforms.filter(isPlatform));
  if (platforms.length === 0) throw new DapiError("invalid-input", "Pick at least one platform.");
  refuseSoon(platforms, existing.platforms);
  const choices = mergeAccountChoices(connected(scope), platforms, args.accounts, existing.accounts);
  const attached = args.media ? { shared: fromLibrary(scope, args.media), own: {} } : savedMedia(existing);
  const caption = args.caption ?? existing.description ?? "";
  // A new caption replaces words a network had of its own.
  const own = caption.trim() === (existing.description ?? "").trim() ? ownCaptions(existing) : {};
  const zone = existing.timeZone || scope.timeZone;
  const day = args.day ?? existing.day;
  if (!isDateKey(day)) throw new DapiError("invalid-input", "Day is YYYY-MM-DD.");
  const time = args.time ? clock(args.time) : existing.allDay ? null : existing.start;

  let status = existing.status;
  if (args.draft === false && awaitingApproval(existing)) throw new DapiError("invalid-input", AWAITING_APPROVAL);
  if (args.draft === true) status = "draft";
  else if (args.draft === false) status = "scheduled";
  // One waiting for approval keeps waiting at its new time.
  else if (args.day !== undefined && args.time !== undefined && existing.status === "draft" && !awaitingApproval(existing)) status = "scheduled";
  const at = time ? momentOf(day, time, zone) : null;
  if (status === "scheduled") {
    if (!time) throw new DapiError("invalid-input", "A scheduled post needs a time. Pass one, or draft true.");
    const problem = inEnglish(() => scheduleProblem(at, zone, session.now));
    if (problem) throw new DapiError("invalid-input", problem);
  }

  // A YouTube title written for the post stays when the caption changes; one made from the caption follows it.
  const madeTitles = new Set([postTitle(existing.description ?? "", ""), postTitle(existing.description ?? "", "Untitled post")]);
  const oldYouTubeTitle = existing.youtube?.title?.trim() ?? "";
  const ownTitle = platforms.includes("youtube") && oldYouTubeTitle && !madeTitles.has(oldYouTubeTitle) ? oldYouTubeTitle : "";
  const fileTitle = attached.shared?.names[0]?.name.replace(/\.[^.]+$/, "");
  const title = args.youtube?.title?.trim() || (args.caption !== undefined ? ownTitle || postTitle(caption, fileTitle || existing.title) : existing.title);
  const media = mediaOn(attached.shared, attached.own);
  const youtube = youtubeOf(args.youtube, existing.youtube, platforms, caption, knownShape(media("youtube")), args.caption !== undefined ? title : existing.youtube?.title);
  let tiktok = platforms.includes("tiktok") ? tiktokOf(args.tiktok, existing.tiktok) : undefined;
  requireTikTok(platforms, tiktok, status === "scheduled");
  const warnings = [
    ...assertFits({ kind: kindOf(attached.shared, attached.own), platforms, caption, own, title: youtube?.title || title, media }),
    ...removedAccountNotes(connected(scope), platforms, choices),
  ];
  // A post already set to go to the profile was agreed to; one newly headed there, or with new answers, needs a yes again.
  const agreedBefore = existing.status === "scheduled" && toProfile(existing.platforms, existing.tiktok);
  const tiktokChanged = args.tiktok?.privacy !== undefined || args.tiktok?.promotion !== undefined || args.tiktok?.inbox !== undefined || args.accounts !== undefined;
  if (status === "scheduled" && toProfile(platforms, tiktok) && (!agreedBefore || tiktokChanged)) {
    const checked = await tiktokYes(session, choices, tiktok, media("tiktok"), args.tiktok?.agreed, "tiktok.agreed");
    tiktok = checked.tiktok;
    warnings.push(...checked.warnings);
  }
  const retimed = day !== existing.day || (time ?? "00:00") !== existing.start || !time !== existing.allDay || status !== existing.status;

  const built = args.repeat ? repeatOf(args.repeat, day) : null;
  const recurrence = args.repeat === null ? null : built ? built.repeat || null : existing.recurrence;
  const recurrenceEnd = args.repeat === null ? null : built ? (recurrence ? resolveRepeatEnd(built.repeatEnd || undefined, recurrence, day) : null) : (existing.recurrenceEnd ?? null);
  if (recurrenceEnd && recurrenceEnd < day) throw new DapiError("invalid-input", "Pick an end on or after the first post.");
  const thread = threadOf(args.thread, platforms);

  const next: PostData = {
    ...existing,
    allDay: !time,
    day,
    start: time ?? "00:00",
    title: title.trim() || existing.title,
    description: caption.trim() || null,
    duration: !time ? 24 * 60 : existing.allDay ? 15 : existing.duration,
    link: args.link !== undefined ? args.link.trim() || null : existing.link,
    platforms,
    accounts: choices,
    recurrence,
    recurrenceEnd,
    recurrenceExceptions: day !== existing.day || recurrence !== existing.recurrence ? [] : existing.recurrenceExceptions,
    status,
  };
  if (tiktok) next.tiktok = tiktok;
  else delete next.tiktok;
  if (youtube) next.youtube = youtube;
  else delete next.youtube;
  const replies = thread === undefined ? existing.thread : thread;
  if (replies?.length) next.thread = replies;
  else delete next.thread;
  // A retimed post gets its time now: the publisher won't send a run due before that.
  const changedTiming = retimed || recurrence !== existing.recurrence || recurrenceEnd !== (existing.recurrenceEnd ?? null);
  if (changedTiming) next.sendFrom = new Date(session.now).toISOString();
  const revised = withRules(session, existing, withOwnCaptions(next, own));
  await refuseOverLimit(session, revised, existing);
  if (args.media && attached.shared) {
    const copied = await copyOnto(session, existing.id, attached.shared, {});
    revised.files = copied.files;
    delete revised.ownFiles;
    // Follow-ups keep their own files, and with them those files' details.
    const replyFiles = new Set((revised.thread ?? []).flatMap((reply) => reply.files ?? []));
    revised.media = [...(existing.media ?? []).filter((item) => replyFiles.has(item.id)), ...copied.media];
  }
  const saved = await written(session, revised, row.version);
  return viewOf(session, saved, [...warnings, ...heldWarning(revised, status === "scheduled")]);
}

async function deletePost(session: Session, { id }: ToolArgs<"delete_post">) {
  const row = await postById(session, id);
  if (row.data.status === "posted") throw new DapiError("invalid-input", "Posted posts stay as they went out. Post again to make a copy you can change.");
  const removed = await session.store.remove(session.scope, id, row.version);
  if ("conflict" in removed) throw new DapiError("busy", CONFLICT);
  return { id, deleted: true };
}

async function tiktokCreator(session: Session, { account: requested }: ToolArgs<"tiktok_creator">) {
  const choices = pickAccounts(connected(session.scope), ["tiktok"], requested ? [requested] : undefined);
  const account = accountsFor(session.scope, "tiktok", choices)[0];
  if (!account) throw new DapiError("invalid-input", "Connect TikTok in Connections first.");
  if (!account.ready) throw new DapiError("invalid-input", `Connect ${account.handle} in Connections again: plan.video has its name but no TikTok login.`);
  return tiktokCreatorView(account.id, await creatorOf(session, account));
}

/** The files a network gets: its own, or the post's. A post from before posts listed their files has one under its own id. */
function filesFor(post: PostData, platform: string): string[] {
  const ids = post.ownFiles?.[platform] ?? post.files;
  if (ids) return [...ids];
  return post.media?.some((item) => item.id === post.id) ? [post.id] : [];
}

const isVideo = (file: FileDetails | undefined) => !!file && (file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name));

const platformName = (id: string) => (isPlatform(id) ? socialPlatform(id).name : id);

function deliveryErrors(row: PostRow): string {
  const lines = Object.entries(row.deliveries ?? {}).flatMap(([id, delivery]) =>
    !delivery || delivery.state === "sent" ? [] : [`${platformName(id)}: ${delivery.error ?? "was not published."}`],
  );
  return lines.join(" ") || "The post was not published.";
}

async function publishPost(session: Session, { id, agreed }: ToolArgs<"publish_post">) {
  const { scope } = session;
  const row = await postById(session, id);
  let post = row.data;
  if (post.status === "posted") throw new DapiError("invalid-input", "This post already went out.");
  if (awaitingApproval(post)) throw new DapiError("invalid-input", AWAITING_APPROVAL);
  const foreign = post.platforms.filter((platform) => !PUBLISHES.has(platform));
  if (foreign.length > 0) {
    const names = foreign.map(platformName);
    throw new DapiError(
      "unsupported",
      `plan.video sends ${inEnglish(() => listNames(PUBLISHING_PLATFORMS as PlatformId[]))} only. ${names.join(", ")} ${names.length === 1 ? "is" : "are"} not sent. Take ${names.length === 1 ? "it" : "them"} off the post, or leave this post on the calendar.`,
    );
  }
  if (post.platforms.length === 0) throw new DapiError("invalid-input", "This post has no platform to send to.");
  for (const platform of post.platforms) {
    const name = platformName(platform);
    const chosen = accountsFor(scope, platform, post.accounts);
    if (chosen.length > 1) throw new DapiError("invalid-input", `Publishing sends one ${name} account. This post has ${chosen.length}. Leave one on it.`);
    if (chosen.some((account) => account.ready)) continue;
    const unnamed = (readChoices(post.accounts)[platform] ?? []).length === 0;
    const others = connected(scope).filter((account) => account.platform === platform).length;
    if (unnamed && others > 1) throw new DapiError("invalid-input", `${name} has more than one account. Update the post with the account id to publish.`);
    if (!unnamed && chosen.length === 0 && others > 0) throw new DapiError("invalid-input", `The ${name} account this post named was removed. Update the post with a ${name} account id, then publish.`);
    throw new DapiError("invalid-input", `Connect ${name} in Connections. A name alone can't publish.`);
  }
  if (post.platforms.includes("tiktok") && !post.tiktok?.inbox && !post.tiktok?.privacy) {
    throw new DapiError("invalid-input", "TikTok needs who can watch before it can be published. Update the post with tiktok.privacy, or tiktok.inbox true.");
  }
  if (post.platforms.includes("youtube") && !(post.youtube?.title || post.title).trim()) throw new DapiError("invalid-input", "Add a YouTube title, then publish.");
  // YouTube needs a video, TikTok and Instagram a video or pictures. The others also take pictures, or the words alone.
  for (const platform of post.platforms.filter((item) => NEEDS_FILE.has(item))) {
    const files = filesFor(post, platform);
    if (!files.length) throw new DapiError("invalid-input", platform === "youtube" ? "Attach a video before publishing." : "Attach a video or pictures before publishing.");
    if (platform === "youtube" && !files.some((file) => isVideo(post.media?.find((item) => item.id === file)))) {
      throw new DapiError("wrong-kind", "YouTube needs a video. This post has pictures.");
    }
  }
  // A file still on its way up from a browser can't be sent from here.
  const files = new Set([...post.platforms.flatMap((platform) => filesFor(post, platform)), ...(post.thread ?? []).flatMap((reply) => reply.files ?? [])]);
  if ([...files].some((file) => !post.media?.find((item) => item.id === file)?.cloud)) {
    throw new DapiError("invalid-input", "Its files haven't reached plan.video's storage yet. Ask the user to open plan.video where the post was made, so they finish uploading, then try again.");
  }

  const warnings: string[] = [];
  let base = row.version;
  const save = async (next: PostData) => {
    const saved = await session.store.save(scope, next, base);
    if ("conflict" in saved) throw new DapiError("busy", CONFLICT);
    base = saved.version;
    post = next;
  };
  if (toProfile(post.platforms, post.tiktok)) {
    const attached = savedMedia(post);
    const checked = await tiktokYes(session, post.accounts, post.tiktok, mediaOn(attached.shared, attached.own)("tiktok"), agreed, "agreed");
    warnings.push(...checked.warnings);
    if (checked.warnings.length) await save({ ...post, tiktok: checked.tiktok });
  }

  // A future post moves to now so the calendar shows where it went out, as Post now does in the app. A miss puts
  // that time back. A repeat stays on its days.
  const before = { day: post.day, start: post.start, allDay: post.allDay };
  const zone = post.timeZone || scope.timeZone;
  const at = momentOf(post.day, post.allDay ? "00:00" : post.start, zone);
  const failedBefore = Object.values(row.deliveries ?? {}).some((delivery) => delivery?.state === "failed");
  const shift = !post.recurrence && !failedBefore && !!at && at.getTime() > session.now;
  if (shift) await save({ ...post, day: dayKeyAt(session.now, zone), start: clockAt(session.now, zone), allDay: false });

  const handed = await session.store.send(id);
  const targets = handed.filter((delivery) => PUBLISHES.has(delivery.platform) && delivery.state !== "sent");
  const missing = targets.filter((delivery) => delivery.connection_id === "none");
  let latest = await postById(session, id);
  const settled = (current: PostRow) =>
    targets.every((delivery) => ["sent", "failed"].includes(current.deliveries[delivery.platform]?.state ?? "") || delivery.connection_id === "none");
  for (let waited = 0; !settled(latest) && waited < SEND_WAIT_MS; waited += SEND_LOOK_MS) {
    await session.options.sleep(SEND_LOOK_MS);
    latest = await postById(session, id);
  }
  const failed = missing.length > 0 || targets.some((delivery) => latest.deliveries[delivery.platform]?.state === "failed");
  if (!failed && !settled(latest)) return viewOf(session, latest, [...warnings, "It's still going out. Check with list_posts in a minute: don't publish it again."]);
  if (!failed) return viewOf(session, latest, warnings);
  if (shift && latest.data.status !== "posted") {
    const back = await session.store.save(scope, { ...latest.data, ...before }, latest.version);
    if ("conflict" in back) warnings.push("Its time couldn't be put back, so it shows at the time it was tried.");
  }
  const reasons = [...missing.map((delivery) => `${platformName(delivery.platform)}: ${delivery.error ?? "no login to send with."}`), deliveryErrors(latest)];
  throw new DapiError("unsupported", [...new Set(reasons)].join(" "));
}

/** What the post's link shows, as the tab's snapshotOf makes it, with the files that have a cloud copy. */
function snapshotOf(session: Session, post: PostData) {
  const files = (post.files ?? (post.media?.some((item) => item.id === post.id) ? [post.id] : []))
    .map((id) => post.media?.find((item) => item.id === id))
    .filter((file): file is FileDetails => !!file?.cloud);
  const captions = ownCaptions(post);
  return {
    title: post.title,
    caption: post.description ?? "",
    ...(Object.keys(captions).length ? { captions } : {}),
    platforms: post.platforms.map((id) => {
      const accounts = accountsFor(session.scope, id, post.accounts);
      return { id, name: platformName(id), handles: accounts.map((account) => account.handle), avatars: accounts.map(() => "") };
    }),
    day: post.day,
    start: post.start,
    allDay: post.allDay,
    timeZone: post.timeZone ?? null,
    status: post.status === "scheduled" ? "draft" : post.status,
    media: files[0] ? (isVideo(files[0]) ? "video" : "image") : null,
    ...(files.length && (files.length > 1 || files[0]!.id !== post.id) ? { files: files.map((file) => file.id) } : {}),
    ...(post.story ? { story: true } : {}),
    youtubeTitle: post.youtube?.title || null,
    ...(post.platforms.includes("pinterest") && post.pinterest?.title ? { pinterestTitle: post.pinterest.title } : {}),
    ...(!post.story && post.thread?.some((reply) => reply.text.trim()) ? { thread: post.thread.flatMap((reply) => (reply.text.trim() ? [reply.text] : [])) } : {}),
    link: post.link,
    workspaceId: session.scope.workspace,
  };
}

async function askForApproval(session: Session, { id }: ToolArgs<"ask_for_approval">) {
  const row = await postById(session, id);
  if (row.data.status === "posted") throw new DapiError("invalid-input", "This post has already gone out.");
  const asked = await session.store.askApproval(session.scope, id, row.version, snapshotOf(session, row.data));
  if ("conflict" in asked) throw new DapiError("busy", CONFLICT);
  return { ...viewOf(session, await postById(session, id)), approvalLink: `${session.options.site}/p/${asked.preview}` };
}
