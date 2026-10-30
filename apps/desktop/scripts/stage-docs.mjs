/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Copied as laid out in the repo: the relative links between the pages assume that layout.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopDir, "..", "..");
const stageDir = join(desktopDir, "docs");

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
cpSync(join(repoRoot, "docs"), stageDir, {
  recursive: true,
  filter: (path) => !path.endsWith(".DS_Store") && !path.endsWith(".gitkeep"),
});

console.log(`stage-docs: staged the docs at ${stageDir}`);
