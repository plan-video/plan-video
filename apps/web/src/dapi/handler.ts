/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { Accessor } from "solid-js";
import type { User } from "@supabase/supabase-js";
import type { ToolArgs, ToolName, ToolResult } from "@plan.video/dapi";
import type { EditorSession } from "./session";
import type { ConfirmRequest } from "@/lib/agent-confirm";

/**
 * What every handler gets besides its arguments. Built per call by the
 * bridge from what the app shell provides (see ./api), so handlers are plain
 * functions with no Solid in them.
 */
export type ToolContext = {
  /** The open project's session, or null at the dashboard. */
  session: Accessor<EditorSession | null>;
  /** The session, or a `no-project` error the caller can act on. */
  requireSession(): EditorSession;
  /** Fires when the caller cancels or goes away before the reply. */
  signal: AbortSignal;
  /**
   * Files the caller names by id instead of a path: the dashboard agent's
   * media library. Null leaves the reference to the usual path lookup.
   */
  media?(reference: string): Promise<File | null>;
  /**
   * Asks the signed-in person in this tab before a post is published or
   * deleted, goes out within minutes, or goes to a TikTok profile, and
   * resolves to their answer. Where it's set, only this yes accepts TikTok's
   * terms: the caller's own `agreed` is ignored. Unset, nothing is asked.
   */
  confirm?(request: ConfirmRequest): Promise<boolean>;
  /** Set for agents connected at plan.video/mcp: every call that leaves a post scheduled asks, not only one due soon. */
  confirmEvery?: boolean;
  /** What only the app shell can do: navigate, and know who is signed in. */
  app: {
    openProject(dir: string): Promise<ToolResult<"open">>;
    /** The signed-in user, or a `sign-in-required` error. `reason` replaces the default message. */
    requireUser(reason?: string): User;
  };
};

export type ToolHandler<N extends ToolName> = (args: ToolArgs<N>, ctx: ToolContext) => Promise<ToolResult<N>>;

/** The tools the renderer answers; the rest run in the main process. */
export type ServedToolName = Exclude<ToolName, "logs" | "report">;

export type Handlers = { readonly [N in ServedToolName]: ToolHandler<N> };
