/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { User } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";

let call: (tool: string, args: object, meta?: { arrived: number }) => Promise<unknown> = async () => {};
let seen: (() => User | null) | undefined;
vi.mock("@/ai-editor/connector", () => ({
  connectClaude: (run: typeof call) => {
    call = run;
    return () => {};
  },
  openEditor: () => null,
}));
vi.mock("@/components/agent-confirm", () => ({ askInTab: async () => true }));
vi.mock("@/lib/agent-confirm", () => ({ confirmWaitMs: () => 1000 }));
vi.mock("@/lib/agent-tools", () => ({
  isAgentTool: () => true,
  runAgentTool: async (_tool: string, _args: unknown, options: { user: () => User | null }) => {
    seen = options.user;
    return { text: "" };
  },
}));
vi.mock("@/lib/sync-start", () => ({ beginSyncing: () => {} }));
vi.mock("@/lib/workspaces", () => ({ loadWorkspaces: () => {} }));

const { startAgentConnector } = await import("./agent-connector");

test("a call held for an answer can't carry on as whoever signs in next", async () => {
  let current = { id: "a" } as User;
  startAgentConnector(() => current);
  await call("schedule_post", {});
  expect(seen?.()?.id).toBe("a");
  current = { id: "b" } as User;
  expect(seen?.()).toBeNull();
});
