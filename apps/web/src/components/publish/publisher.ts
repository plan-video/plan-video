/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { toast } from "somoto";

import { allPosts, ensurePostInCloud, hydrateCalendar, postFileIds, postFileStates, setDelivery, setPostCaptions, uploadProblem } from "@/components/calendar/store";
import type { Delivery, StoredEvent } from "@/components/calendar/types";
import { rememberRows, settled, type DeliveryRow } from "@/components/publish/deliveries";
import { flushAccountSync } from "@/lib/account-sync";
import { flushPostSync, postSyncProblem, refusedPosts, unsyncedPosts } from "@/lib/post-sync";
import { msg, t } from "@/lib/i18n";
import { requestSend } from "@/lib/publishing";
import { flushTeamSync } from "@/lib/team-sync";
import { activeScope } from "@/lib/workspaces";

import { PUBLISHING_PLATFORMS } from "@/lib/social";

export { PUBLISHING_PLATFORMS };

const WAIT_MS = 5 * 60_000;

const [running, setRunning] = createSignal<ReadonlySet<string>>(new Set());

export const canPublish = (post: Pick<StoredEvent, "platforms">) =>
  post.platforms.some((id) => PUBLISHING_PLATFORMS.includes(id));

export function deliveriesOf(post: StoredEvent): { platform: string; delivery: Delivery }[] {
  return Object.entries(post.deliveries ?? {}).flatMap(([platform, delivery]) => (delivery ? [{ platform, delivery }] : []));
}

export const hasFailed = (post: StoredEvent) =>
  post.status !== "posted" && deliveriesOf(post).some(({ delivery }) => delivery.state === "failed");
export const isGoingOut = (post: StoredEvent) => deliveriesOf(post).some(({ delivery }) => delivery.state === "sending");

export type HeldBack = { label: string; detail: string };

export function heldBack(post: Pick<StoredEvent, "id" | "status">): HeldBack | null {
  if (post.status !== "scheduled") return null;
  if ((postSyncProblem() || refusedPosts().has(post.id)) && unsyncedPosts().has(post.id)) {
    return { label: t("Not synced"), detail: t("Your account doesn't have this version yet, so it won't go out as it shows. plan.video keeps trying.") };
  }
  const upload = uploadProblem(post.id);
  if (upload) return { label: t("Not uploaded"), detail: t("Its file hasn't uploaded, so it can't go out with it. {problem}", { problem: t(upload) }) };
  return null;
}

// Word for word OVER_SCHEDULED in services/publisher/plans.mjs (plans.test.mjs checks), so it shows translated.
export const OVER_PLAN = msg(
  "On the Free plan, each account can have 10 scheduled posts waiting at a time, so this one wasn't sent. Upgrade for unlimited posts, or post it now.",
);
export const overPlan = (delivery: Delivery) => delivery.state === "failed" && delivery.error === OVER_PLAN;

export const retryLabel = (delivery: Delivery) => (overPlan(delivery) ? t("Post now") : delivery.publishId ? t("Check again") : t("Retry"));

export type SendResult = "sent" | "failed" | "needs-media" | "busy";

export type PostTexts = { bluesky?: string; linkedin?: string; x?: string; instagram?: string; facebook?: string; threads?: string };

async function lacksMedia(post: StoredEvent, platform: string) {
  if ((platform !== "tiktok" && platform !== "youtube" && platform !== "instagram") || post.deliveries?.[platform]?.publishId) return false;
  const files = await postFileStates(post, platform);
  if (post.files && files.length < postFileIds(post, platform).length) return false;
  return platform === "youtube" ? !files.some((file) => file.kind === "video") : !files.length;
}

export async function sendPost(postId: string, userId: string | undefined, caption?: string, texts: PostTexts = {}): Promise<SendResult> {
  if (running().has(postId)) return "busy";
  await hydrateCalendar();
  const post = allPosts().find((item) => item.id === postId);
  if (!post) return "failed";
  const targets = post.platforms.filter((id) => PUBLISHING_PLATFORMS.includes(id) && post.deliveries?.[id]?.state !== "sent");
  if (!targets.length) return post.platforms.some((id) => PUBLISHING_PLATFORMS.includes(id)) ? "sent" : "failed";
  for (const platform of targets) if (await lacksMedia(post, platform)) return "needs-media";

  setRunning((ids) => new Set(ids).add(postId));
  // In a shared workspace the post is its owner's, and goes out from their accounts.
  const team = activeScope();
  try {
    if (!userId) throw new Error(msg("Sign in before posting."));
    const words = { tiktok: caption, ...texts };
    if (Object.values(words).some((text) => text !== undefined)) setPostCaptions(postId, words);
    for (const platform of targets) {
      const before = post.deliveries?.[platform];
      setDelivery(postId, platform, { state: "sending", attempts: (before?.attempts ?? 0) + 1, at: new Date().toISOString(), publishId: before?.publishId });
    }
    // The publisher reads the post, accounts and file from the server, so they must be synced first.
    if (!(await (team ? flushTeamSync() : flushAccountSync())) || !(await flushPostSync(postId))) {
      throw new Error(msg("This post isn't saved to your account yet, so plan.video can't send it. Check the connection and try again."));
    }
    if (!(await ensurePostInCloud(postId))) throw new Error(msg("The post's media didn't reach plan.video's storage. Check the connection and try again."));
    const handed = await requestSend<DeliveryRow>(postId, team);
    rememberRows(handed);
    const going = handed.filter((row) => targets.includes(row.platform) && row.state !== "sent" && row.connection_id !== "none");
    const outcome = await settled(going.map((row) => row.id), WAIT_MS);
    const missing = handed.filter((row) => targets.includes(row.platform) && row.connection_id === "none");
    if (!outcome) return missing.length ? "failed" : "sent";
    return missing.length || outcome.some((row) => row.state === "failed") ? "failed" : "sent";
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : msg("plan.video couldn't send it.");
    for (const platform of targets) {
      const before = allPosts().find((item) => item.id === postId)?.deliveries?.[platform];
      setDelivery(postId, platform, { state: "failed", error: message, attempts: before?.attempts ?? 1, at: new Date().toISOString(), publishId: before?.publishId });
    }
    toast.error(t("Didn't post it"), { description: t(message), action: { label: t("Retry"), onClick: () => void sendPost(postId, userId) } });
    return "failed";
  } finally {
    setRunning((ids) => {
      const next = new Set(ids);
      next.delete(postId);
      return next;
    });
  }
}
