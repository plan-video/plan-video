/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { z } from "zod";
import type { GenericTool } from "./tool";

import { socialAccounts, socialSchema, tiktokCreator, schedulePost, copyPost, listPosts, updatePost, deletePost, publishPost } from "./tools/posts";

/** In listing order. */
export const catalog = [
  socialAccounts,
  socialSchema,
  tiktokCreator,
  schedulePost,
  copyPost,
  listPosts,
  updatePost,
  deletePost,
  publishPost,
] as const;

export type AnyTool = (typeof catalog)[number];
export type ToolName = AnyTool["name"];
export type ToolByName<N extends ToolName> = Extract<AnyTool, { name: N }>;

/** What a caller sends: defaults omitted. */
export type ToolInput<N extends ToolName> = z.input<ToolByName<N>["input"]>;
/** What a handler receives: parsed, defaults applied. */
export type ToolArgs<N extends ToolName> = z.output<ToolByName<N>["input"]>;
/** What a handler returns: the tool's structured content. */
export type ToolResult<N extends ToolName> = z.output<ToolByName<N>["output"]>;

const byName = new Map<string, AnyTool>(catalog.map((tool) => [tool.name, tool]));

export function toolByName<N extends ToolName>(name: N): ToolByName<N> {
  return byName.get(name) as ToolByName<N>;
}

export function isToolName(name: string): name is ToolName {
  return byName.has(name);
}

export const tools: readonly GenericTool[] = catalog;
