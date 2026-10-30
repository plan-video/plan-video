/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The dashboard agent's tools, run here against the calendar on screen. They
// are the posting tools agents reach over MCP, with the same handlers, so a
// post the agent schedules is the post the New post form would have made.
// One more, analytics, reads the numbers on the Analytics page. Agents that
// come in through the hosted connector run the same tools here, and one more,
// list_media, to find the files the dashboard agent is handed in each message.

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

/** Schemas of the tools that aren't in the MCP catalog. */
const OWN_SCHEMAS: Record<string, { input: typeof analyticsTool.input | typeof listMediaTool.input }> = {
  [analyticsTool.name]: analyticsTool,
  [listMediaTool.name]: listMediaTool,
};

export type AgentToolName = keyof typeof HANDLERS;

/** Whether the agent's tools include `name`. */
export const isAgentTool = (name: string): name is AgentToolName => Object.hasOwn(HANDLERS, name);

/** Tools that change the calendar or send something. A turn that ran one isn't run again. */
export const CHANGING_TOOLS: ReadonlySet<string> = new Set(["schedule_post", "copy_post", "update_post", "delete_post", "publish_post"]);

/** Tools that send something or remove it. They always wait for the person to say yes; the others wait when a post goes out soon or to a TikTok profile, or for an outside agent whenever a post stays scheduled (see lib/agent-confirm). */
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

/** What a step says: as it runs, once it's done, when it failed or was turned down, or while it waits for a yes. */
export function toolLabel(name: string, status: StepStatus): string {
  const label = LABELS[name as AgentToolName];
  if (!label) return name;
  if (status === "waiting") return msg("Waiting for your go-ahead");
  return status === "running" ? label.running : status === "done" ? label.done : label.failed;
}

/** A media id as the agent sees it in a message. */
export const mediaReference = (id: string) => `media:${id}`;

/** Library files by the ids listed in the person's messages. Anything else is refused, so no path reaches the disk. */
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

/** The library, newest first, as list_media returns it. */
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
    session: () => null,
    requireSession() {
      throw new DapiError("no-project", "The agent works on posts, not on an open project.");
    },
    signal,
    media: libraryFile,
    confirm,
    confirmEvery,
    app: {
      openProject() {
        throw new DapiError("unsupported", "The agent can't open projects.");
      },
      requireUser(reason) {
        const current = user();
        if (!current) throw new DapiError("sign-in-required", reason ?? "Sign in to use the agent.");
        return current;
      },
    },
  };
}

/**
 * Runs one tool call: its output as JSON for the model, or what went wrong.
 * `confirm` asks the person in this tab before a call that needs their yes
 * (see lib/agent-confirm); with it, only their yes accepts TikTok's terms.
 * `confirmEvery` asks before every post left scheduled, for outside agents.
 */
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
    // The signed-in person's posts and media, also in a tab that never opened the dashboard.
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
