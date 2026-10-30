/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { servedTools, toolJsonSchemas } from "@plan.video/dapi";
import { present, toCallToolResult, toErrorResult } from "./present";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GenericTool, ToolName } from "@plan.video/dapi";

export type ToolRunner = (tool: GenericTool, args: unknown, signal: AbortSignal) => Promise<unknown>;

/**
 * `tools/list` is our own: the SDK's converts zod to JSON Schema draft-07, which clients'
 * validators reject (Claude Code fails every call on `outputSchema`). We serve 2020-12 instead
 * (see `toolJsonSchemas`); `tools/call` and its validation stay the SDK's.
 */
export function serveCatalog(session: McpServer, run: ToolRunner, tools: readonly GenericTool[] = servedTools): void {
  for (const tool of tools) {
    session.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.input, outputSchema: tool.output },
      async (args, extra) => {
        try {
          const result = await run(tool, args, extra.signal);
          return toCallToolResult(await present(tool.name as ToolName, args, result));
        } catch (error) {
          return toErrorResult(error);
        }
      },
    );
  }
  session.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, ...toolJsonSchemas(tool) })),
  }));
}
