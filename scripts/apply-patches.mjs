/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// git apply rather than patch-package, so an install without the root dev dependencies can still run it.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const patchesDir = join(root, "patches");

const git = (args) =>
  spawnSync(
    "git",
    ["-c", "core.autocrlf=false", "-c", "safe.directory=*", ...args],
    { cwd: root, encoding: "utf8" },
  );

let names;
try {
  names = readdirSync(patchesDir)
    .filter((name) => name.endsWith(".patch"))
    .sort();
} catch (error) {
  if (error && error.code === "ENOENT") process.exit(0);
  throw error;
}

for (const name of names) {
  const file = join(patchesDir, name);
  const applied = git(["apply", "--reverse", "--check", file]);
  if (applied.error) {
    console.error(applied.error.message);
    console.error("git is required to apply patches/.");
    process.exit(1);
  }
  if (applied.status === 0) {
    console.log(`${name} already applied`);
    continue;
  }

  const result = git(["apply", "--whitespace=nowarn", file]);
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}`.trim();
    if (output) console.error(output);
    console.error(`Failed to apply ${name}`);
    process.exit(result.status || 1);
  }
  console.log(`Applied ${name}`);
}
