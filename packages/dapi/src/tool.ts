/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { z } from "zod";

/** Renderer tools need the open project's world, the engine or browser media APIs; main tools need the file system or a child process and run without a window. */
export type Environment = "renderer" | "main";

export interface Tool<
  Name extends string = string,
  Input extends z.ZodObject = z.ZodObject,
  Output extends z.ZodObject = z.ZodObject,
  Result extends z.ZodType = Output,
> {
  /** MCP tool name: `[a-z0-9_]`, unique across the catalog. */
  readonly name: Name;
  readonly title: string;
  readonly description: string;
  /** Always an object: MCP tool arguments are a JSON object by definition. */
  readonly input: Input;
  readonly output: Output;
  /** Image tools return bytes the server presents as files and inline images; transcribe returns the transcript the server writes to a file. Same as `output` when omitted. */
  readonly result?: Result;
  readonly environment: Environment;
}

export type GenericTool = Tool<string, z.ZodObject, z.ZodObject, z.ZodType>;

/** Keeps the literal name and the exact schema types. */
export function defineTool<
  const Name extends string,
  Input extends z.ZodObject,
  Output extends z.ZodObject,
  Result extends z.ZodType = Output,
>(tool: Tool<Name, Input, Output, Result>): Tool<Name, Input, Output, Result> {
  return tool;
}
