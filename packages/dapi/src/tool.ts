/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { z } from "zod";

export interface Tool<Name extends string = string, Input extends z.ZodObject = z.ZodObject, Output extends z.ZodObject = z.ZodObject> {
  /** MCP tool name: `[a-z0-9_]`, unique across the catalog. */
  readonly name: Name;
  readonly title: string;
  readonly description: string;
  /** Always an object: MCP tool arguments are a JSON object by definition. */
  readonly input: Input;
  readonly output: Output;
}

export type GenericTool = Tool<string, z.ZodObject, z.ZodObject>;

/** Keeps the literal name and the exact schema types. */
export function defineTool<const Name extends string, Input extends z.ZodObject, Output extends z.ZodObject>(
  tool: Tool<Name, Input, Output>,
): Tool<Name, Input, Output> {
  return tool;
}
