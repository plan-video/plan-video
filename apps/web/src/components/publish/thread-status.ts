/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// How a sent post's thread is going, as the publisher records it in
// post_replies (services/publisher/replies.mjs): one row per follow-up,
// network and account, made once the one before it went out. Read for the
// posts on screen, and again every half a minute while a follow-up waits.

import { createEffect, createSignal, onCleanup } from "solid-js";

import type { StoredEvent } from "@/components/calendar/types";
import { platformName } from "@/components/calendar/utils";
import { supabase } from "@/lib/supabase";

type ReplyRow = {
  post_id: string;
  platform: string;
  connection_id: string;
  step: number;
  state: "queued" | "sending" | "sent" | "failed";
  error: string | null;
  next_at: string;
};

export type ThreadStatus =
  | { state: "failed"; step: number; network: string; error: string }
  | { state: "waiting"; at: Date }
  | { state: "sent"; count: number };

const REFRESH_MS = 30_000;

const [rows, setRows] = createSignal<ReadonlyMap<string, ReplyRow[]>>(new Map());
/** Posts on screen, with how many rows asked for them, so each is read once for all. */
const watched = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | undefined;
let pending: Promise<void> | null = null;

async function read() {
  const ids = [...watched.keys()];
  if (!supabase || !ids.length) return;
  const { data, error } = await supabase.from("post_replies").select("post_id,platform,connection_id,step,state,error,next_at").in("post_id", ids);
  // Before post_replies exists, or offline: nothing shows, and the next look tries again.
  if (error || !data) return;
  const next = new Map<string, ReplyRow[]>(ids.map((id) => [id, []]));
  for (const row of data as ReplyRow[]) next.get(row.post_id)?.push(row);
  setRows(next);
}

/** Reads the watched posts' rows soon, once for every post that asked in the meantime. */
function readSoon() {
  pending ??= Promise.resolve().then(() => {
    pending = null;
    return read();
  });
}

/** Follows a post's thread while the calling component is shown. Only posts that have a thread and went out somewhere are read. */
export function watchThread(post: () => StoredEvent) {
  createEffect(() => {
    const current = post();
    const out = current.thread?.length && Object.values(current.deliveries ?? {}).some((delivery) => delivery?.state === "sent");
    if (!out) return;
    const id = current.id;
    watched.set(id, (watched.get(id) ?? 0) + 1);
    readSoon();
    timer ??= setInterval(() => {
      // Only while something is still to come.
      const busy = [...rows().values()].some((list) => list.some((row) => row.state === "queued" || row.state === "sending"));
      if (busy) void read();
    }, REFRESH_MS);
    onCleanup(() => {
      const left = (watched.get(id) ?? 1) - 1;
      if (left > 0) watched.set(id, left);
      else watched.delete(id);
      if (!watched.size && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    });
  });
}

/** How the post's thread is going: a follow-up that failed, the next one's time, or how many went out. Null until known. */
export function threadStatus(post: StoredEvent): ThreadStatus | null {
  const list = rows().get(post.id);
  if (!list?.length) return null;
  const failed = list.filter((row) => row.state === "failed").sort((a, b) => a.step - b.step)[0];
  if (failed) return { state: "failed", step: failed.step + 1, network: platformName(failed.platform), error: failed.error ?? "" };
  const waiting = list.filter((row) => row.state === "queued" || row.state === "sending").sort((a, b) => a.next_at.localeCompare(b.next_at))[0];
  if (waiting) return { state: "waiting", at: new Date(waiting.next_at) };
  return { state: "sent", count: Math.max(...list.map((row) => row.step)) + 1 };
}
