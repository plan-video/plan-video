/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Desktop only: in the browser every call here resolves to null.

import { createSignal } from "solid-js";

import { MAIN_CHANNELS } from "@desktop/main-channels";
import { mainBridge } from "@/lib/ipc";
import { isDesktop } from "@/projects";

import type {
  AgentId,
  CliInstallResult,
  CliStatus,
  CliUninstallResult,
  McpApplyRequest,
  McpApplyResult,
  McpStatus,
} from "@desktop/main-channels";

export type { AgentId, McpAgentStatus, McpStatus, CliStatus } from "@desktop/main-channels";

/** By the name in `assets/icons`. */
export const AGENT_ICONS: Record<AgentId, string> = {
  "claude-code": "agent.claude-code",
  "claude-desktop": "claude",
  cursor: "agent.cursor",
  vscode: "agent.vscode-copilot",
  codex: "agent.codex",
  antigravity: "agent.google-antigravity",
  "gemini-cli": "agent.google-gemini-cli",
  windsurf: "agent.devin-windsurf",
  opencode: "agent.opencode",
};

const [connectedAgents, setConnectedAgents] = createSignal<number | null>(null);

/** Null until the first status fetch. Kept here so every fetch can update the sidebar's nudge card. */
export { connectedAgents };

export async function fetchMcpStatus(): Promise<McpStatus | null> {
  if (!isDesktop()) return null;
  const status = await mainBridge.call(MAIN_CHANNELS.MCP_STATUS, undefined);
  setConnectedAgents(status.agents.filter((agent) => agent.connected).length);
  return status;
}

export function applyMcp(request: McpApplyRequest): Promise<McpApplyResult> {
  return mainBridge.call(MAIN_CHANNELS.MCP_APPLY, request);
}

export async function fetchCliStatus(): Promise<CliStatus | null> {
  if (!isDesktop()) return null;
  return mainBridge.call(MAIN_CHANNELS.CLI_STATUS, undefined);
}

export function installCli(): Promise<CliInstallResult> {
  return mainBridge.call(MAIN_CHANNELS.CLI_INSTALL, undefined);
}

export function uninstallCli(): Promise<CliUninstallResult> {
  return mainBridge.call(MAIN_CHANNELS.CLI_UNINSTALL, undefined);
}

export function displayPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}
