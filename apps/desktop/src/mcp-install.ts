/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MCP_URL } from "@plan.video/dapi";
import { shimPath } from "./cli-windows";
import {
  AGENT_TARGETS,
  agentTarget,
  needsBinary,
  readServer,
  removeServer,
  runsOurProxy,
  sameCommand,
  upsertServer,
} from "./mcp-config";

import type { AgentPath, AgentTarget, McpServerSpec } from "./mcp-config";
import type { McpAgentStatus, McpApplyRequest, McpApplyResult, McpStatus } from "./main-channels";

// `npm run link` in apps/cli links the workspace build here; a dev build registers it.
const DEV_BINARY = "/opt/homebrew/bin/dapi";

/** On Windows, the shim outside the install folder (the one path that survives an update). */
export function dapiBinary(): string | null {
  if (process.platform === "win32") {
    const shim = shimPath();
    return app.isPackaged || existsSync(shim) ? shim : null;
  }
  const command = app.isPackaged ? join(process.resourcesPath, "cli", "bin", "dapi") : DEV_BINARY;
  return existsSync(command) ? command : null;
}

function spec(): McpServerSpec {
  const binary = dapiBinary();
  if (!binary) {
    return { url: MCP_URL, command: "", args: [] };
  }
  // A `.cmd` only runs through a shell, and the agents spawn without one.
  if (process.platform === "win32") {
    return { url: MCP_URL, command: "cmd", args: ["/c", binary, "mcp"] };
  }

  return { url: MCP_URL, command: binary, args: ["mcp"] };
}

function resolvePath(location: AgentPath): string {
  if (location.root === "home") {
    return join(homedir(), location.path);
  }
  if (location.root === "appData") {
    return join(app.getPath("appData"), location.path);
  }

  throw new Error(`Unknown agent path root: ${location.root}`);
}

function readConfig(target: AgentTarget): string | null {
  const path = resolvePath(target.config);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function writeConfig(target: AgentTarget, text: string): void {
  const path = resolvePath(target.config);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A quarantined first launch runs from a translocated read-only mount; registering that path would dangle. */
function unavailableReason(target: AgentTarget, current: McpServerSpec): string | null {
  if (!needsBinary(target)) return null;
  if (current.command === "") return "Needs the planvideo command line tool, which this build does not include.";
  if (app.isPackaged && current.command.includes("/AppTranslocation/")) {
    return "Move plan.video to the Applications folder and relaunch it first.";
  }
  return null;
}

function agentStatus(target: AgentTarget, current: McpServerSpec): McpAgentStatus {
  const registered = readServer(readConfig(target), target.format);
  return {
    id: target.id,
    label: target.label,
    detected: existsSync(resolvePath(target.marker)),
    connected: registered !== null,
    config: resolvePath(target.config),
    unavailable: unavailableReason(target, current),
  };
}

export function mcpStatus(): McpStatus {
  const current = spec();
  return { url: current.url, agents: AGENT_TARGETS.map((target) => agentStatus(target, current)) };
}

/** One file at a time, so one unreadable config does not stop the rest. */
export function applyMcp(request: McpApplyRequest): McpApplyResult {
  const current = spec();
  const result: McpApplyResult = { added: [], removed: [], failures: [] };

  for (const id of request.add) {
    const target = agentTarget(id);
    const reason = unavailableReason(target, current);
    if (reason) {
      result.failures.push({ id, error: reason });
      continue;
    }
    try {
      writeConfig(target, upsertServer(readConfig(target), target.format, target.entry(current)));
      result.added.push(id);
    } catch (e) {
      result.failures.push({ id, error: `${target.config.path}: ${(e as Error).message}` });
    }
  }

  for (const id of request.remove) {
    const target = agentTarget(id);
    try {
      const next = removeServer(readConfig(target), target.format);
      if (next !== null) writeConfig(target, next);
      result.removed.push(id);
    } catch (e) {
      result.failures.push({ id, error: `${target.config.path}: ${(e as Error).message}` });
    }
  }

  return result;
}

/** Rewrites stdio entries that run our proxy from a moved or translocated bundle; hand-written entries stay. */
export function healMcpRegistrations(): void {
  if (!app.isPackaged) return;
  const current = spec();
  if (current.command === "" || current.command.includes("/AppTranslocation/")) return;

  for (const target of AGENT_TARGETS) {
    const text = readConfig(target);
    const registered = readServer(text, target.format);
    if (!registered?.command) continue;
    if (!runsOurProxy(registered)) continue;
    const entry = target.entry(current);
    if (sameCommand(registered, entry)) continue;

    try {
      writeConfig(target, upsertServer(text, target.format, entry));
    } catch {
      // best effort: the settings page remains as a manual fix
    }
  }
}
