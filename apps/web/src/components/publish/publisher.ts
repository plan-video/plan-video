/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Sends posts out. The publisher (services/publisher) does the sending, from
// the server: scheduled posts at their time, whether or not plan.video is
// open, and "Post now" at once. This hands it a post and waits for how it
// went, which deliveries.ts keeps on the post for Posts and the calendar.

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

/** How long "Post now" waits for the networks before leaving them to finish on their own. */
const WAIT_MS = 5 * 60_000;

const [running, setRunning] = createSignal<ReadonlySet<string>>(new Set());

export const canPublish = (post: Pick<StoredEvent, "platforms">) =>
  post.platforms.some((id) => PUBLISHING_PLATFORMS.includes(id));

/** The deliveries on a post, platform first. */
export function deliveriesOf(post: StoredEvent): { platform: string; delivery: Delivery }[] {
  return Object.entries(post.deliveries ?? {}).flatMap(([platform, delivery]) => (delivery ? [{ platform, delivery }] : []));
}

/** Failed somewhere and still not out. A post marked as posted went out another way. */
export const hasFailed = (post: StoredEvent) =>
  post.status !== "posted" && deliveriesOf(post).some(({ delivery }) => delivery.state === "failed");
export const isGoingOut = (post: StoredEvent) => deliveriesOf(post).some(({ delivery }) => delivery.state === "sending");

/** Why a scheduled post won't go out as it shows, for now. */
export type HeldBack = { label: string; detail: string };

/**
 * Why a scheduled post won't go out as it shows, while that holds: the
 * account, which the publisher sends from, doesn't have this browser's copy
 * of it, or its file hasn't reached cloud storage. Both clear on their own
 * once saving or uploading works again.
 */
export function heldBack(post: Pick<StoredEvent, "id" | "status">): HeldBack | null {
  if (post.status !== "scheduled") return null;
  if ((postSyncProblem() || refusedPosts().has(post.id)) && unsyncedPosts().has(post.id)) {
    return { label: t("Not synced"), detail: t("Your account doesn't have this version yet, so it won't go out as it shows. plan.video keeps trying.") };
  }
  const upload = uploadProblem(post.id);
  if (upload) return { label: t("Not uploaded"), detail: t("Its file hasn't uploaded, so it can't go out with it. {problem}", { problem: t(upload) }) };
  return null;
}

/**
 * What the publisher writes on a calendar run it held back because the Free
 * plan's account already had 10 posts waiting. It's OVER_SCHEDULED in
 * services/publisher/plans.mjs word for word (plans.test.mjs checks), so it
 * shows translated, with Upgrade.
 */
export const OVER_PLAN = msg(
  "On the Free plan, each account can have 10 scheduled posts waiting at a time, so this one wasn't sent. Upgrade for unlimited posts, or post it now.",
);
export const overPlan = (delivery: Delivery) => delivery.state === "failed" && delivery.error === OVER_PLAN;

/**
 * "Retry", or "Check again" when the network already has the upload and may
 * have finished it. A run the plan held back says "Post now", which is what
 * sending it again does.
 */
export const retryLabel = (delivery: Delivery) => (overPlan(delivery) ? t("Post now") : delivery.publishId ? t("Check again") : t("Retry"));

export type SendResult = "sent" | "failed" | "needs-media" | "busy";

/** The words for the platforms that take a post's own text rather than the shared caption. */
export type PostTexts = { bluesky?: string; linkedin?: string; x?: string; instagram?: string; facebook?: string; threads?: string };

/**
 * Whether the post has nothing `platform` can go out with: YouTube takes a
 * video, TikTok and Instagram a video or pictures. Files kept in another browser count, as
 * they go from cloud storage, and so does an earlier try that got there.
 */
async function lacksMedia(post: StoredEvent, platform: string) {
  if ((platform !== "tiktok" && platform !== "youtube" && platform !== "instagram") || post.deliveries?.[platform]?.publishId) return false;
  const files = await postFileStates(post, platform);
  if (post.files && files.length < postFileIds(post, platform).length) return false;
  return platform === "youtube" ? !files.some((file) => file.kind === "video") : !files.length;
}

/**
 * Hands a saved post to the publisher to send now, to each network that
 * publishes from plan.video, and waits for how it went. A network that
 * already has it isn't sent it again. `caption` and `texts` are the words
 * chosen for TikTok, Bluesky and LinkedIn, kept on the post first.
 */
export async function sendPost(postId: string, userId: string | undefined, caption?: string, texts: PostTexts = {}): Promise<SendResult> {
  if (running().has(postId)) return "busy";
  await hydrateCalendar();
  const post = allPosts().find((item) => item.id === postId);
  if (!post) return "failed";
  const targets = post.platforms.filter((id) => PUBLISHING_PLATFORMS.includes(id) && post.deliveries?.[id]?.state !== "sent");
  if (!targets.length) return post.platforms.some((id) => PUBLISHING_PLATFORMS.includes(id)) ? "sent" : "failed";
  for (const platform of targets) if (await lacksMedia(post, platform)) return "needs-media";

  setRunning((ids) => new Set(ids).add(postId));
  // In a shared workspace, the post is its owner's, and goes out from their accounts.
  const team = activeScope();
  try {
    if (!userId) throw new Error(msg("Sign in before posting."));
    const words = { tiktok: caption, ...texts };
    if (Object.values(words).some((text) => text !== undefined)) setPostCaptions(postId, words);
    for (const platform of targets) {
      const before = post.deliveries?.[platform];
      setDelivery(postId, platform, { state: "sending", attempts: (before?.attempts ?? 0) + 1, at: new Date().toISOString(), publishId: before?.publishId });
    }
    // The publisher reads the post from the posts table, the accounts it goes out from from the account's copy, and its file from cloud storage.
    if (!(await (team ? flushTeamSync() : flushAccountSync())) || !(await flushPostSync(postId))) {
      throw new Error(msg("This post isn't saved to your account yet, so plan.video can't send it. Check the connection and try again."));
    }
    if (!(await ensurePostInCloud(postId))) throw new Error(msg("The post's media didn't reach plan.video's storage. Check the connection and try again."));
    const handed = await requestSend<DeliveryRow>(postId, team);
    rememberRows(handed);
    // The networks this send covers: what failed or waited before goes again, what was sent stays sent.
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
