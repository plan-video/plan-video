/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Only the publisher writes post_deliveries rows; what's on the post is a copy for showing.

import { createEffect, createSignal, onCleanup } from "solid-js";
import { toast } from "somoto";
import { SquirrelPhone } from "@/components/brand/mascot";

import { allPosts, loaded as calendarLoaded, setDelivery, setEventStatus } from "@/components/calendar/store";
import type { Delivery, StoredEvent } from "@/components/calendar/types";
import { platformName } from "@/components/calendar/utils";
import { msg, t } from "@/lib/i18n";
import { PUBLISHING_PLATFORMS } from "@/lib/social";
import { supabase } from "@/lib/supabase";
import { activeScope } from "@/lib/workspaces";

export type DeliveryRow = {
  id: string;
  post_id: string;
  occurrence: string;
  platform: string;
  connection_id: string;
  state: "queued" | "sending" | "processing" | "sent" | "failed";
  error: string | null;
  publish_id: string | null;
  url: string | null;
  attempts: number;
  due_at: string;
  updated_at: string;
  plug_checks?: number;
  plugs_done?: string[];
};

const [rows, setRows] = createSignal<ReadonlyMap<string, DeliveryRow>>(new Map());

export function rememberRows(list: readonly DeliveryRow[]) {
  setRows((current) => {
    const next = new Map(current);
    for (const row of list) {
      const known = next.get(row.id);
      if (!known || known.updated_at <= row.updated_at) next.set(row.id, row);
    }
    return next;
  });
}

export function deliveryRows(postId: string): DeliveryRow[] {
  return [...rows().values()].filter((row) => row.post_id === postId);
}

export function accountRows(connectionId: string): DeliveryRow[] {
  return [...rows().values()].filter((row) => row.connection_id === connectionId && row.state === "sent");
}

const LIVE = new Set(["queued", "sending", "processing"]);

export const YOUTUBE_PRIVATE = msg("YouTube keeps videos uploaded through plan.video private until it finishes reviewing plan.video's access. You can change it on YouTube once that's done.");

export function latestRun(list: DeliveryRow[]): DeliveryRow[] {
  const once = list.filter((row) => row.occurrence === "once");
  if (once.length) return once;
  const latest = list.reduce((day, row) => (row.occurrence > day ? row.occurrence : day), "");
  return list.filter((row) => row.occurrence === latest);
}

function combine(rows: DeliveryRow[]): Delivery {
  const real = rows.filter((row) => row.connection_id !== "none");
  const list = real.length ? real : rows;
  const at = list.reduce((latest, row) => (row.updated_at > latest ? row.updated_at : latest), "");
  const attempts = Math.max(...list.map((row) => row.attempts), 0);
  // A queued row with a reason (e.g. today's YouTube uploads used up) is waiting, unless another account's is live.
  const live = list.find((row) => LIVE.has(row.state) && row.state !== "queued") ?? list.find((row) => row.state === "queued");
  if (live) {
    const waiting = live.state === "queued" && live.error ? { waiting: live.error } : {};
    return { state: "sending", attempts, at, ...waiting, ...(live.publish_id ? { publishId: live.publish_id } : {}) };
  }
  const failed = list.find((row) => row.state === "failed");
  if (failed) return { state: "failed", attempts, at, error: failed.error ?? msg("It didn't go out.") };
  const sent = list.find((row) => row.publish_id);
  const note = list.find((row) => row.platform === "youtube" && row.error === "private")?.error;
  return { state: "sent", attempts, at, ...(sent?.publish_id ? { publishId: sent.publish_id } : {}), ...(note ? { note } : {}) };
}

const sameDelivery = (a: Delivery | undefined, b: Delivery) =>
  !!a &&
  a.state === b.state &&
  (a.error ?? "") === (b.error ?? "") &&
  (a.waiting ?? "") === (b.waiting ?? "") &&
  (a.publishId ?? "") === (b.publishId ?? "") &&
  (a.note ?? "") === (b.note ?? "");

function mirror(post: StoredEvent) {
  const run = latestRun(deliveryRows(post.id));
  if (!run.length) return;
  const byPlatform = new Map<string, DeliveryRow[]>();
  for (const row of run) byPlatform.set(row.platform, [...(byPlatform.get(row.platform) ?? []), row]);
  const now: Partial<Record<string, Delivery>> = { ...post.deliveries };
  for (const [platform, list] of byPlatform) {
    const delivery = combine(list);
    now[platform] = delivery;
    if (!sameDelivery(post.deliveries?.[platform], delivery)) setDelivery(post.id, platform, delivery);
  }
  const everywhere = post.platforms.every((id) => PUBLISHING_PLATFORMS.includes(id) && now[id]?.state === "sent");
  if (!post.recurrence && post.status !== "posted" && everywhere) setEventStatus(post.id, "posted");
}

function announce(before: DeliveryRow | undefined, row: DeliveryRow) {
  if (before?.state === row.state || (row.state !== "sent" && row.state !== "failed")) return;
  if (row.state === "failed" && row.connection_id === "none" && before) return;
  // An old post's row changed by the publisher's daily YouTube check (it clears the video link): nothing went out now.
  if (!before && Date.now() - Date.parse(row.due_at) > PAST_DAYS * 24 * 60 * 60 * 1000) return;
  const post = allPosts().find((item) => item.id === row.post_id);
  const title = post?.title ?? t("A post");
  const network = platformName(row.platform);
  if (row.state === "sent" && row.platform === "youtube" && row.error === "private") {
    toast.warning(t("Posted to YouTube as private"), {
      description: t(YOUTUBE_PRIVATE),
      ...(row.url ? { action: { label: t("Open"), onClick: () => window.open(row.url!, "_blank", "noopener") } } : {}),
    });
  } else if (row.state === "sent") {
    const inbox = row.platform === "tiktok" && row.error === "inbox";
    toast.success(inbox ? t("Sent to your TikTok inbox") : t("Posted to {network}", { network }), {
      icon: SquirrelPhone({ width: 18, class: "text-popover-foreground" }),
      description: inbox ? t("{title}. Open the notification in TikTok to edit it and post it.", { title }) : t("{title} is up.", { title }),
      ...(row.url ? { action: { label: t("Open"), onClick: () => window.open(row.url!, "_blank", "noopener") } } : {}),
    });
  } else {
    toast.error(t("Didn't post to {network}", { network }), { description: row.error ? t(row.error) : t("{title} didn't go out.", { title }) });
  }
}

const PAST_DAYS = 45;
type Subject = { owner: string; workspace?: string };
let startedFor: string | undefined;
let following: Subject | undefined;
let stop: (() => void) | undefined;
/** A topic per subscription: one made again under the topic of one still closing can miss changes. */
let channels = 0;

async function load(subject: Subject) {
  if (!supabase) return;
  const since = new Date(Date.now() - PAST_DAYS * 86_400_000).toISOString();
  let query = supabase
    .from("post_deliveries")
    .select("id,post_id,occurrence,platform,connection_id,state,error,publish_id,url,attempts,due_at,updated_at,plug_checks,plugs_done")
    .eq("user_id", subject.owner);
  if (subject.workspace) query = query.eq("workspace_id", subject.workspace);
  const { data, error } = await query.gte("updated_at", since).order("updated_at", { ascending: true }).limit(2000);
  if (error) {
    // The table ships with the publisher; until it exists, posts show what they have.
    if (!/post_deliveries/.test(error.message)) console.error("[deliveries] Could not read how posts went out", error);
    return;
  }
  rememberRows(data as DeliveryRow[]);
}

function follow(subject: Subject) {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`post-deliveries-${subject.owner}-${subject.workspace ?? "own"}-${++channels}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "post_deliveries", filter: `user_id=eq.${subject.owner}` }, (payload) => {
      const row = payload.new as (DeliveryRow & { workspace_id?: string }) | undefined;
      if (!row?.id) return;
      if (subject.workspace && row.workspace_id !== subject.workspace) return;
      const before = rows().get(row.id);
      setRows((current) => new Map(current).set(row.id, row));
      announce(before, row);
    })
    .subscribe((status) => {
      // Back after a dropped connection: read again, in case a row changed meanwhile.
      if (status === "SUBSCRIBED") void load(subject);
    });
  return () => void client.removeChannel(channel);
}

export function useDeliveries(userId: () => string | undefined) {
  createEffect(() => {
    const id = userId();
    const team = id ? activeScope() : null;
    const subject: Subject | undefined = id ? (team ? { owner: team.owner, workspace: team.workspace } : { owner: id }) : undefined;
    const key = subject ? `${subject.owner}|${subject.workspace ?? ""}` : undefined;
    if (key === startedFor) return;
    stop?.();
    stop = undefined;
    startedFor = key;
    following = subject;
    setRows(new Map());
    if (subject) stop = follow(subject);
  });
  createEffect(() => {
    if (!calendarLoaded()) return;
    const current = rows();
    const ids = new Set([...current.values()].map((row) => row.post_id));
    for (const post of allPosts()) if (ids.has(post.id)) mirror(post);
  });
  onCleanup(() => {
    stop?.();
    stop = undefined;
    startedFor = undefined;
    following = undefined;
  });
}

export function settled(ids: readonly string[], ms: number): Promise<DeliveryRow[] | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const check = () => {
      const list = ids.map((id) => rows().get(id));
      const done = list.every((row) => row && (row.state === "sent" || row.state === "failed" || row.state === "processing"));
      if (!done) return false;
      clearTimeout(timer);
      clearInterval(poll);
      resolve(list as DeliveryRow[]);
      return true;
    };
    if (check()) return;
    // The live feed brings rows in; a read now and then covers a dropped one.
    let ticks = 0;
    poll = setInterval(() => {
      if (check() || !following) return;
      if (++ticks % 3 === 0) void load(following).then(check);
    }, 2000);
    timer = setTimeout(() => {
      clearInterval(poll);
      resolve(null);
    }, ms);
  });
}
