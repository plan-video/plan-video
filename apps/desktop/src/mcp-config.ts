/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pure text transforms (no fs, no Electron), so the merge rules are testable; mcp-install.ts does the I/O.

/** On Windows the `dapi` binary is a `.cmd`, which cannot spawn without a shell, so the command is `cmd`. */
export type McpServerSpec = { url: string; command: string; args: string[] };

/** Also the namespace agents show us under (`mcp__planvideo__<tool>`), so don't rename it. */
export const SERVER_NAME = "planvideo";

export type ServerEntry = Record<string, string | string[] | boolean>;

export type AgentId =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "vscode"
  | "codex"
  | "antigravity"
  | "gemini-cli"
  | "windsurf"
  | "opencode";

export type ConfigFormat = "mcpServers" | "servers" | "mcp" | "toml";

/** `appData` is Electron's (~/Library/Application Support, %APPDATA%), so this table is the same on every platform. */
export type AgentPath = { root: "home" | "appData"; path: string };

export type AgentTarget = {
  id: AgentId;
  label: string;
  /** Path whose presence means the agent is set up on this machine. */
  marker: AgentPath;
  config: AgentPath;
  format: ConfigFormat;
  entry(spec: McpServerSpec): ServerEntry;
};

const http = (key: string, extra: ServerEntry = {}) => (spec: McpServerSpec): ServerEntry => ({ ...extra, [key]: spec.url });
const stdio = (spec: McpServerSpec): ServerEntry => ({ command: spec.command, args: [...spec.args] });

const home = (path: string): AgentPath => ({ root: "home", path });
const appData = (path: string): AgentPath => ({ root: "appData", path });

// Claude Code's user scope is ~/.claude.json's top-level `mcpServers` (as `claude mcp add --scope user`);
// VS Code uses `servers`; Antigravity only accepts `serverUrl`; Claude Desktop takes stdio only.
export const AGENT_TARGETS: readonly AgentTarget[] = [
  { id: "claude-code", label: "Claude Code", marker: home(".claude"), config: home(".claude.json"), format: "mcpServers", entry: http("url", { type: "http" }) },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    marker: appData("Claude"),
    config: appData("Claude/claude_desktop_config.json"),
    format: "mcpServers",
    entry: stdio,
  },
  { id: "cursor", label: "Cursor", marker: home(".cursor"), config: home(".cursor/mcp.json"), format: "mcpServers", entry: http("url") },
  {
    id: "vscode",
    label: "VS Code (Copilot)",
    marker: appData("Code"),
    config: appData("Code/User/mcp.json"),
    format: "servers",
    entry: http("url", { type: "http" }),
  },
  { id: "codex", label: "Codex", marker: home(".codex"), config: home(".codex/config.toml"), format: "toml", entry: http("url") },
  { id: "antigravity", label: "Antigravity", marker: home(".gemini/antigravity"), config: home(".gemini/config/mcp_config.json"), format: "mcpServers", entry: http("serverUrl") },
  { id: "gemini-cli", label: "Gemini CLI", marker: home(".gemini"), config: home(".gemini/settings.json"), format: "mcpServers", entry: http("httpUrl") },
  { id: "windsurf", label: "Devin (Windsurf)", marker: home(".codeium/windsurf"), config: home(".codeium/windsurf/mcp_config.json"), format: "mcpServers", entry: http("serverUrl") },
  { id: "opencode", label: "OpenCode", marker: home(".config/opencode"), config: home(".config/opencode/opencode.json"), format: "mcp", entry: http("url", { type: "remote", enabled: true }) },
];

export function agentTarget(id: AgentId): AgentTarget {
  const target = AGENT_TARGETS.find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unknown agent: ${id}`);
  return target;
}

export function needsBinary(target: AgentTarget): boolean {
  return "command" in target.entry({ url: "http://x", command: "x", args: [] });
}

/** Throws when the file cannot be parsed: a config we cannot read is not one we should overwrite. */
export function upsertServer(text: string | null, format: ConfigFormat, entry: ServerEntry): string {
  return format === "toml" ? upsertToml(text, entry) : upsertJson(text, format, entry);
}

export function removeServer(text: string | null, format: ConfigFormat): string | null {
  if (readServer(text, format) === null) return null;
  return format === "toml" ? removeToml(text as string) : removeJson(text as string, format);
}

export type Registered = { url?: string; command?: string; args?: string[] };

export function readServer(text: string | null, format: ConfigFormat): Registered | null {
  if (text === null) return null;
  const entry = format === "toml" ? readToml(text) : readJson(text, format);
  if (!entry) return null;
  const url = entry.url ?? entry.httpUrl ?? entry.serverUrl;
  const command = entry.command;
  if (typeof url !== "string" && typeof command !== "string") return null;
  const args = Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === "string") : null;
  return {
    ...(typeof url === "string" ? { url } : {}),
    ...(typeof command === "string" ? { command } : {}),
    ...(typeof command === "string" && args ? { args } : {}),
  };
}

// Our proxy's path: the app inside a macOS bundle (or its translocated mount), or the Windows Squirrel shim folder.
const OUR_PATHS = ["plan.video", "/AppTranslocation/", "\\plan.video\\"];

/** Tells our proxy apart from something the user put under our name by hand. */
export function runsOurProxy(registered: Registered): boolean {
  return [registered.command ?? "", ...(registered.args ?? [])].some((part) =>
    OUR_PATHS.some((marker) => part.includes(marker)),
  );
}

export function sameCommand(registered: Registered, entry: ServerEntry): boolean {
  const args = Array.isArray(entry.args) ? entry.args : [];
  return (
    registered.command === entry.command &&
    (registered.args ?? []).length === args.length &&
    (registered.args ?? []).every((arg, index) => arg === args[index])
  );
}

type JsonFormat = Exclude<ConfigFormat, "toml">;
type JsonConfig = Record<string, unknown>;

function parseJson(text: string | null): JsonConfig {
  if (text === null || text.trim() === "") return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object at the top level");
  }
  return parsed as JsonConfig;
}

function serverMap(config: JsonConfig, root: JsonFormat): Record<string, unknown> {
  const servers = config[root];
  return typeof servers === "object" && servers !== null && !Array.isArray(servers)
    ? (servers as Record<string, unknown>)
    : {};
}

function upsertJson(text: string | null, root: JsonFormat, entry: ServerEntry): string {
  const config = parseJson(text);
  config[root] = { ...serverMap(config, root), [SERVER_NAME]: entry };
  return `${JSON.stringify(config, null, 2)}\n`;
}

function removeJson(text: string, root: JsonFormat): string {
  const config = parseJson(text);
  const { [SERVER_NAME]: _ours, ...servers } = serverMap(config, root);
  config[root] = servers;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function readJson(text: string, root: JsonFormat): Record<string, unknown> | null {
  let config: JsonConfig;
  try {
    config = parseJson(text);
  } catch {
    return null;
  }
  const entry = serverMap(config, root)[SERVER_NAME];
  return typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
}

// A header line is `[...]` at column 0; indented or commented ones are not.
const TOML_TABLE = new RegExp(String.raw`^\[mcp_servers\.${SERVER_NAME}\][^\n]*\n(?:(?!\[)[^\n]*\n?)*`, "m");

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function tomlValue(value: string | string[] | boolean): string {
  if (typeof value === "boolean") return String(value);
  return Array.isArray(value) ? `[${value.map(tomlString).join(", ")}]` : tomlString(value);
}

function tomlTable(entry: ServerEntry): string {
  const lines = Object.entries(entry).map(([key, value]) => `${key} = ${tomlValue(value)}`);
  return [`[mcp_servers.${SERVER_NAME}]`, ...lines, ""].join("\n");
}

function upsertToml(text: string | null, entry: ServerEntry): string {
  const current = text ?? "";
  const table = tomlTable(entry);
  if (TOML_TABLE.test(current)) return current.replace(TOML_TABLE, table);
  const separator = current === "" || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  return `${current}${separator}${table}`;
}

// Also drops the blank lines around it, so connect/disconnect cycles don't grow a gap.
function removeToml(text: string): string {
  const rest = text.replace(TOML_TABLE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  return rest === "" ? "" : `${rest}\n`;
}

function readToml(text: string): Record<string, unknown> | null {
  const table = text.match(TOML_TABLE)?.[0];
  if (!table) return null;
  const entry: Record<string, unknown> = {};
  for (const line of table.split("\n").slice(1)) {
    const scalar = line.match(/^(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (scalar) {
      entry[scalar[1]] = untomlString(scalar[2]);
      continue;
    }
    const list = line.match(/^(\w+)\s*=\s*\[([^\]]*)\]\s*$/);
    if (list) entry[list[1]] = [...list[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => untomlString(m[1]));
  }
  return entry;
}

function untomlString(value: string): string {
  return value.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}
