/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Squirrel.Windows launches the app with one `--squirrel-*` flag per install/update/uninstall and expects
// it to do its housekeeping (shortcuts via Update.exe, shims, agents' MCP entries) and exit.
// `--squirrel-firstrun` is the ordinary first launch and is not an event.

import { app } from "electron";
import { spawn } from "node:child_process";
import { basename, resolve } from "node:path";

import { removeShim, removeShimFromPath, writeShim } from "./cli-windows";
import { AGENT_TARGETS } from "./mcp-config";
import { applyMcp } from "./mcp-install";

const EVENTS = new Set(["--squirrel-install", "--squirrel-updated", "--squirrel-uninstall", "--squirrel-obsolete"]);

export function squirrelEvent(argv: string[] = process.argv, platform: string = process.platform): string | null {
  if (platform !== "win32") return null;
  const flag = argv[1];
  return flag && EVENTS.has(flag) ? flag : null;
}

/** Quits at once if Update.exe cannot be started. */
function updateExe(args: string[]): void {
  const exe = resolve(process.execPath, "..", "..", "Update.exe");
  let child;
  try {
    child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: true });
  } catch {
    app.quit();
    return;
  }
  child.on("error", () => app.quit());
  child.on("close", () => app.quit());
}

/** When true, the caller must not open a window or start any service; the app quits by itself. */
export function handleSquirrelEvent(): boolean {
  const event = squirrelEvent();
  if (!event) return false;

  const target = basename(process.execPath);
  switch (event) {
    case "--squirrel-install":
    case "--squirrel-updated":
      writeShim()
        .catch(() => { })
        .then(() => updateExe(["--createShortcut", target]));
      break;
    case "--squirrel-uninstall":
      try {
        applyMcp({ add: [], remove: AGENT_TARGETS.map((target) => target.id) });
      } catch {/* best effort */ }

      removeShimFromPath()
        .catch(() => { })
        .then(() => removeShim())
        .catch(() => { })
        .then(() => updateExe(["--removeShortcut", target]));
      break;
    default:
      // --squirrel-obsolete: nothing to do.
      app.quit();
  }
  return true;
}
