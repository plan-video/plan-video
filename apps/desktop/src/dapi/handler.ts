/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { LogEntry, ToolArgs, ToolResult } from "@plan.video/dapi";

export type MainContext = {
  signal: AbortSignal;
  logs(): LogEntry[];
  version: string;
};

export type MainToolName = "logs" | "report";

export type MainHandler<N extends MainToolName> = (args: ToolArgs<N>, ctx: MainContext) => Promise<ToolResult<N>>;

export type MainHandlers = { readonly [N in MainToolName]: MainHandler<N> };
