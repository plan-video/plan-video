/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The posting tools agents call at plan.video/mcp, run by services/mcp with no plan.video tab open. They keep the
// tab's rules (lib/post-rules) and save over the version read, as a browser does. What needs the person there
// (publishing now, deleting, a post due within minutes, TikTok's terms) is handed to their tab instead.

import { DapiError, isDapiError, listMediaTool, toolByName, type ToolArgs, type ToolName } from "@plan.video/dapi";

import { isDateKey, newId, resolveRepeatEnd } from "@/components/calendar/utils";
import { CONFIRM_LEAD_MS } from "@/lib/agent-confirm";
import { inEnglish } from "@/lib/i18n";
import { FREE_SCHEDULED_PER_ACCOUNT } from "@/lib/plans";
import {
  assertFits,
  clock,
  definedOnly,
  isPlatform,
  keptAccountIds,
  mergeAccountChoices,
  pickAccounts,
  postTitle,
  postViewOf,
  readChoices,
  refuseSoon,
  removedAccountNotes,
  repeatOf,
  requireTikTok,
  scheduleProblem,
  socialSchemaView,
  threadOf,
  tiktokOf,
  toProfile,
  youtubeOf,
  PUBLISHES,
} from "@/lib/post-rules";
import { isAspect, sortPlatforms, type MediaSummary, type PlatformId, type PostKind, type YouTubePostSettings } from "@/lib/social";
import { dayKeyAt, momentOf } from "@/lib/time-zone";

import type { Delivery, StoredEvent } from "@/components/calendar/types";
import type { AccountChoices } from "@/lib/social-connections";

export type AgentAccount = { id: string; platform: string; handle: string; ready: boolean };

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
  timeZone: string;
  calendarId: string;
  connections: AgentAccount[];
  library: LibraryItem[];
};

/** As post-sync-core's AccountMedia: what a browser needs to fetch a post's file. */
export type FileDetails = { id: string; name: string; type: string; lastModified: number; cloud?: { key: string; at: string } };

export type PostData = StoredEvent & { media?: FileDetails[] };

export type PostRow = { id: string; version: number; data: PostData; deliveries: Partial<Record<string, { state: string; error?: string }>> };

export type PostFilter = { id?: string; status?: string; from?: string; to?: string };

/** A file copied onto a post, from the library (`media/<id>`) or another post (`posts/<id>`). */
export type FileCopy = { from: string; to: string };

/** An error with `tab: true` hands the call to the person's tab, as when the server can't do it yet. */
export interface PostingStore {
  context(): Promise<AgentContext>;
  posts(scope: AgentContext, filter: PostFilter): Promise<PostRow[]>;
  save(scope: AgentContext, post: PostData, base: number | null): Promise<{ version: number } | { conflict: true }>;
  copyFiles(scope: AgentContext, copies: FileCopy[]): Promise<void>;
}

/** `tab` says why only the person's open plan.video can do it. */
export type ToolOutcome = { text: string; error: boolean } | { tab: string };

const IN_TAB: Record<string, string> = {
  publish_post: "Publishing now waits for the user's yes in plan.video.",
  delete_post: "Deleting a post waits for the user's yes in plan.video.",
  tiktok_creator: "TikTok's account details are read through plan.video in the browser.",
  analytics: "Analytics are read in plan.video in the browser.",
};

const SOON = `A post due within ${CONFIRM_LEAD_MS / 60_000} minutes waits for the user's yes in plan.video. Schedule it later than that to save it without them.`;
const TIKTOK_TERMS = "Posting to the TikTok profile waits for the user's yes to TikTok's terms in plan.video. Pass tiktok.inbox true to send it to their TikTok inbox instead, or save it with draft true.";

/** As calendar/store counts the Free plan's waiting posts. */
const GOING_OUT_MS = 5 * 60_000;
const SCHEDULED_LIMIT = "On the Free plan, each account can have 10 scheduled posts waiting at a time. Upgrade for unlimited posts.";
const CONFLICT = "The post changed in plan.video while this was saved, so nothing was changed. Read it again with list_posts and try again.";

class InTab extends Error {}

type Attached = { from: string[]; names: { name: string; type: string; lastModified: number }[]; kind: PostKind; media: MediaSummary };

type Session = { scope: AgentContext; store: PostingStore; now: number };

const SERVER_TOOLS = new Set(["social_accounts", "social_schema", "list_media", "list_posts", "schedule_post", "copy_post", "update_post"]);

export function createPostingTools(store: PostingStore, options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  return {
    handles: (name: string) => SERVER_TOOLS.has(name) || Object.hasOwn(IN_TAB, name),

    async run(name: string, input: unknown): Promise<ToolOutcome> {
      if (Object.hasOwn(IN_TAB, name)) return { tab: IN_TAB[name]! };
      if (!SERVER_TOOLS.has(name)) return { text: `There is no tool named ${name}.`, error: true };
      const schema = name === listMediaTool.name ? listMediaTool.input : toolByName(name as ToolName).input;
      const parsed = schema.safeParse(input ?? {});
      if (!parsed.success) {
        const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
        return { text: `The arguments don't fit ${name}: ${problems}`, error: true };
      }
      try {
        if (name === "social_schema") return { text: JSON.stringify(socialSchemaView((parsed.data as ToolArgs<"social_schema">).platform)), error: false };
        const session: Session = { scope: await store.context(), store, now: now() };
        const output = await HANDLERS[name as keyof typeof HANDLERS](session, parsed.data as never);
        return { text: JSON.stringify(output), error: false };
      } catch (error) {
        if (error instanceof InTab || (error as { tab?: unknown } | null)?.tab === true) return { tab: (error as Error).message };
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

/** The checks that need the person: anything going out within minutes, or a yes to TikTok's terms. */
function refuseUnseen(session: Session, scheduled: boolean, at: Date | null, tiktokYes: boolean) {
  if (!scheduled) return;
  if (!at || at.getTime() - session.now < CONFIRM_LEAD_MS) throw new InTab(SOON);
  if (tiktokYes) throw new InTab(TIKTOK_TERMS);
}

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
  const tiktok = platforms.includes("tiktok") ? tiktokOf(args.tiktok) : undefined;
  requireTikTok(platforms, tiktok, scheduling);
  const warnings = assertFits({ kind: kindOf(shared, own), platforms, caption, title: youtube?.title || title, media });
  refuseUnseen(session, scheduling, when, scheduling && toProfile(platforms, tiktok));
  const { repeat, repeatEnd } = repeatOf(args.repeat, day);
  const thread = threadOf(args.thread, platforms);

  const id = newId();
  const recurrence = repeat || null;
  const post: PostData = withOwnCaptions(
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
  );
  await refuseOverLimit(session, post);
  // Files last of all the checks: a copy can't be taken back.
  if (shared || Object.keys(own).length) Object.assign(post, await copyOnto(session, id, shared, own));
  const row = await written(session, post, null);
  return viewOf(session, row, warnings);
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
  if (args.draft === true) status = "draft";
  else if (args.draft === false) status = "scheduled";
  else if (args.day !== undefined && args.time !== undefined && existing.status === "draft") status = "scheduled";
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
  const tiktok = platforms.includes("tiktok") ? tiktokOf(args.tiktok, existing.tiktok) : undefined;
  requireTikTok(platforms, tiktok, status === "scheduled");
  const warnings = [
    ...assertFits({ kind: kindOf(attached.shared, attached.own), platforms, caption, own, title: youtube?.title || title, media }),
    ...removedAccountNotes(connected(scope), platforms, choices),
  ];
  // A post already set to go to the profile was agreed to; one newly headed there, or with new answers, needs a yes again.
  const agreedBefore = existing.status === "scheduled" && toProfile(existing.platforms, existing.tiktok);
  const tiktokChanged = args.tiktok?.privacy !== undefined || args.tiktok?.promotion !== undefined || args.tiktok?.inbox !== undefined || args.accounts !== undefined;
  const tiktokYes = status === "scheduled" && toProfile(platforms, tiktok) && (!agreedBefore || tiktokChanged);
  refuseUnseen(session, status === "scheduled", at, tiktokYes);
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
  const revised = withOwnCaptions(next, own);
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
  return viewOf(session, saved, warnings);
}
