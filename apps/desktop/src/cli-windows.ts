/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Squirrel installs each version into its own `app-<version>` folder, so PATH and agents' MCP configs
// point at shims in a folder that never moves (%LOCALAPPDATA%\plan.video\bin\{dapi,planvideo}.cmd),
// rewritten on every packaged launch and update. Adding it to the user PATH needs no administrator.
// No electron imports: the Squirrel hooks run this before the app is ready.

import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { win32 } from "node:path";

import { writeFileAtomic } from "./atomic";

export function shimDir(env: NodeJS.ProcessEnv = process.env): string {
  const local = env.LOCALAPPDATA || win32.join(homedir(), "AppData", "Local");
  return win32.join(local, "plan.video", "bin");
}

export function shimPath(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(shimDir(env), "dapi.cmd");
}

// `dapi.cmd` is the one `mcp-install.ts` registers with agents, so its name and behavior stay fixed.
export function shimPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  return ["dapi.cmd", "planvideo.cmd"].map((name) => win32.join(shimDir(env), name));
}

export function stagedScript(execPath: string): string {
  return win32.join(win32.dirname(execPath), "resources", "cli", "dapi.js");
}

// A literal `%` would start a variable expansion inside a batch file.
const batch = (path: string): string => path.replaceAll("%", "%%");

export function shimContent(execPath: string, script: string = stagedScript(execPath)): string {
  return [
    "@echo off",
    "setlocal",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `"${batch(execPath)}" "${batch(script)}" %*`,
    "",
  ].join("\r\n");
}

/** Safe to repeat; the write lands whole. */
export async function writeShim(execPath: string = process.execPath, script?: string): Promise<void> {
  await mkdir(shimDir(), { recursive: true });
  const content = shimContent(execPath, script);
  await Promise.all(shimPaths().map((path) => writeFileAtomic(path, content)));
}

export async function removeShim(): Promise<void> {
  await rm(shimDir(), { recursive: true, force: true });
}

// PATH entries compare without case and without a trailing separator.
const normalize = (entry: string): string => entry.trim().replace(/[\\/]+$/, "").toLowerCase();

const entries = (path: string): string[] => path.split(";").filter((entry) => entry.trim() !== "");

export function pathHas(path: string, dir: string): boolean {
  return entries(path).some((entry) => normalize(entry) === normalize(dir));
}

export function pathWith(path: string, dir: string): string {
  return pathHas(path, dir) ? path : [...entries(path), dir].join(";");
}

export function pathWithout(path: string, dir: string): string {
  return entries(path)
    .filter((entry) => normalize(entry) !== normalize(dir))
    .join(";");
}

// The user PATH is read and written via the HKCU\Environment registry key: [Environment]::Set...
// would expand every existing %VARIABLE%, and `setx` truncates at 1024 characters. Removing a
// nonexistent variable makes .NET broadcast WM_SETTINGCHANGE, so new terminals see the change.
const READ_PATH = `
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
[Console]::Out.Write($key.GetValue('Path', '', 'DoNotExpandEnvironmentNames'))
`;

const WRITE_PATH = `
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { 'ExpandString' }
$value = if ($env:DAPI_USER_PATH) { $env:DAPI_USER_PATH } else { '' }
$key.SetValue('Path', $value, $kind)
[Environment]::SetEnvironmentVariable('DAPI_PATH_BROADCAST', $null, 'User')
`;

function powershell(script: string, env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { env: { ...process.env, ...env }, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

export const readUserPath = (): Promise<string> => powershell(READ_PATH);

export async function writeUserPath(path: string): Promise<void> {
  await powershell(WRITE_PATH, { DAPI_USER_PATH: path });
}

export async function shimOnPath(): Promise<boolean> {
  return pathHas(await readUserPath(), shimDir());
}

export async function addShimToPath(): Promise<void> {
  const path = await readUserPath();
  const next = pathWith(path, shimDir());
  if (next !== path) await writeUserPath(next);
}

export async function removeShimFromPath(): Promise<void> {
  const path = await readUserPath();
  const next = pathWithout(path, shimDir());
  if (next !== path) await writeUserPath(next);
}
