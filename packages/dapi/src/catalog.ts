/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { z } from "zod";
import type { GenericTool } from "./tool";

import { open } from "./tools/open";
import { context } from "./tools/context";
import { capture } from "./tools/capture";
import { check } from "./tools/check";
import { exportScene } from "./tools/export";
import { models } from "./tools/models";
import { voices } from "./tools/voices";
import { logs } from "./tools/logs";
import { screenshot } from "./tools/screenshot";
import { mediaProbe } from "./tools/media-probe";
import { mediaGrab } from "./tools/media-grab";
import { mediaTranscribe } from "./tools/media-transcribe";
import { mediaFilmstrip } from "./tools/media-filmstrip";
import { mediaWaveform } from "./tools/media-waveform";
import { mediaListen } from "./tools/media-listen";
import { fonts } from "./tools/fonts";
import { report } from "./tools/report";
import { socialAccounts, socialSchema, tiktokCreator, schedulePost, copyPost, listPosts, updatePost, deletePost, publishPost } from "./tools/posts";

/** In listing order: the project loop (open, look, capture, check, export), media inspection, social posting, then utilities. */
export const catalog = [
  open,
  context,
  capture,
  check,
  exportScene,
  mediaProbe,
  mediaGrab,
  mediaTranscribe,
  mediaFilmstrip,
  mediaWaveform,
  mediaListen,
  models,
  voices,
  socialAccounts,
  socialSchema,
  tiktokCreator,
  schedulePost,
  copyPost,
  listPosts,
  updatePost,
  deletePost,
  publishPost,
  logs,
  screenshot,
  fonts,
  report,
] as const;

export type AnyTool = (typeof catalog)[number];
export type ToolName = AnyTool["name"];
export type ToolByName<N extends ToolName> = Extract<AnyTool, { name: N }>;

/** What a caller sends: times as strings or numbers, defaults omitted. */
export type ToolInput<N extends ToolName> = z.input<ToolByName<N>["input"]>;
/** What a handler receives: parsed, defaults applied. */
export type ToolArgs<N extends ToolName> = z.output<ToolByName<N>["input"]>;
/** What a caller receives: the tool's structured content. */
export type ToolOutput<N extends ToolName> = z.output<ToolByName<N>["output"]>;
/** What a handler returns; the output, unless the tool declares a `result`. */
export type ToolResult<N extends ToolName> = ToolByName<N> extends { result?: infer R }
  ? R extends z.ZodType
    ? z.output<R>
    : ToolOutput<N>
  : ToolOutput<N>;

const byName = new Map<string, AnyTool>(catalog.map((tool) => [tool.name, tool]));

export function toolByName<N extends ToolName>(name: N): ToolByName<N> {
  return byName.get(name) as ToolByName<N>;
}

export function isToolName(name: string): name is ToolName {
  return byName.has(name);
}

export const tools: readonly GenericTool[] = catalog;

/** Off until agentic editing launches: agents can schedule and publish posts, read logs and file reports, but not open, edit or export a project. */
export const AGENTIC_EDITING = false;

const WITHOUT_EDITING = new Set<ToolName>([
  "social_accounts",
  "social_schema",
  "tiktok_creator",
  "schedule_post",
  "copy_post",
  "list_posts",
  "update_post",
  "delete_post",
  "publish_post",
  "logs",
  "report",
]);

export const servedTools: readonly GenericTool[] = AGENTIC_EDITING
  ? tools
  : tools.filter((tool) => WITHOUT_EDITING.has(tool.name as ToolName));
