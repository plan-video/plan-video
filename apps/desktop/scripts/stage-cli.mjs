/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Ships as Contents/Resources/cli. PATH and agents on Windows use a shim outside the install folder
// (src/cli-windows.ts), since Squirrel moves the app on every update. `--all` stages both wrappers.

import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = join(desktopDir, "..", "cli");
const stageDir = join(desktopDir, "cli");

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(join(stageDir, "bin"), { recursive: true });

cpSync(join(cliDir, "dist", "index.js"), join(stageDir, "dapi.js"));

// Runs the CLI on the app's own Electron binary in Node mode (no Node install needed). Resolves
// symlinks first because Homebrew and the in-app installer both link it into PATH.
const all = process.argv.includes("--all");

const wrapper = `#!/bin/sh
SELF="$0"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *) SELF="$(dirname "$SELF")/$LINK" ;;
  esac
done
DIR="$(cd "$(dirname "$SELF")" && pwd)"
export PLANVIDEO_APP_PATH="$(cd "$DIR/../../../.." && pwd)"
ELECTRON_RUN_AS_NODE=1 exec "$DIR/../../../MacOS/plan.video" "$DIR/../dapi.js" "$@"
`;

if (all || process.platform !== "win32") {
  writeFileSync(join(stageDir, "bin", "dapi"), wrapper);
  chmodSync(join(stageDir, "bin", "dapi"), 0o755);
}

// Staged at <install>\resources\cli\bin, three folders below the executable.
const cmdWrapper = [
  "@echo off",
  "setlocal",
  'set "ELECTRON_RUN_AS_NODE=1"',
  '"%~dp0..\\..\\..\\plan.video.exe" "%~dp0..\\dapi.js" %*',
  "",
].join("\r\n");

if (all || process.platform === "win32") {
  writeFileSync(join(stageDir, "bin", "dapi.cmd"), cmdWrapper);
}

console.log(`stage-cli: staged dapi at ${stageDir}`);
