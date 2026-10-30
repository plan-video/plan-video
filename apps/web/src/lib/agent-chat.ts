/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The dashboard's Assistant: a chat that writes and schedules posts. Each step goes
// to services/agent, which holds the model; the tools it asks for run here
// (see ./agent-tools), and the browser loops until it answers. Chats are kept
// per workspace, so an earlier one can be opened again: in this browser, and
// on the account when the agent_chats table is there, which is the copy other
// browsers see.

import { openDB, type IDBPDatabase } from "idb";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";

import { track } from "@/lib/analytics";
import { CHANGING_TOOLS, mediaReference, runAgentTool } from "@/lib/agent-tools";
import { t } from "@/lib/i18n";
import { formatDuration, PLATFORM_IDS, socialPlatform, type PlatformId } from "@/lib/social";
import { socialConnections } from "@/lib/social-connections";
import { supabase } from "@/lib/supabase";
import { timeZone } from "@/lib/time-zone";
import { activeWorkspaceId, onWorkspaceChange, workspaceDatabase, workspaceKey, workspaceOwner } from "@/lib/workspaces";

import type { User } from "@supabase/supabase-js";
import type { ConfirmRequest } from "@/lib/agent-confirm";
import type { MediaItem } from "@/lib/media-library";

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
/** Thinking and the rest are sent back exactly as they came. */
type OtherBlock = { type: string; [key: string]: unknown };
type Block = TextBlock | ToolUseBlock | ToolResultBlock | OtherBlock;
/** `sig` is the server's signature on a step the model wrote; the server won't take the step back without it. */
type ApiMessage = { role: "user" | "assistant"; content: Block[]; sig?: string };

export type Rating = "up" | "down";
export type ChatSummary = { id: string; title: string; updatedAt: string };

/** What the chat shows: each message sent, and the answer to it. */
export type ChatItem =
  | { kind: "user"; text: string; media: string[] }
  | { kind: "answer"; key: string; parts: AnswerPart[]; changed: boolean };

export type AnswerPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; status: "running" | "done" | "error" };

/** A post the agent wants to publish, delete, send within minutes or put on a TikTok profile, as the person is asked about it. */
export type Confirmation = ConfirmRequest;

type State = {
  list: ChatSummary[];
  listLoaded: boolean;
  /** Null until the first message: a new chat isn't saved empty. */
  id: string | null;
  title: string;
  messages: ApiMessage[];
  feedback: Record<string, Rating>;
  busy: boolean;
  opening: boolean;
  /** The step being written: its words so far, and the tool it's calling. */
  live: { text: string; tool: string | null };
  /** Set while a call waits for the person's yes. */
  confirm: Confirmation | null;
  error: string | null;
};

const ENDPOINT = "/api/agent";
const TABLE = "agent_chats";
/** Stops a runaway turn: plenty for a month of posts, not enough to loop for long. */
const MAX_STEPS = 30;
const CONTEXT_OPEN = "<context>";

const [state, setState] = createStore<State>({
  list: [],
  listLoaded: false,
  id: null,
  title: "",
  messages: [],
  feedback: {},
  busy: false,
  opening: false,
  live: { text: "", tool: null },
  confirm: null,
  error: null,
});

export { state as agentChat };

let user: User | null = null;
let loadedFor: string | undefined;
let controller: AbortController | null = null;
/** Once the table turns out to be missing, chats are kept in this browser only. */
let historyOff = false;

// --- the page in view ----------------------------------------------------

/** The dashboard page the panel was opened over, by its English name. Null on the Assistant page. */
let openPage: string | null = null;

/** Called by the corner panel, so "this" and "here" in a message can be read against the page. */
export function setAssistantPage(page: string | null) {
  openPage = page;
}

// --- the message being written ------------------------------------------

/**
 * The words in the box and the media inserted for them. Kept here rather than
 * in the box, so the panel and the page show one draft: opening the full page
 * from the panel brings it along, and sending from either clears both.
 */
const [draftText, setDraftText] = createSignal("");
const [draftMedia, setDraftMedia] = createSignal<MediaItem[]>([]);

export { draftMedia, draftText, setDraftMedia, setDraftText };

// --- channels -------------------------------------------------------------

const [picked, setPicked] = createSignal<string[]>([]);
let pickedKey: string | undefined;

/** The channels the agent writes for, by connection id. */
export function pickedChannels(): string[] {
  const connected = new Set(socialConnections().map((account) => account.id));
  return picked().filter((id) => connected.has(id));
}

export function toggleChannel(id: string) {
  setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  if (!pickedKey) return;
  try {
    localStorage.setItem(pickedKey, JSON.stringify(picked()));
  } catch {
    // Kept for this visit.
  }
}

function loadPicked(userId: string) {
  pickedKey = workspaceKey("plan.video.agent-channels", userId);
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(pickedKey) ?? "[]");
    setPicked(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    setPicked([]);
  }
}

// --- history --------------------------------------------------------------

/** A saved chat, the same in this browser and in the agent_chats table. */
type ChatRow = {
  id: string;
  user_id: string;
  workspace: string;
  title: string;
  messages: ApiMessage[];
  feedback: Record<string, Rating>;
  updated_at: string;
};

const LOCAL_DB = "plan-video-agent-chats";
const LOCAL_STORE = "chats";
const databases = new Map<string, Promise<IDBPDatabase | null>>();

/** This workspace's chats in this browser. Null where IndexedDB is refused, such as some private windows. */
function localChats(): Promise<IDBPDatabase | null> {
  const name = workspaceDatabase(LOCAL_DB);
  let database = databases.get(name);
  if (!database) {
    database = openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore(LOCAL_STORE, { keyPath: "id" });
      },
    }).catch((error: unknown) => {
      console.warn("[agent] chats in this browser:", error);
      return null;
    });
    databases.set(name, database);
  }
  return database;
}

async function localRows(userId: string): Promise<ChatRow[]> {
  const db = await localChats();
  const rows = ((await db?.getAll(LOCAL_STORE).catch(() => [])) ?? []) as ChatRow[];
  return rows.filter((row) => row.user_id === userId);
}

/**
 * YouTube's rules let plan.video keep what it read from YouTube for 30 days,
 * so a chat whose Analytics answer included a YouTube channel is deleted 30
 * days after its last message, here and (services/publisher) on the account.
 */
export const YOUTUBE_CHAT_DAYS = 30;

/** Whether the chat holds YouTube numbers or video titles the Analytics tool returned. */
export function chatHoldsYouTube(messages: readonly ApiMessage[]): boolean {
  const analytics = new Set<string>();
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_use" && (block as ToolUseBlock).name === "analytics") analytics.add((block as ToolUseBlock).id);
      if (block.type === "tool_result" && analytics.has((block as ToolResultBlock).tool_use_id) && /"platform":\s*"youtube"/.test(String((block as ToolResultBlock).content))) return true;
    }
  }
  return false;
}

const expired = (row: ChatRow) => Date.now() - Date.parse(row.updated_at) > YOUTUBE_CHAT_DAYS * 24 * 60 * 60 * 1000 && chatHoldsYouTube(row.messages ?? []);

async function localRow(id: string): Promise<ChatRow | undefined> {
  const db = await localChats();
  return ((await db?.get(LOCAL_STORE, id).catch(() => undefined)) ?? undefined) as ChatRow | undefined;
}

function historyFailed(error: { code?: string; message?: string }) {
  // The migration hasn't been applied: chats are kept in this browser only.
  if (error.code === "42P01" || error.code === "PGRST205") historyOff = true;
  console.warn("[agent] chat history:", error.message);
}

const remoteOn = () => !!supabase && !!user && !historyOff;
/** Of two copies of a chat, the one saved last. */
function newer<T extends { updated_at: string }>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a || !b) return a ?? b;
  return Date.parse(b.updated_at) > Date.parse(a.updated_at) ? b : a;
}

function freshChat() {
  setState({ id: null, title: "", messages: [], feedback: {}, live: { text: "", tool: null }, confirm: null, error: null });
}

/** Loads the chats of the user's active workspace. Reads the workspace, so an effect reloads after a switch. */
export function loadAgentChats(current: User | null | undefined) {
  user = current ?? null;
  const key = user ? `${user.id}:${activeWorkspaceId()}` : undefined;
  if (key === loadedFor) return;
  loadedFor = key;
  controller?.abort();
  freshChat();
  // Media comes from the workspace's own library, so a draft doesn't follow to another one.
  setDraftText("");
  setDraftMedia([]);
  setState({ list: [], listLoaded: false });
  if (!user) return;
  loadPicked(user.id);
  void fetchList(key!);
}

onWorkspaceChange(() => {
  // Another person signed in: these chats go, and theirs load when the agent opens for them.
  if (user && user.id !== workspaceOwner()) {
    loadAgentChats(null);
    return;
  }
  loadedFor = undefined;
  loadAgentChats(user);
});

/** The chats in this browser and on the account, together, newest first. */
async function fetchList(key: string) {
  if (!user) return;
  const userId = user.id;
  const workspace = activeWorkspaceId();
  const byId = new Map<string, { id: string; title: string; updated_at: string }>();
  for (const row of await localRows(userId)) {
    if (!expired(row)) byId.set(row.id, row);
    else void localChats().then((db) => db?.delete(LOCAL_STORE, row.id).catch(() => undefined));
  }

  if (remoteOn()) {
    const { data, error } = await supabase!
      .from(TABLE)
      .select("id, title, updated_at")
      .eq("user_id", userId)
      .eq("workspace", workspace)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) historyFailed(error);
    for (const row of (data ?? []) as { id: string; title: string; updated_at: string }[]) byId.set(row.id, newer(byId.get(row.id), row)!);
  }
  if (key !== loadedFor) return;

  const list = [...byId.values()]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }));
  // A chat saved while the list loaded is already on it, and stays.
  setState("list", (current) => [...current, ...list.filter((row) => !current.some((chat) => chat.id === row.id))]);
  setState("listLoaded", true);
}

let saving: Promise<void> = Promise.resolve();

/** Saves the open chat. Calls run in order, so an older copy never lands last. */
function save() {
  const id = state.id;
  if (!id || !user) return;
  const row: ChatRow = {
    id,
    user_id: user.id,
    workspace: activeWorkspaceId(),
    title: state.title,
    messages: JSON.parse(JSON.stringify(state.messages)) as ApiMessage[],
    feedback: { ...state.feedback },
    updated_at: new Date().toISOString(),
  };
  const database = localChats();
  saving = saving.then(async () => {
    const db = await database;
    await db?.put(LOCAL_STORE, row).catch((error: unknown) => console.warn("[agent] couldn't keep the chat in this browser:", error));
    if (!remoteOn()) return;
    const { error } = await supabase!.from(TABLE).upsert(row);
    if (error) historyFailed(error);
  });
  setState("list", (list) => [{ id, title: row.title, updatedAt: row.updated_at }, ...list.filter((chat) => chat.id !== id)]);
}

export function newAgentChat() {
  if (state.busy) return;
  freshChat();
}

export async function openAgentChat(id: string) {
  if (state.busy || state.id === id || !user) return;
  setState({ opening: true, error: null });
  // Whatever is still being written lands first, so the copy read is the latest.
  await saving;
  let row: Pick<ChatRow, "id" | "title" | "messages" | "feedback" | "updated_at"> | undefined = await localRow(id);
  if (remoteOn()) {
    const { data, error } = await supabase!.from(TABLE).select("id, title, messages, feedback, updated_at").eq("id", id).maybeSingle();
    if (error) historyFailed(error);
    row = newer(row, (data as ChatRow | null) ?? undefined);
  }
  setState("opening", false);
  if (!row) {
    setState("error", t("That chat couldn't be opened."));
    return;
  }
  setState({
    id: row.id,
    title: row.title,
    messages: row.messages ?? [],
    feedback: row.feedback ?? {},
    live: { text: "", tool: null },
    error: null,
  });
}

export async function deleteAgentChat(id: string) {
  if (state.busy && state.id === id) return;
  setState("list", (list) => list.filter((chat) => chat.id !== id));
  if (state.id === id) freshChat();
  await saving;
  const db = await localChats();
  await db?.delete(LOCAL_STORE, id).catch(() => undefined);
  if (!remoteOn()) return;
  const { error } = await supabase!.from(TABLE).delete().eq("id", id);
  if (error) historyFailed(error);
}

export function rateAnswer(key: string, rating: Rating) {
  const next = state.feedback[key] === rating ? undefined : rating;
  setState("feedback", produce((feedback) => {
    if (next) feedback[key] = next;
    else delete feedback[key];
  }));
  if (next) track("agent_feedback", { rating: next });
  save();
}

// --- what the chat shows --------------------------------------------------

const isText = (block: Block): block is TextBlock => block.type === "text" && typeof (block as TextBlock).text === "string";
const isContext = (block: TextBlock) => block.text.startsWith(CONTEXT_OPEN);
const MEDIA_ID = /^media:(\S+)/gm;

/** The conversation as messages sent and answers, with each tool call's outcome. */
export function chatItems(): ChatItem[] {
  const items: ChatItem[] = [];
  const outcome = new Map<string, boolean>();
  for (const message of state.messages) {
    if (message.role !== "user") continue;
    for (const block of message.content) {
      if (block.type === "tool_result") outcome.set((block as ToolResultBlock).tool_use_id, !!(block as ToolResultBlock).is_error);
    }
  }

  let media: string[] = [];
  state.messages.forEach((message, index) => {
    if (message.role === "user") {
      for (const block of message.content) {
        if (!isText(block)) continue;
        if (isContext(block)) media = [...block.text.matchAll(MEDIA_ID)].map((match) => match[1]!);
        else {
          items.push({ kind: "user", text: block.text, media });
          media = [];
        }
      }
      return;
    }
    let answer = items[items.length - 1];
    if (answer?.kind !== "answer") {
      answer = { kind: "answer", key: String(index), parts: [], changed: false };
      items.push(answer);
    }
    for (const block of message.content) {
      if (isText(block) && block.text.trim()) answer.parts.push({ kind: "text", text: block.text });
      else if (block.type === "tool_use") {
        const call = block as ToolUseBlock;
        const failed = outcome.get(call.id);
        answer.parts.push({ kind: "tool", name: call.name, status: failed === undefined ? "running" : failed ? "error" : "done" });
        if (failed === false && CHANGING_TOOLS.has(call.name)) answer.changed = true;
      }
    }
  });
  return items;
}

// --- sending --------------------------------------------------------------

function channelLine(): string {
  const chosen = pickedChannels()
    .map((id) => socialConnections().find((account) => account.id === id))
    .flatMap((account) => {
      if (!account) return [];
      const platform = (PLATFORM_IDS as readonly string[]).includes(account.platform) ? socialPlatform(account.platform as PlatformId).name : account.platform;
      return [`${platform} @${account.handle} (account id ${account.id})`];
    });
  return `Picked channels: ${chosen.length ? chosen.join("; ") : "none"}`;
}

function contextBlock(media: readonly MediaItem[]): string {
  const zone = timeZone();
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  const lines = [`Now: ${now} (${zone})`, channelLine()];
  if (openPage) lines.push(`Open page: ${openPage} (they wrote from the Assistant panel over it)`);
  for (const item of media) {
    const length = item.kind === "video" ? `, ${formatDuration(item.duration)}` : "";
    lines.push(`${mediaReference(item.id)} ${item.kind}${length}, ${item.width}x${item.height}, "${item.name}"`);
  }
  return `${CONTEXT_OPEN}\n${lines.join("\n")}\n</context>`;
}

function titleOf(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line || t("New chat");
}

type Step = { content: Block[]; stop_reason: string | null; sig?: string };
type Line = { type: "text"; text: string } | { type: "tool"; name: string } | ({ type: "done" } & Step) | { type: "error"; error: string };

/** One model step, streamed: its words show as they come. */
async function ask(signal: AbortSignal): Promise<Step> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new Error(t("Sign in to use the Assistant."));

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ messages: state.messages }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(t("The Assistant couldn't be reached. Check your connection and try again."));
  }
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || t("The Assistant answered {status}.", { status: response.status }));
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const raw = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!raw) continue;
      const line = JSON.parse(raw) as Line;
      if (line.type === "text") setState("live", "text", (text) => text + line.text);
      else if (line.type === "tool") setState("live", "tool", line.name);
      else if (line.type === "error") throw new Error(line.error);
      else if (line.type === "done") return { content: line.content, stop_reason: line.stop_reason, sig: line.sig };
    }
  }
  throw new Error(t("The Assistant stopped answering. Try again."));
}

function pushResult(result: ToolResultBlock, first: boolean) {
  setState("messages", produce((messages) => {
    if (first) messages.push({ role: "user", content: [result] });
    else messages[messages.length - 1]!.content.push(result);
  }));
}

let answerConfirm: ((yes: boolean) => void) | null = null;

/** The person's answer to the call waiting in the chat. */
export function confirmAgentAction(yes: boolean) {
  answerConfirm?.(yes);
}

/** Shows the post a call is about, and waits for a yes or a no. Stopping the turn is a no. */
async function confirmInChat(request: ConfirmRequest, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  setState("confirm", request);
  try {
    return await new Promise<boolean>((resolve) => {
      answerConfirm = resolve;
      signal.addEventListener("abort", () => resolve(false), { once: true });
    });
  } finally {
    answerConfirm = null;
    setState("confirm", null);
  }
}

/** Runs the turn to its end: every tool the model asks for, until it answers. */
async function run() {
  const running = new AbortController();
  controller = running;
  const { signal } = running;
  const chat = state.id;
  setState({ busy: true, error: null, live: { text: "", tool: null } });
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await ask(signal);
      // Another workspace was opened meanwhile, and this chat closed with it.
      if (state.id !== chat) return;
      setState("live", { text: "", tool: null });
      if (reply.stop_reason === "refusal") {
        setState("error", t("The Assistant can't help with that one. Try asking another way."));
        break;
      }
      if (!reply.content.length) break;
      setState("messages", (messages) => [...messages, { role: "assistant", content: reply.content, sig: reply.sig }]);

      const calls = reply.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
      if (!calls.length) break;
      // A call cut off by the length limit may be missing arguments: none of them run.
      const cutOff = reply.stop_reason === "max_tokens";
      for (const [index, call] of calls.entries()) {
        if (cutOff || signal.aborted) {
          const text = cutOff ? "The reply was cut off before this call was complete. It didn't run." : "Stopped by the person before it ran.";
          pushResult({ type: "tool_result", tool_use_id: call.id, content: text, is_error: true }, index === 0);
          continue;
        }
        // Publishing, deleting, a post due within minutes or one for a TikTok profile waits for the person's yes.
        const output = await runAgentTool(call.name, call.input, { user: () => user, signal, confirm: (request) => confirmInChat(request, signal) });
        if (state.id !== chat) return;
        pushResult({ type: "tool_result", tool_use_id: call.id, content: output.text, ...(output.error ? { is_error: true } : {}) }, index === 0);
      }
      save();
      if (cutOff) {
        setState("error", t("The answer ran too long and stopped. Ask for fewer posts at once."));
        break;
      }
      if (signal.aborted) break;
      if (step === MAX_STEPS - 1) setState("error", t("This took too many steps, so it stopped. Ask again to carry on."));
    }
  } catch (error) {
    if (!signal.aborted) setState("error", (error as Error).message || t("Something went wrong."));
  } finally {
    if (controller === running) controller = null;
    setState({ busy: false, live: { text: "", tool: null } });
    save();
  }
}

/** Sends a message with the media inserted for it, and runs the turn. */
export async function sendToAgent(text: string, media: readonly MediaItem[] = []) {
  const prompt = text.trim() || (media.length ? "Use the attached media." : "");
  if (!prompt || state.busy || !user) return;
  const content: TextBlock[] = [
    { type: "text", text: contextBlock(media) },
    { type: "text", text: prompt },
  ];
  setState(produce((draft) => {
    const last = draft.messages[draft.messages.length - 1];
    // A chat closed while a tool ran has calls without results; the model needs each one answered.
    if (last?.role === "assistant") {
      const open = last.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
      if (open.length) {
        draft.messages.push({
          role: "user",
          content: open.map((call) => ({ type: "tool_result", tool_use_id: call.id, content: "It didn't run: the chat was closed first.", is_error: true })),
        });
      }
    }
    const end = draft.messages[draft.messages.length - 1];
    // A turn that stopped after its tool results already ends on the person's side.
    if (end?.role === "user") end.content.push(...content);
    else draft.messages.push({ role: "user", content });
    if (!draft.id) {
      draft.id = crypto.randomUUID();
      draft.title = titleOf(prompt);
    }
  }));
  track("agent_message", { media: media.length });
  await run();
}

/** Runs the turn again after it failed before any answer came. */
export async function retryAgent() {
  if (state.busy || state.messages[state.messages.length - 1]?.role !== "user") return;
  await run();
}

/** Writes the last answer again. Only offered when that answer changed nothing on the calendar. */
export async function regenerateLast() {
  if (state.busy) return;
  const items = chatItems();
  const last = items[items.length - 1];
  if (last?.kind !== "answer" || last.changed) return;
  const from = Number(last.key);
  setState(produce((draft) => {
    draft.messages.splice(from);
    for (const key of Object.keys(draft.feedback)) if (Number(key) >= from) delete draft.feedback[key];
  }));
  await run();
}

export function stopAgent() {
  controller?.abort();
}
