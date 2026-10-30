/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The account's copy in cloud storage of media, post files and browser
// projects: what a scheduled post is published from, and what every other
// browser signed in to the account fetches them from. Each browser keeps its
// own copy too, so nothing waits on the network once it's here. Our server
// never sees a file: it checks the sign-in, then signs a short-lived link that
// this browser sends the file to, or reads it from, directly. Each account
// gets its own folder in the bucket, which only it can sign links for: 5 GB on
// Free, up to 250 GB on Agency. A post's file stops counting once the post has
// gone out: it moves to the account's post history, which keeps it for good.
//
// A shared workspace's posts and media are its owner's, so their files are in
// the owner's folder, on the owner's plan: calls about them name the workspace
// as `team`, and the server checks the person is in it.

import { createSignal } from "solid-js";
import { toast } from "somoto";

import { inGuestMode } from "@/lib/guest";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import type { TeamScope } from "@/lib/workspaces";

/** The website only. The desktop app keeps projects on disk, and dev has no signer behind it. */
export const cloudEnabled = import.meta.env.PROD && !window.desktop && supabase !== null;

export type CloudCopy = { key: string; at: string };

export type CloudTarget =
  | { purpose: "media" | "posts"; id: string }
  | { purpose: "projects"; id: string; path: string };

/** Where a post's file is kept once the post has gone out. */
export const isSentCopy = (cloud: CloudCopy | undefined) => !!cloud?.key.startsWith("sent/");

export class CloudError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Asked about a shared workspace: a refusal is about that workspace, not the person's own storage. */
    readonly team = false,
  ) {
    super(message);
  }
}

/** Not signed in, not let in yet, out of space, or asked too often: trying again now won't help. */
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

/** The type cloud storage files it under. Some systems hand over a video with no type at all. */
function typeOf(target: CloudTarget, blob: Blob) {
  if (target.purpose === "projects") return "application/octet-stream";
  if (blob.type === "image/jpg") return "image/jpeg";
  if (blob.type) return blob.type;
  const extension = blob instanceof File ? blob.name.split(".").pop()?.toLowerCase() : undefined;
  return (extension && TYPES[extension]) || "video/mp4";
}

/** `sent` puts a post's file straight into the post history, for a post that went out with no copy. `team` names the shared workspace it's for. */
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
  /** Now kept as post history, at `key`. */
  sent: { id: string; key: string }[];
  /** No copy of this file to move: it expired, never finished uploading, or is of an older file. */
  missing: string[];
  /** Left counting against the plan: the post history is at its ceiling. */
  full: string[];
};

/** Moves the files of posts that went out into the post history, where they stop counting. `size` is the file the post went out with. */
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

/** Deletes some files of a project, or all of it when no paths are given. */
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

/** What the account stores, by kind, against what its plan allows. */
export async function cloudUsage(): Promise<CloudUsage> {
  return call<CloudUsage>("GET", "usage");
}

/** A link that reads the copy for a few minutes. */
export async function cloudReadUrl(target: CloudTarget, team?: TeamScope | null): Promise<string> {
  return (await call<{ url: string }>("POST", "read-url", target, team)).url;
}

/** Read links for many copies, in the order asked. */
export async function cloudReadUrls(targets: readonly CloudTarget[], team?: TeamScope | null): Promise<string[]> {
  const urls: string[] = [];
  for (let start = 0; start < targets.length; start += READ_BATCH) {
    const part = await call<{ links: { url: string }[] }>("POST", "read-urls", { targets: targets.slice(start, start + READ_BATCH) }, team);
    urls.push(...part.links.map((link) => link.url));
  }
  return urls;
}

/** A project file as cloud storage keeps it. `at` is when it was last uploaded, by the storage's clock. */
export type CloudProjectFile = { id: string; path: string; size: number; at: number };

/** Every project file the account keeps, from any browser. */
export async function listCloudProjects(): Promise<CloudProjectFile[]> {
  return (await call<{ files: CloudProjectFile[] }>("POST", "list", { purpose: "projects" })).files;
}

let warned = false;

/** Says once per visit why backups stopped, when it's something the person can act on. */
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

/** Why a job didn't finish, for the person, and whether trying again on its own can help. */
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

/** Waits before the queue goes again after the server said stop, or couldn't be reached. */
const PAUSES_MS = [15_000, 60_000, 5 * 60_000];
/** Failures in a row before a job that can't reach storage is held, so one file can't hold up the rest. */
const TRIES = 3;
/** How often held uploads try again on their own, while storage is full or out of reach. */
const RETRY_HELD_MS = 5 * 60_000;

/** Jobs waiting their turn, in the order asked for. */
const pending = new Map<string, Job>();
/** Jobs that failed in a way that going straight on won't fix, with why. */
const held = new Map<string, { job: Job; problem: string; kind: Exclude<Kind, "stopped"> }>();
const tries = new Map<string, number>();
let running = false;
/** Why every job waits, while the server has said stop or can't be reached. */
let pause: { problem: string; timer: ReturnType<typeof setTimeout> } | null = null;
let pauses = 0;
let heldTimer: ReturnType<typeof setTimeout> | undefined;

const [holdUps, setHoldUps] = createSignal<ReadonlyMap<string, string>>(new Map());

/** Jobs that can't finish for now, by name, with why: storage is full, the file was refused, or storage can't be reached. */
export const cloudHoldUps = holdUps;

function publish() {
  const next = new Map<string, string>();
  for (const [name, { problem }] of held) next.set(name, problem);
  if (pause) for (const name of pending.keys()) next.set(name, pause.problem);
  setHoldUps(next);
}

/**
 * Runs cloud work one job at a time, in the order it was asked for, so a delete
 * and an Undo that uploads again can't pass each other. A job asked for again
 * before it starts runs once. A job that fails is kept and tried again: when
 * the server says stop, or can't be reached, everything waits a little and
 * goes again; an upload that doesn't fit waits for room to be made.
 */
export function queueCloud(name: string, job: Job) {
  // A guest has no account to keep copies in. Their files upload once they've signed up and the stores load them.
  if (!cloudEnabled || inGuestMode()) return;
  held.delete(name);
  tries.delete(name);
  pending.delete(name);
  pending.set(name, job);
  publish();
  void drain();
}

/** Tries everything held up again now, refused files too. */
export function retryCloud() {
  if (!cloudEnabled) return;
  retryHeld("refused");
  resume();
}

/** Lets what waits go now: the queue after a pause, and uploads that may fit or get through now. */
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
  // Signed out, not let in, asked too often, or out of reach: everything waits, this job first.
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
  // Back online, back in the tab, or signed in again: what waited goes now. A refused file waits for Try again, or a new file.
  window.addEventListener("online", resume);
  window.addEventListener("focus", resume);
  supabase?.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" && pause) resume();
  });
}
