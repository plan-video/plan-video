/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Accessor } from "solid-js";
import type { User } from "@supabase/supabase-js";
import type { ToolArgs, ToolName, ToolResult } from "@plan.video/dapi";
import type { EditorSession } from "./session";
import type { ConfirmRequest } from "@/lib/agent-confirm";

/** Built per call by the bridge, so handlers stay plain functions with no Solid in them. */
export type ToolContext = {
  /** The open project's session, or null at the dashboard. */
  session: Accessor<EditorSession | null>;
  requireSession(): EditorSession;
  signal: AbortSignal;
  /** Files named by id instead of a path (the dashboard agent's media library); null falls back to path lookup. */
  media?(reference: string): Promise<File | null>;
  /**
   * Asks the signed-in person before a post is published, deleted, due within minutes, or
   * sent to a TikTok profile. Where set, only this yes accepts TikTok's terms: the caller's
   * own `agreed` is ignored. Unset, nothing is asked.
   */
  confirm?(request: ConfirmRequest): Promise<boolean>;
  /** Set for agents connected at plan.video/mcp: every call that leaves a post scheduled asks, not only one due soon. */
  confirmEvery?: boolean;
  app: {
    openProject(dir: string): Promise<ToolResult<"open">>;
    /** `reason` replaces the default message. */
    requireUser(reason?: string): User;
  };
};

export type ToolHandler<N extends ToolName> = (args: ToolArgs<N>, ctx: ToolContext) => Promise<ToolResult<N>>;

/** The tools the renderer answers; the rest run in the main process. */
export type ServedToolName = Exclude<ToolName, "logs" | "report">;

export type Handlers = { readonly [N in ServedToolName]: ToolHandler<N> };
