/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { User } from "@supabase/supabase-js";

import { connectClaude, openEditor } from "@/ai-editor/connector";
import { askInTab } from "@/components/agent-confirm";
import { confirmWaitMs } from "@/lib/agent-confirm";
import { isAgentTool, runAgentTool } from "@/lib/agent-tools";
import { beginSyncing } from "@/lib/sync-start";
import { loadWorkspaces } from "@/lib/workspaces";

export function startAgentConnector(user: () => User | null): () => void {
  // The connector can't cancel a call, so nothing aborts this.
  const signal = new AbortController().signal;

  return connectClaude(async (tool, args, call) => {
    const editor = openEditor();
    if (editor && !isAgentTool(tool)) return editor(tool, args);
    // Publishing, deleting and anything left scheduled wait for the person's Allow here,
    // never the agent's word, and only as long as the relay waits.
    const arrived = call?.arrived ?? Date.now();
    // Keep the account in step from here, so what the agent makes reaches it even without the dashboard.
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
