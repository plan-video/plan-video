/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The only raw ipcRenderer/ipcMain channels: everything multiplexes through them in an envelope
// carrying the MAIN_CHANNELS name (and a UUID for requests). MCP tool calls use DAPI_WIRE instead.
import type { LogEntry, ScreenshotResult } from "@plan.video/dapi";
import type { SourceEdit, WriteResult } from "./edit-types";
import type { AgentId } from "./mcp-config";

export const MAIN_WIRE = {
  REQUEST: "main:request",
  RESPONSE: "main:response",
  EVENT: "main:event",
} as const;

export type MainWireChannel = (typeof MAIN_WIRE)[keyof typeof MAIN_WIRE];

export const MAIN_CHANNELS = {
  // Renderer→Main requests
  APP_OPEN_EXTERNAL: "app:open-external",
  APP_SHOW_IN_FOLDER: "app:show-in-folder",
  ANALYTICS_TRACK: "analytics:track",
  AUTH_GET_PENDING_CALLBACK: "auth:get-pending-callback",
  CHECKOUT_GET_PENDING_CALLBACK: "checkout:get-pending-callback",
  WINDOW_IS_FULLSCREEN: "window:is-fullscreen",
  WINDOW_SET_COLOR_MODE: "window:set-color-mode",
  WINDOW_CAPTURE: "window:capture",
  FILE_TRANSFER: "file:transfer",
  FILE_WRITE_OPEN: "file:write-open",
  FILE_WRITE_CHUNK: "file:write-chunk",
  FILE_WRITE_CLOSE: "file:write-close",
  FILE_WRITE_ABORT: "file:write-abort",
  LOGS_GET: "logs:get",
  PROJECTS_PICK_ROOT: "projects:pick-root",
  PROJECTS_PICK_FOLDER: "projects:pick-folder",
  PROJECTS_DEFAULT_ROOT: "projects:default-root",
  PROJECTS_SCAN: "projects:scan",
  PROJECTS_GET: "projects:get",
  PROJECTS_INIT: "projects:init",
  PROJECTS_RESOLVE: "projects:resolve",
  PROJECTS_CREATE: "projects:create",
  PROJECTS_RENAME: "projects:rename",
  PROJECTS_DUPLICATE: "projects:duplicate",
  PROJECTS_DELETE: "projects:delete",
  PROJECTS_COMPILE: "projects:compile",
  PROJECTS_WRITE: "projects:write",
  PROJECTS_WATCH: "projects:watch",
  PROJECTS_UNWATCH: "projects:unwatch",
  PROJECTS_MANIFEST_READ: "projects:manifest-read",
  PROJECTS_MANIFEST_WRITE: "projects:manifest-write",
  PROJECTS_CONFIG_READ: "projects:config-read",
  PROJECTS_CONFIG_WRITE: "projects:config-write",
  PROJECTS_FS_LIST: "projects:fs-list",
  PROJECTS_FS_STAT: "projects:fs-stat",
  PROJECTS_FS_REMOVE: "projects:fs-remove",
  PROJECTS_FS_REAL_PATH: "projects:fs-real-path",
  AGENT_CHAT_ENDPOINT: "agent-chat:endpoint",
  MCP_STATUS: "mcp:status",
  MCP_APPLY: "mcp:apply",
  CLI_STATUS: "cli:status",
  CLI_INSTALL: "cli:install",
  CLI_UNINSTALL: "cli:uninstall",

  // Main→Renderer events
  AUTH_CALLBACK: "auth:callback",
  CHECKOUT_CALLBACK: "checkout:callback",
  WINDOW_FULLSCREEN_CHANGE: "window:fullscreen-change",
  PROJECTS_CHANGED: "projects:changed",
} as const;

export type ProjectInfo = {
  /** Empty for a folder that predates ids and has not been opened since (`PROJECTS_RESOLVE` gives one). */
  id: string;
  /** Folder name. Renaming the project moves it, so it is not the identity. */
  name: string;
  displayName: string;
  dir: string;
  entry: string;
  modifiedAt: string;
  createdAt: string;
};

export type CompileResult =
  { ok: true; code: string } | { ok: false; error: string };

export type { SourceEdit, WriteResult };
export type { AgentId };

export type McpAgentStatus = {
  id: AgentId;
  label: string;
  detected: boolean;
  connected: boolean;
  config: string;
  unavailable: string | null;
};

export type McpStatus = { url: string; agents: McpAgentStatus[] };

export type McpApplyRequest = { add: AgentId[]; remove: AgentId[] };

export type McpApplyResult = {
  added: AgentId[];
  removed: AgentId[];
  failures: { id: AgentId; error: string }[];
};

// `managed`: a symlink "Uninstall" can remove. A dev build cannot create the app's link (`npm run link` in apps/cli).
export type CliStatus = {
  installed: boolean;
  path: string | null;
  managed: boolean;
  available: boolean;
};

// "cancelled": the user dismissed the macOS admin prompt; not an error.
export type CliInstallResult =
  | { status: "installed" }
  | { status: "cancelled" }
  | { status: "error"; error: string };

export type CliUninstallResult =
  | { status: "removed" }
  | { status: "absent" }
  | { status: "cancelled" }
  | { status: "error"; error: string };

export type MainChannel = (typeof MAIN_CHANNELS)[keyof typeof MAIN_CHANNELS];

// Main routes each link to exactly one of these by host, so auth and checkout never consume each other's.
export type DeepLinkChannel =
  typeof MAIN_CHANNELS.AUTH_CALLBACK | typeof MAIN_CHANNELS.CHECKOUT_CALLBACK;

export type MainRequestMap = {
  [MAIN_CHANNELS.APP_OPEN_EXTERNAL]: {
    request: { url: string };
    response: void;
  };
  // Posted to Umami by main: the renderer's script is inert in Electron.
  [MAIN_CHANNELS.ANALYTICS_TRACK]: {
    request: { event: string; data?: Record<string, string | number | boolean> };
    response: void;
  };
  [MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK]: {
    request: void;
    response: string | null;
  };
  [MAIN_CHANNELS.CHECKOUT_GET_PENDING_CALLBACK]: {
    request: void;
    response: string | null;
  };
  [MAIN_CHANNELS.WINDOW_IS_FULLSCREEN]: { request: void; response: boolean };
  [MAIN_CHANNELS.WINDOW_SET_COLOR_MODE]: { request: { mode: "light" | "dark" }; response: void };
  [MAIN_CHANNELS.WINDOW_CAPTURE]: { request: void; response: ScreenshotResult };
  [MAIN_CHANNELS.FILE_TRANSFER]: {
    request: { selector: string; absolutePath: string };
    response: void;
  };
  [MAIN_CHANNELS.FILE_WRITE_OPEN]: {
    request: { path: string; exclusive?: boolean };
    response: { id: string };
  };
  [MAIN_CHANNELS.FILE_WRITE_CHUNK]: {
    request: { id: string; data: Uint8Array; position: number };
    response: void;
  };
  [MAIN_CHANNELS.FILE_WRITE_CLOSE]: {
    request: { id: string };
    response: void;
  };
  [MAIN_CHANNELS.FILE_WRITE_ABORT]: {
    request: { id: string };
    response: void;
  };
  [MAIN_CHANNELS.APP_SHOW_IN_FOLDER]: {
    request: { path: string };
    response: void;
  };
  [MAIN_CHANNELS.LOGS_GET]: { request: void; response: LogEntry[] };
  [MAIN_CHANNELS.PROJECTS_PICK_ROOT]: {
    request: void;
    response: string | null;
  };
  [MAIN_CHANNELS.PROJECTS_PICK_FOLDER]: {
    request: void;
    response: string | null;
  };
  [MAIN_CHANNELS.PROJECTS_DEFAULT_ROOT]: {
    request: void;
    response: string | null;
  };
  [MAIN_CHANNELS.PROJECTS_SCAN]: {
    request: { root: string };
    response: ProjectInfo[];
  };
  [MAIN_CHANNELS.PROJECTS_GET]: {
    request: { dir: string };
    response: ProjectInfo | null;
  };
  [MAIN_CHANNELS.PROJECTS_INIT]: {
    request: { dir: string };
    response: ProjectInfo;
  };
  [MAIN_CHANNELS.PROJECTS_RESOLVE]: {
    request: { dir: string };
    response: ProjectInfo | null;
  };
  [MAIN_CHANNELS.PROJECTS_CREATE]: {
    request: { root: string; displayName: string };
    response: ProjectInfo;
  };
  [MAIN_CHANNELS.PROJECTS_RENAME]: {
    request: { dir: string; displayName: string };
    response: ProjectInfo;
  };
  [MAIN_CHANNELS.PROJECTS_DUPLICATE]: {
    request: { dir: string };
    response: ProjectInfo;
  };
  [MAIN_CHANNELS.PROJECTS_DELETE]: { request: { dir: string }; response: void };
  [MAIN_CHANNELS.PROJECTS_COMPILE]: {
    request: { dir: string };
    response: CompileResult;
  };
  [MAIN_CHANNELS.PROJECTS_WRITE]: {
    request: { dir: string; edits: SourceEdit[] };
    response: WriteResult;
  };
  [MAIN_CHANNELS.PROJECTS_WATCH]: { request: { dir: string }; response: void };
  [MAIN_CHANNELS.PROJECTS_UNWATCH]: {
    request: { dir: string };
    response: void;
  };
  [MAIN_CHANNELS.PROJECTS_MANIFEST_READ]: {
    request: { dir: string };
    response: unknown;
  };
  [MAIN_CHANNELS.PROJECTS_MANIFEST_WRITE]: {
    request: { dir: string; manifest: unknown };
    response: void;
  };
  // The renderer owns its shape; see `engine/project-config` in the web app.
  [MAIN_CHANNELS.PROJECTS_CONFIG_READ]: {
    request: { dir: string };
    response: unknown;
  };
  [MAIN_CHANNELS.PROJECTS_CONFIG_WRITE]: {
    request: { dir: string; config: unknown };
    response: void;
  };
  // `source` is project-relative or absolute; `path` is always project-relative.
  [MAIN_CHANNELS.PROJECTS_FS_LIST]: {
    request: { dir: string; source: string };
    response: FsEntry[];
  };
  [MAIN_CHANNELS.PROJECTS_FS_STAT]: {
    request: { dir: string; source: string };
    response: FsStat | null;
  };
  [MAIN_CHANNELS.PROJECTS_FS_REMOVE]: {
    request: { dir: string; path: string };
    response: void;
  };
  [MAIN_CHANNELS.PROJECTS_FS_REAL_PATH]: {
    request: { dir: string; source: string };
    response: string | null;
  };
  [MAIN_CHANNELS.AGENT_CHAT_ENDPOINT]: {
    request: void;
    response: { url: string } | null;
  };
  // The install/uninstall calls put the macOS admin prompt on screen.
  [MAIN_CHANNELS.MCP_STATUS]: { request: void; response: McpStatus };
  [MAIN_CHANNELS.MCP_APPLY]: { request: McpApplyRequest; response: McpApplyResult };
  [MAIN_CHANNELS.CLI_STATUS]: { request: void; response: CliStatus };
  [MAIN_CHANNELS.CLI_INSTALL]: { request: void; response: CliInstallResult };
  [MAIN_CHANNELS.CLI_UNINSTALL]: { request: void; response: CliUninstallResult };
};

export type FsEntry = {
  name: string;
  kind: "file" | "directory";
  size: number;
  mtime: number;
  link?: boolean;
};
export type FsStat = { size: number; mtime: number };
export type MainRequestChannel = keyof MainRequestMap;

export type MainEventMap = {
  [MAIN_CHANNELS.AUTH_CALLBACK]: { url: string };
  [MAIN_CHANNELS.CHECKOUT_CALLBACK]: { url: string };
  [MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE]: { fullscreen: boolean };
  [MAIN_CHANNELS.PROJECTS_CHANGED]: { dir: string; path: string };
};
export type MainEventChannel = keyof MainEventMap;

export type MainRequest = {
  id: string;
  channel: MainRequestChannel;
  data: unknown;
};

export type MainEvent = {
  channel: MainEventChannel;
  data: unknown;
};

export type MainReply =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string };
