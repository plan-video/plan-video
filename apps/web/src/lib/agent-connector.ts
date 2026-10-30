/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What a signed-in tab answers for agents that connect at plan.video/mcp: the
// dashboard agent's tools, on the calendar and media library of the
// workspace open in the tab. Editing calls go to the open project instead,
// once agentic editing is back.

import type { User } from "@supabase/supabase-js";

import { connectClaude, openEditor } from "@/ai-editor/connector";
import { askInTab } from "@/components/agent-confirm";
import { confirmWaitMs } from "@/lib/agent-confirm";
import { isAgentTool, runAgentTool } from "@/lib/agent-tools";
import { beginSyncing } from "@/lib/sync-start";
import { loadWorkspaces } from "@/lib/workspaces";

/** Opens the tab's connection for `user`; returns what closes it. */
export function startAgentConnector(user: () => User | null): () => void {
  // The connector can't cancel a call, so nothing aborts this.
  const signal = new AbortController().signal;

  return connectClaude(async (tool, args, call) => {
    const editor = openEditor();
    if (editor && !isAgentTool(tool)) return editor(tool, args);
    // Publishing, deleting, and every post the call leaves scheduled waits for the person's Allow
    // here, never the agent's word for it, and only as long as the relay waits.
    const arrived = call?.arrived ?? Date.now();
    // A tab that never opened the dashboard keeps the account in step from now on, so what the agent makes reaches it.
    const person = user()?.id;
    if (person) {
      loadWorkspaces(person);
      beginSyncing(person);
    }
    const confirm = (request: Parameters<typeof askInTab>[0]) => askInTab(request, confirmWaitMs(tool, arrived));
    const result = await runAgentTool(tool, args, { user, signal, confirm, confirmEvery: true });
    if (result.error) throw new Error(result.text);
    return { text: result.text };
  });
}
