/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Module-level so it outlives any page. Host-owned data (chats, transcripts, questions) is a view here;
// only drafts, the open tab and each project's active chat are ours.

import { batch, createRoot, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { toast } from "somoto";

import {
  AgentChatError,
  emptyTranscript,
  reduce,
  type ChatEvent,
  type ChatSnapshot,
  type ChatSummary,
  type HarnessInfo,
  type Item,
  type ModelRef,
  type RequestResponse,
  type ConnectionState,
} from "@plan.video/agent-chat";
import type { Transcript } from "@plan.video/agent-chat";

import { store as settings } from "@/init";
import { t } from "@/lib/i18n";
import { createStoredSignal } from "@/lib/store";
import { projectRoute } from "@/hooks/use-project-route";
import type { ProjectInfo } from "@/projects";

import { attachmentFromPath, attachmentPaths, type Attachment } from "./attachments";
import { client, hasHost } from "./connection";

export type SidebarTab = "assets" | "workflows" | "text" | "transitions" | "effects" | "templates" | "extensions";

export type Draft = { text: string; attachments: Attachment[] };

export const draftKey = (projectId: string, chatId: string | null): string => chatId ?? `new:${projectId}`;

type State = {
  connection: ConnectionState;
  harnesses: HarnessInfo[];
  chats: Record<string, Transcript>;
  // Newest first.
  lists: Record<string, ChatSummary[]>;
  drafts: Record<string, Draft>;
  sending: Record<string, Item | null>;
};

const EMPTY_DRAFT: Draft = { text: "", attachments: [] };
const PROBE_MAX_AGE_MS = 60_000;
const CONNECT_TIMEOUT_MS = 4000;

const [state, setState] = createStore<State>({
  connection: "closed",
  harnesses: [],
  chats: {},
  lists: {},
  drafts: {},
  sending: {},
});

export { state as chatState };

const root = createRoot(() => {
  const [tab, setTab] = createSignal<SidebarTab>("assets");
  const [model, setModel] = createStoredSignal(settings.define<ModelRef | null>("agentChat.model", null));
  const [active, setActive] = createStoredSignal(settings.define<Record<string, string>>("agentChat.active", {}));
  return { tab, setTab, model, setModel, active, setActive };
});

// Not remembered: every project opens on Assets.
export const sidebarTab = root.tab;
export const setSidebarTab = root.setTab;

export const storedModel = root.model;
export const setStoredModel = root.setModel;

const DRAFT = "";

export function activeChatId(projectId: string): string | null {
  const remembered = root.active()[projectId];
  if (remembered === DRAFT) return null;
  if (remembered && (state.chats[remembered] || state.lists[projectId]?.some((chat) => chat.id === remembered))) return remembered;
  return state.lists[projectId]?.[0]?.id ?? null;
}

export function setActiveChat(projectId: string, chatId: string | null): void {
  root.setActive({ ...root.active(), [projectId]: chatId ?? DRAFT });
}

let connected = false;
let harnessesAt = 0;

export function ensureConnected(): void {
  if (connected) return;
  connected = true;
  client.onState((connection) => setState("connection", connection));
  client.onHarnesses((harnesses) => {
    harnessesAt = Date.now();
    setState("harnesses", harnesses);
  });
  setState("connection", hasHost() ? "connecting" : "unavailable");
  if (hasHost()) client.connect();
}

function whenOpen(): Promise<void> {
  ensureConnected();
  if (client.state === "open") return Promise.resolve();
  if (!hasHost()) return Promise.reject(new AgentChatError("disconnected", t("Chat isn't available in the browser")));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new AgentChatError("disconnected", t("The agent host is not running")));
    }, CONNECT_TIMEOUT_MS);
    const stop = client.onState((connection) => {
      if (connection !== "open") return;
      clearTimeout(timer);
      stop();
      resolve();
    });
  });
}

export function refreshHarnesses(): void {
  if (client.state !== "open" || Date.now() - harnessesAt < PROBE_MAX_AGE_MS) return;
  harnessesAt = Date.now();
  void client.request("harnesses.list", { refresh: true }).catch(() => {});
}

export const readyHarnesses = (): HarnessInfo[] => state.harnesses.filter((harness) => harness.status === "ready");

const PREFERRED_MODELS = [/astra/i, /sol/i, /fable/i, /opus/i];

export function currentModel(): ModelRef | null {
  const ready = readyHarnesses();
  const remembered = root.model();
  if (remembered) {
    const harness = ready.find((entry) => entry.id === remembered.harness);
    if (harness && harness.models.some((model) => model.id === remembered.model)) return remembered;
  }
  for (const pattern of PREFERRED_MODELS) {
    for (const harness of ready) {
      const match = harness.models.find((model) => pattern.test(model.id) || pattern.test(model.label));
      if (match) return { harness: harness.id, model: match.id };
    }
  }
  const first = ready[0];
  if (!first) return null;
  const model = first.defaultModel ?? first.models[0]?.id;
  return model ? { harness: first.id, model } : null;
}

export function modelLabel(ref: ModelRef | null): string {
  if (!ref) return t("No agent available");
  const harness = state.harnesses.find((entry) => entry.id === ref.harness);
  return harness?.models.find((model) => model.id === ref.model)?.label ?? ref.model;
}

const queue = new Map<string, ChatEvent[]>();
let flushScheduled = false;
const awaitingSnapshot = new Map<string, string>();

function flush(): void {
  flushScheduled = false;
  if (queue.size === 0) return;
  const pending = [...queue];
  queue.clear();
  batch(() => {
    for (const [chatId, events] of pending) {
      let transcript = state.chats[chatId] ?? emptyTranscript();
      for (const event of events) {
        transcript = reduce(transcript, event);
        if (event.type === "chat.updated") upsertSummary(event.chat);
        if (event.type === "turn.started") setState("sending", chatId, null);
      }
      setState("chats", chatId, transcript);
    }
  });
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(flush);
  // A hidden tab gets no frames; the timer keeps history and status honest.
  setTimeout(flush, 120);
}

function upsertSummary(chat: ChatSummary): void {
  setState(
    "lists",
    chat.projectId,
    produce((list) => {
      if (!list) return;
      const index = list.findIndex((entry) => entry.id === chat.id);
      if (index >= 0) list[index] = chat;
      else list.unshift(chat);
      list.sort((a, b) => b.updatedAt - a.updatedAt);
    }),
  );
  if (!state.lists[chat.projectId]) setState("lists", chat.projectId, [chat]);
}

const subscriptions = new Map<string, () => void>();

export function openChat(chatId: string): void {
  ensureConnected();
  if (subscriptions.has(chatId)) return;
  const unsubscribe = client.open(chatId, (message) => {
    if (message.type === "snapshot") {
      applySnapshot(message.snapshot);
      const key = awaitingSnapshot.get(chatId);
      if (key) {
        awaitingSnapshot.delete(chatId);
        setState("sending", key, null);
      }
      return;
    }
    const events = queue.get(chatId);
    if (events) events.push(message.event);
    else queue.set(chatId, [message.event]);
    scheduleFlush();
  });
  subscriptions.set(chatId, unsubscribe);
}

function applySnapshot(snapshot: ChatSnapshot): void {
  queue.delete(snapshot.chat.id);
  batch(() => {
    setState("chats", snapshot.chat.id, { items: snapshot.items, pending: snapshot.pending, turnId: null, chat: snapshot.chat });
    upsertSummary(snapshot.chat);
  });
}

export async function refreshChats(projectId: string): Promise<void> {
  try {
    await whenOpen();
    const list = await client.request("chats.list", { projectId });
    setState("lists", projectId, list);
  } catch {
    // Offline: whatever the store holds stays.
  }
}

export const draft = (key: string): Draft => state.drafts[key] ?? EMPTY_DRAFT;

export function setDraftText(key: string, text: string): void {
  setState("drafts", key, { ...draft(key), text });
}

export function setDraftAttachments(key: string, attachments: Attachment[]): void {
  setState("drafts", key, { ...draft(key), attachments });
}

export function clearDraft(key: string): void {
  setState("drafts", key, EMPTY_DRAFT);
}

export type SendOptions = {
  projectId: string;
  cwd: string;
  chatId: string | null;
  text: string;
  attachments: string[];
  model: ModelRef;
};

export async function send(options: SendOptions): Promise<string> {
  const key = draftKey(options.projectId, options.chatId);
  const optimistic: Item = {
    id: `optimistic-${Date.now()}`,
    kind: "user",
    text: options.text,
    ...(options.attachments.length ? { attachments: options.attachments } : {}),
  };
  setState("sending", key, optimistic);
  try {
    await whenOpen();
    const { chatId } = await client.request("turn.send", {
      ...(options.chatId ? { chatId: options.chatId } : {}),
      projectId: options.projectId,
      cwd: options.cwd,
      text: options.text,
      ...(options.attachments.length ? { attachments: options.attachments } : {}),
      model: options.model,
    });
    if (!options.chatId) {
      awaitingSnapshot.set(chatId, key);
      setActiveChat(options.projectId, chatId);
    }
    openChat(chatId);
    flush();
    if (options.chatId) setState("sending", key, null);
    return chatId;
  } catch (error) {
    setState("sending", key, null);
    throw error;
  }
}

export async function interrupt(chatId: string): Promise<void> {
  await client.request("turn.interrupt", { chatId });
}

export async function respond(chatId: string, requestId: string, response: RequestResponse): Promise<void> {
  await client.request("request.respond", { chatId, requestId, response });
}

export async function deleteChat(projectId: string, chatId: string): Promise<void> {
  subscriptions.get(chatId)?.();
  subscriptions.delete(chatId);
  await client.request("chats.delete", { chatId });
  batch(() => {
    setState("lists", projectId, (list) => (list ?? []).filter((entry) => entry.id !== chatId));
    setState("chats", chatId, undefined!);
    setState("drafts", chatId, undefined!);
  });
  if (root.active()[projectId] === chatId) setActiveChat(projectId, activeChatId(projectId));
}

export const transcriptOf = (chatId: string | null): Transcript => (chatId ? (state.chats[chatId] ?? emptyTranscript()) : emptyTranscript());

export function summaryOf(projectId: string, chatId: string | null): ChatSummary | null {
  if (!chatId) return null;
  return state.chats[chatId]?.chat ?? state.lists[projectId]?.find((entry) => entry.id === chatId) ?? null;
}

export type StartChatOptions = {
  project: ProjectInfo;
  text: string;
  attachments: string[];
  model: ModelRef;
};

export async function startChat(options: StartChatOptions): Promise<void> {
  const projectId = options.project.id;
  // The layout provider isn't mounted on the dashboard, so its stored key is written directly for the editor to read on mount.
  settings.define<boolean>("layout.uiVisible", true).value = true;
  try {
    await send({ projectId, cwd: options.project.dir, chatId: null, text: options.text, attachments: options.attachments, model: options.model });
  } catch (error) {
    setActiveChat(projectId, null);
    setState("drafts", draftKey(projectId, null), {
      text: options.text,
      attachments: options.attachments.map(attachmentFromPath),
    });
    toast.error(t("Could not start the chat"), { description: (error as Error).message });
  }
}

export const chatRoute = (project: ProjectInfo): string => projectRoute(project.id || project.name);

export { attachmentPaths };

export function blockedReason(): string | null {
  if (state.connection === "unavailable") return t("Chat isn't available in the browser.");
  if (state.connection !== "open") return t("Connecting to the agent host…");
  if (state.harnesses.length && state.harnesses.every((harness) => harness.status === "checking")) return t("Looking for Claude Code and Codex…");
  if (!readyHarnesses().length) {
    const detail = state.harnesses.map((harness) => harness.detail).find(Boolean);
    return detail ? t("No agent is ready. {detail}.", { detail }) : t("Install Claude Code or Codex to chat.");
  }
  return null;
}
