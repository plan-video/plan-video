/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The same handlers as the MCP posting tools, so a post the agent schedules is the one the New post form would make.

import { analyticsTool, DapiError, isDapiError, listMediaTool, toolByName, type ToolName } from "@plan.video/dapi";
import type { User } from "@supabase/supabase-js";

import { readAnalytics } from "@/lib/agent-analytics";
import { copyPost, deletePost, listPosts, publishPost, schedulePost, socialAccounts, socialSchema, tiktokCreator, updatePost } from "@/dapi/handlers/posts";
import { msg } from "@/lib/i18n";
import { loadMediaLibrary, markMediaUsed, mediaFile, mediaItems } from "@/lib/media-library";
import { loadWorkspaces } from "@/lib/workspaces";

import type { ToolContext } from "@/dapi/handler";
import type { ConfirmRequest } from "@/lib/agent-confirm";

const HANDLERS = {
  social_accounts: socialAccounts,
  social_schema: socialSchema,
  tiktok_creator: tiktokCreator,
  analytics: (args: Parameters<typeof readAnalytics>[0], ctx: ToolContext) =>
    readAnalytics(args, ctx.app.requireUser("Sign in to read your analytics.").id),
  schedule_post: schedulePost,
  copy_post: copyPost,
  list_posts: listPosts,
  update_post: updatePost,
  delete_post: deletePost,
  publish_post: publishPost,
  list_media: listMedia,
} as const;

const OWN_SCHEMAS: Record<string, { input: typeof analyticsTool.input | typeof listMediaTool.input }> = {
  [analyticsTool.name]: analyticsTool,
  [listMediaTool.name]: listMediaTool,
};

export type AgentToolName = keyof typeof HANDLERS;

export const isAgentTool = (name: string): name is AgentToolName => Object.hasOwn(HANDLERS, name);

/** A turn that ran one isn't run again. */
export const CHANGING_TOOLS: ReadonlySet<string> = new Set(["schedule_post", "copy_post", "update_post", "delete_post", "publish_post"]);

/** Always wait for the person's yes; the rest wait as lib/agent-confirm decides. */
export const CONFIRM_TOOLS: ReadonlySet<string> = new Set(["publish_post", "delete_post"]);

export type StepStatus = "running" | "done" | "error" | "waiting";

const LABELS: Record<AgentToolName, { running: string; done: string; failed: string }> = {
  social_accounts: { running: msg("Checking your channels"), done: msg("Checked your channels"), failed: msg("Couldn't check your channels") },
  social_schema: { running: msg("Reading the networks' rules"), done: msg("Read the networks' rules"), failed: msg("Couldn't read the networks' rules") },
  tiktok_creator: { running: msg("Checking your TikTok account"), done: msg("Checked your TikTok account"), failed: msg("Couldn't check your TikTok account") },
  analytics: { running: msg("Reading your analytics"), done: msg("Read your analytics"), failed: msg("Couldn't read your analytics") },
  schedule_post: { running: msg("Scheduling a post"), done: msg("Scheduled a post"), failed: msg("Didn't schedule a post") },
  copy_post: { running: msg("Copying a post"), done: msg("Copied a post"), failed: msg("Didn't copy a post") },
  list_posts: { running: msg("Reading your calendar"), done: msg("Read your calendar"), failed: msg("Couldn't read your calendar") },
  list_media: { running: msg("Reading your media"), done: msg("Read your media"), failed: msg("Couldn't read your media") },
  update_post: { running: msg("Changing a post"), done: msg("Changed a post"), failed: msg("Didn't change a post") },
  delete_post: { running: msg("Deleting a post"), done: msg("Deleted a post"), failed: msg("Didn't delete a post") },
  publish_post: { running: msg("Publishing a post"), done: msg("Published a post"), failed: msg("Didn't publish a post") },
};

export function toolLabel(name: string, status: StepStatus): string {
  const label = LABELS[name as AgentToolName];
  if (!label) return name;
  if (status === "waiting") return msg("Waiting for your go-ahead");
  return status === "running" ? label.running : status === "done" ? label.done : label.failed;
}

export const mediaReference = (id: string) => `media:${id}`;

/** Anything not in the library is refused, so no path reaches the disk. */
async function libraryFile(reference: string): Promise<File> {
  const id = reference.trim().replace(/^media:/, "");
  if (!reference.trim().startsWith("media:")) {
    throw new DapiError("invalid-input", "Pass a media id from the person's message, such as media:2f9c1e. Paths and URLs aren't attached.");
  }
  await loadMediaLibrary();
  const item = mediaItems().find((row) => row.id === id);
  const file = item ? await mediaFile(item) : null;
  if (!item || !file) throw new DapiError("not-found", "That file is no longer in the media library. Ask the person to insert it again.");
  markMediaUsed([item.id]);
  return file;
}

async function listMedia(args: { kind?: "video" | "image"; search?: string; limit?: number }) {
  await loadMediaLibrary();
  const words = (args.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matched = mediaItems().filter(
    (item) => (!args.kind || item.kind === args.kind) && words.every((word) => item.name.toLowerCase().includes(word)),
  );
  return {
    total: matched.length,
    media: matched.slice(0, args.limit ?? 30).map((item) => ({
      id: mediaReference(item.id),
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

function context(user: () => User | null, signal: AbortSignal, confirm: ToolContext["confirm"], confirmEvery: boolean): ToolContext {
  return {
    signal,
    media: libraryFile,
    confirm,
    confirmEvery,
    app: {
      requireUser(reason) {
        const current = user();
        if (!current) throw new DapiError("sign-in-required", reason ?? "Sign in to use the agent.");
        return current;
      },
    },
  };
}

/** With `confirm`, only the person's yes in this tab accepts TikTok's terms (see lib/agent-confirm). */
export async function runAgentTool(
  name: string,
  input: unknown,
  options: { user: () => User | null; signal: AbortSignal; confirm?: (request: ConfirmRequest) => Promise<boolean>; confirmEvery?: boolean },
): Promise<{ text: string; error: boolean }> {
  if (!isAgentTool(name)) return { text: `There is no tool named ${name}.`, error: true };
  const schema = OWN_SCHEMAS[name]?.input ?? toolByName(name as ToolName).input;
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
    return { text: `The arguments don't fit ${name}: ${problems}`, error: true };
  }
  try {
    // Also in a tab that never opened the dashboard.
    const current = options.user();
    if (current) loadWorkspaces(current.id);
    // Each handler takes its own parsed arguments; the map's union can't say so.
    const handler = HANDLERS[name as AgentToolName] as (args: unknown, ctx: ToolContext) => Promise<unknown>;
    const output = await handler(parsed.data, context(options.user, options.signal, options.confirm, options.confirmEvery === true));
    return { text: JSON.stringify(output), error: false };
  } catch (error) {
    const message = (error as Error).message || String(error);
    return { text: isDapiError(error) ? `${error.code}: ${message}` : message, error: true };
  }
}
