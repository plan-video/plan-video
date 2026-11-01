/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";

import { ownCaptions, postFileStates } from "@/components/calendar/store";
import type { PostStatus, StoredEvent } from "@/components/calendar/types";
import { platformName } from "@/components/calendar/utils";
import { t } from "@/lib/i18n";
import { paidToolsLocked } from "@/lib/paid-tools";
import { accountsFor } from "@/lib/social-connections";
import { supabase } from "@/lib/supabase";
import { activeScope, activeWorkspaceId } from "@/lib/workspaces";

export type PreviewSnapshot = {
  title: string;
  caption: string;
  /** YouTube's are its description. Absent on older previews. */
  captions?: Partial<Record<string, string>>;
  /** `avatars` follow `handles`' order, "" for one without. Absent on older previews. */
  platforms: { id: string; name: string; handles: string[]; avatars?: string[] }[];
  day: string;
  start: string;
  allDay: boolean;
  timeZone: string | null;
  status: PostStatus;
  /** Null when the post has no file, or its file has no cloud copy to play from. */
  media: "video" | "image" | null;
  /** Absent: the one file under the post's id. */
  files?: string[];
  story?: boolean;
  youtubeTitle: string | null;
  pinterestTitle?: string;
  /** Absent when it has none, and on older previews. */
  thread?: string[];
  link: string | null;
  /** So a sync from another workspace leaves it alone. In a shared workspace, its owner's id. */
  workspaceId: string;
};

export type PreviewComment = {
  id: string;
  parentId: string | null;
  name: string;
  byOwner: boolean;
  body: string;
  resolvedAt: string | null;
  createdAt: string;
};

export type SharedPreview = {
  id: string;
  snapshot: PreviewSnapshot;
  updatedAt: string;
  isOwner: boolean;
  comments: PreviewComment[];
};

/** A shared workspace's previews are its owner's (`ownerId`). */
export type OwnPreview = { id: string; ownerId: string; postId: string; snapshot: PreviewSnapshot; comments: number };

export const PREVIEW_PATH = "/p/";

/** The desktop app shares the website's address. */
export function previewLink(id: string): string {
  const origin = window.location.origin;
  return `${origin}${PREVIEW_PATH}${id}`;
}

/** Only files with a cloud copy are included. */
export async function snapshotOf(post: StoredEvent): Promise<PreviewSnapshot> {
  const files = (await postFileStates(post).catch(() => [])).filter((file) => file.inCloud);
  const captions = ownCaptions(post);
  return {
    title: post.title,
    caption: post.description ?? "",
    ...(Object.keys(captions).length ? { captions } : {}),
    platforms: post.platforms.map((id) => {
      const accounts = accountsFor(id, post.accounts);
      return {
        id,
        name: platformName(id),
        handles: accounts.map((account) => account.handle),
        avatars: accounts.map((account) => account.avatarUrl ?? ""),
      };
    }),
    day: post.day,
    start: post.start,
    allDay: post.allDay,
    timeZone: post.timeZone ?? null,
    status: post.status,
    media: files[0]?.kind ?? null,
    ...(files.length && (files.length > 1 || files[0]!.id !== post.id) ? { files: files.map((file) => file.id) } : {}),
    ...(post.story ? { story: true } : {}),
    youtubeTitle: post.youtube?.title || null,
    ...(post.platforms.includes("pinterest") && post.pinterest?.title ? { pinterestTitle: post.pinterest.title } : {}),
    ...(!post.story && post.thread?.some((reply) => reply.text.trim()) ? { thread: post.thread.flatMap((reply) => (reply.text.trim() ? [reply.text] : [])) } : {}),
    link: post.link,
    workspaceId: activeScope()?.workspace ?? activeWorkspaceId(),
  };
}

export async function mediaLeftOut(post: StoredEvent): Promise<boolean> {
  return (await postFileStates(post).catch(() => [])).some((file) => !file.inCloud);
}

const [own, setOwn] = createSignal<OwnPreview[]>([]);
export { own as ownPreviews };

export function previewOf(postId: string): OwnPreview | undefined {
  return own().find((preview) => preview.postId === postId);
}

async function ownerId(): Promise<string | null> {
  if (!supabase) return null;
  return (await supabase.auth.getSession()).data.session?.user.id ?? null;
}

async function subjectOf(): Promise<{ owner: string; workspace: string; shared: boolean } | null> {
  const team = activeScope();
  if (team) return { owner: team.owner, workspace: team.workspace, shared: true };
  const me = await ownerId();
  return me ? { owner: me, workspace: activeWorkspaceId(), shared: false } : null;
}

/** Quiet when the table isn't there yet. */
export async function loadOwnPreviews(): Promise<void> {
  if (!supabase || !(await ownerId())) {
    setOwn([]);
    return;
  }
  const { data, error } = await supabase.from("post_previews").select("id, owner_id, post_id, snapshot, post_preview_comments(count)");
  if (error) return;
  setOwn(
    (data ?? []).map((row) => ({
      id: row.id as string,
      ownerId: row.owner_id as string,
      postId: row.post_id as string,
      snapshot: row.snapshot as PreviewSnapshot,
      comments: ((row.post_preview_comments as { count: number }[] | null)?.[0]?.count as number) ?? 0,
    })),
  );
}

export async function sharePost(post: StoredEvent): Promise<{ id: string } | { error: string }> {
  // A shared workspace's post is its owner's, and so is its preview: its files are theirs.
  const subject = await subjectOf();
  if (!supabase || !subject) return { error: t("Sign in to share a preview.") };
  const existing = previewOf(post.id);
  if (!existing && paidToolsLocked()) return { error: t("Preview links come with a paid plan.") };
  const owner = subject.owner;
  const snapshot = await snapshotOf(post);
  const updatedAt = new Date().toISOString();
  // An upsert counts as adding one, which the database refuses on Free even for a link made before a downgrade.
  const { data, error } = await (existing
    ? supabase.from("post_previews").update({ snapshot, updated_at: updatedAt }).eq("id", existing.id)
    : supabase.from("post_previews").upsert({ owner_id: owner, post_id: post.id, snapshot, updated_at: updatedAt }, { onConflict: "owner_id,post_id" })
  )
    .select("id")
    .single();
  if (error || !data) return { error: t("Sharing isn't available right now.") };
  const id = data.id as string;
  setOwn((current) => [
    ...current.filter((preview) => preview.postId !== post.id),
    { id, ownerId: owner, postId: post.id, snapshot, comments: previewOf(post.id)?.comments ?? 0 },
  ]);
  return { id };
}

/** Its comments go with it. */
export async function stopSharing(postId: string): Promise<string | undefined> {
  const preview = previewOf(postId);
  if (!supabase || !preview) return;
  const { error } = await supabase.from("post_previews").delete().eq("id", preview.id);
  if (error) return t("Could not stop sharing. Try again.");
  setOwn((current) => current.filter((row) => row.id !== preview.id));
}

/** The same text for the same value, whatever order its keys came back in. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Call once the workspace's calendar has loaded. */
export async function syncOwnPreviews(posts: readonly StoredEvent[]): Promise<void> {
  if (!supabase) return;
  const open = activeWorkspaceId();
  const subject = await subjectOf();
  if (!subject || activeWorkspaceId() !== open) return;
  for (const preview of own()) {
    // A workspace switch while this runs leaves `posts` from the last workspace.
    if (activeWorkspaceId() !== open) return;
    if (preview.ownerId !== subject.owner) continue;
    // One saved before previews named their workspace counts as the person's open one, never a shared one's.
    if ((preview.snapshot.workspaceId ?? (subject.shared ? undefined : subject.workspace)) !== subject.workspace) continue;
    const post = posts.find((item) => item.id === preview.postId);
    if (!post) {
      await stopSharing(preview.postId);
      continue;
    }
    const snapshot = await snapshotOf(post);
    if (stable(snapshot) === stable(preview.snapshot)) continue;
    const { error } = await supabase.from("post_previews").update({ snapshot, updated_at: new Date().toISOString() }).eq("id", preview.id);
    if (!error) setOwn((current) => current.map((row) => (row.id === preview.id ? { ...row, snapshot } : row)));
  }
}

export async function setCommentResolved(id: string, resolved: boolean): Promise<string | undefined> {
  if (!supabase) return t("Sign in first.");
  const { error } = await supabase
    .from("post_preview_comments")
    .update({ resolved_at: resolved ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return t("Could not change the comment. Try again.");
}

export async function loadPreview(id: string): Promise<SharedPreview | null> {
  if (!supabase) throw new Error(t("Previews aren't available here."));
  const { data, error } = await supabase.rpc("get_post_preview", { preview: id });
  if (error) throw new Error(t("This preview couldn't be loaded."));
  return (data as SharedPreview | null) ?? null;
}

export async function addComment(id: string, name: string, body: string, parent?: string): Promise<string | undefined> {
  if (!supabase) return t("Comments aren't available here.");
  const { error } = await supabase.rpc("add_post_preview_comment", { preview: id, name, body, parent: parent ?? null });
  if (error) return error.message || t("Could not post the comment.");
}

export async function previewMediaUrl(id: string, file?: string): Promise<string | null> {
  const response = await fetch("/api/storage/preview-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preview: id, ...(file ? { file } : {}) }),
  }).catch(() => null);
  if (!response?.ok) return null;
  const payload = (await response.json().catch(() => null)) as { url?: string } | null;
  return payload?.url ?? null;
}

const NAME_KEY = "plan.video.reviewer-name";

function savedReviewerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

const [reviewer, setReviewer] = createSignal(savedReviewerName());

export const reviewerName = reviewer;

export function setReviewerName(name: string) {
  setReviewer(name);
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // The name is asked again next time.
  }
}
