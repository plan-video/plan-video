/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Our server never sees a file: it checks the sign-in and signs a short-lived link the browser uses directly.
// A shared workspace's files live in its owner's folder, on the owner's plan; calls about them pass `team`.

import { createSignal } from "solid-js";
import { toast } from "somoto";

import { inGuestMode } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import type { TeamScope } from "@/lib/workspaces";

/** The desktop app keeps projects on disk, and dev has no signer behind it. */
export const cloudEnabled = import.meta.env.PROD && !window.desktop && supabase !== null;

export type CloudCopy = { key: string; at: string };

export type CloudTarget =
  | { purpose: "media" | "posts"; id: string }
  | { purpose: "projects"; id: string; path: string };

export const isSentCopy = (cloud: CloudCopy | undefined) => !!cloud?.key.startsWith("sent/");

export class CloudError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** A refusal is about that workspace, not the person's own storage. */
    readonly team = false,
  ) {
    super(message);
  }
}

/** Not signed in, not let in yet, out of space, or rate limited: trying again now won't help. */
export const cloudStopped = (error: unknown) =>
  error instanceof CloudError && [401, 403, 413, 429].includes(error.status);

const DELETE_BATCH = 200;
const READ_BATCH = 100;
const SETTLE_BATCH = 100;

export async function cloudUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

async function call<T>(method: "GET" | "POST", route: string, body?: object, team?: TeamScope | null): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  if (!session) throw new CloudError(401, t("Sign in to back up files."));
  const sent = team ? { ...body, team } : body;
  const response = await fetch(`/api/storage/${route}`, {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: sent === undefined ? undefined : JSON.stringify(sent),
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) {
    throw new CloudError(response.status, payload?.error || t("Cloud storage isn't available right now."), !!team);
  }
  return payload;
}

const TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

/** Some systems hand over a video with no type at all. */
function typeOf(target: CloudTarget, blob: Blob) {
  if (target.purpose === "projects") return "application/octet-stream";
  if (blob.type === "image/jpg") return "image/jpeg";
  if (blob.type) return blob.type;
  const extension = blob instanceof File ? blob.name.split(".").pop()?.toLowerCase() : undefined;
  return (extension && TYPES[extension]) || "video/mp4";
}

/** `sent` puts the file straight into post history, for a post that went out with no copy. */
export async function uploadToCloud(target: CloudTarget, blob: Blob, options?: { sent?: boolean; team?: TeamScope | null }): Promise<CloudCopy> {
  const signed = await call<{ key: string; uploadUrl: string; contentType: string }>(
    "POST",
    "upload-url",
    {
      ...target,
      ...(options?.sent ? { sent: true } : {}),
      contentType: typeOf(target, blob),
      size: blob.size,
    },
    options?.team,
  );
  const response = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": signed.contentType }, body: blob });
  if (!response.ok) throw new CloudError(response.status, t("The upload to cloud storage stopped."));
  return { key: signed.key, at: new Date().toISOString() };
}

export async function deleteFromCloud(purpose: "media" | "posts", ids: readonly string[], team?: TeamScope | null) {
  for (let start = 0; start < ids.length; start += DELETE_BATCH) {
    await call("POST", "delete", { purpose, ids: ids.slice(start, start + DELETE_BATCH) }, team);
  }
}

export type SettleResult = {
  sent: { id: string; key: string }[];
  /** It expired, never finished uploading, or is of an older file. */
  missing: string[];
  /** The post history is at its ceiling. */
  full: string[];
};

export async function settleInCloud(files: readonly { id: string; size: number }[], team?: TeamScope | null): Promise<SettleResult> {
  const result: SettleResult = { sent: [], missing: [], full: [] };
  for (let start = 0; start < files.length; start += SETTLE_BATCH) {
    const part = await call<SettleResult>("POST", "settle", { files: files.slice(start, start + SETTLE_BATCH) }, team);
    result.sent.push(...part.sent);
    result.missing.push(...part.missing);
    result.full.push(...part.full);
  }
  return result;
}

export async function deleteProjectFromCloud(id: string, paths?: readonly string[]) {
  if (!paths) return void (await call("POST", "delete", { purpose: "projects", id }));
  for (let start = 0; start < paths.length; start += DELETE_BATCH) {
    await call("POST", "delete", { purpose: "projects", id, paths: paths.slice(start, start + DELETE_BATCH) });
  }
}

export type CloudUsage = {
  used: number;
  limit: number;
  plan: "free" | "creator" | "pro" | "agency";
  parts: Record<"media" | "posts" | "projects", number>;
};

export async function cloudUsage(): Promise<CloudUsage> {
  return call<CloudUsage>("GET", "usage");
}

export async function cloudReadUrl(target: CloudTarget, team?: TeamScope | null): Promise<string> {
  return (await call<{ url: string }>("POST", "read-url", target, team)).url;
}

export async function cloudReadUrls(targets: readonly CloudTarget[], team?: TeamScope | null): Promise<string[]> {
  const urls: string[] = [];
  for (let start = 0; start < targets.length; start += READ_BATCH) {
    const part = await call<{ links: { url: string }[] }>("POST", "read-urls", { targets: targets.slice(start, start + READ_BATCH) }, team);
    urls.push(...part.links.map((link) => link.url));
  }
  return urls;
}

/** `at` is by the storage's clock. */
export type CloudProjectFile = { id: string; path: string; size: number; at: number };

export async function listCloudProjects(): Promise<CloudProjectFile[]> {
  return (await call<{ files: CloudProjectFile[] }>("POST", "list", { purpose: "projects" })).files;
}

let warned = false;

function report(error: unknown) {
  if (warned || !(error instanceof CloudError)) return;
  if (error.status === 413 && error.team) {
    warned = true;
    toast.error(t("This workspace's cloud storage is full"), {
      description: t("Its files are kept on its owner's plan. New ones stay in this browser until the owner makes room."),
    });
    return;
  }
  if (error.status === 413) {
    warned = true;
    toast.error(t("Cloud storage is full"), {
      description: t("New files stay in this browser, where other browsers and scheduled posts can't reach them. Delete some media or projects to make room."),
    });
  }
}

type Job = () => Promise<void>;

type Kind = "full" | "refused" | "stopped" | "unreachable";

function holdUpOf(error: unknown): { problem: string; kind: Kind; wait?: number } {
  if (!(error instanceof CloudError)) return { problem: t("Cloud storage can't be reached. Trying again soon."), kind: "unreachable" };
  if (error.status === 413) return { problem: error.message, kind: "full" };
  if (error.status === 401) return { problem: t("Sign in again to upload files."), kind: "stopped" };
  // Out of a shared workspace: its files wait, and the person's own go on.
  if (error.status === 403 && error.team) return { problem: error.message, kind: "refused" };
  if (error.status === 403) return { problem: error.message, kind: "stopped" };
  if (error.status === 429) return { problem: t("Too many uploads at once. Trying again in a minute."), kind: "stopped", wait: 60_000 };
  if (error.status >= 400 && error.status < 500 && error.status !== 408) return { problem: error.message, kind: "refused" };
  return { problem: t("Cloud storage isn't answering. Trying again soon."), kind: "unreachable" };
}

const PAUSES_MS = [15_000, 60_000, 5 * 60_000];
/** Failures in a row before a job is held, so one file can't hold up the rest. */
const TRIES = 3;
const RETRY_HELD_MS = 5 * 60_000;

const pending = new Map<string, Job>();
const held = new Map<string, { job: Job; problem: string; kind: Exclude<Kind, "stopped"> }>();
const tries = new Map<string, number>();
let running = false;
let pause: { problem: string; timer: ReturnType<typeof setTimeout> } | null = null;
let pauses = 0;
let heldTimer: ReturnType<typeof setTimeout> | undefined;

const [holdUps, setHoldUps] = createSignal<ReadonlyMap<string, string>>(new Map());

export const cloudHoldUps = holdUps;

function publish() {
  const next = new Map<string, string>();
  for (const [name, { problem }] of held) next.set(name, problem);
  if (pause) for (const name of pending.keys()) next.set(name, pause.problem);
  setHoldUps(next);
}

// One job at a time in order, so a delete and an Undo that re-uploads can't pass each other.
export function queueCloud(name: string, job: Job) {
  // A guest has no account; their files upload once they've signed up and the stores load them.
  if (!cloudEnabled || inGuestMode()) return;
  held.delete(name);
  tries.delete(name);
  pending.delete(name);
  pending.set(name, job);
  publish();
  void drain();
}

export function retryCloud() {
  if (!cloudEnabled) return;
  retryHeld("refused");
  resume();
}

function resume() {
  if (pause) {
    clearTimeout(pause.timer);
    pause = null;
    publish();
  }
  retryHeld("full");
  retryHeld("unreachable");
  void drain();
}

async function drain() {
  if (running || pause) return;
  running = true;
  try {
    while (pending.size && !pause) {
      const [name, job] = pending.entries().next().value!;
      pending.delete(name);
      try {
        await job();
        tries.delete(name);
        pauses = 0;
        // Deleting files, and posts moving to their history, can make room for uploads that didn't fit.
        if (/delete|sent|^projects$/.test(name)) retryHeld("full");
      } catch (error) {
        hold(name, job, error);
      }
      publish();
    }
  } finally {
    running = false;
  }
}

function hold(name: string, job: Job, error: unknown) {
  report(error);
  const { problem, kind, wait } = holdUpOf(error);
  const failures = (tries.get(name) ?? 0) + 1;
  tries.set(name, failures);
  if (kind !== "stopped" && (kind !== "unreachable" || failures >= TRIES)) {
    tries.delete(name);
    held.set(name, { job, problem, kind });
    if (kind !== "refused") retryHeldLater();
    return;
  }
  if (!pending.has(name)) {
    const rest = [...pending];
    pending.clear();
    pending.set(name, job);
    for (const [other, work] of rest) pending.set(other, work);
  }
  const timer = setTimeout(() => {
    pause = null;
    publish();
    void drain();
  }, wait ?? PAUSES_MS[Math.min(pauses++, PAUSES_MS.length - 1)]);
  pause = { problem, timer };
}

/** Puts held jobs of a kind back in line. One that couldn't reach storage gets one more try before it's held again, so it doesn't hold the rest up. */
function retryHeld(kind: Exclude<Kind, "stopped">) {
  let moved = false;
  for (const [name, entry] of held) {
    if (entry.kind !== kind) continue;
    held.delete(name);
    if (kind === "unreachable") tries.set(name, TRIES - 1);
    if (!pending.has(name)) pending.set(name, entry.job);
    moved = true;
  }
  if (moved) {
    publish();
    void drain();
  }
}

function retryHeldLater() {
  if (heldTimer) return;
  heldTimer = setTimeout(() => {
    heldTimer = undefined;
    retryHeld("full");
    retryHeld("unreachable");
  }, RETRY_HELD_MS);
}

if (cloudEnabled) {
  window.addEventListener("online", resume);
  window.addEventListener("focus", resume);
  supabase?.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" && pause) resume();
  });
}
