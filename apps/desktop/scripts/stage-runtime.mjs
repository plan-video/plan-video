/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A packaged app has no node_modules: esbuild (native binary) and babel stay external and load from
// Contents/Resources/runtime (see `load` in src/projects.ts). The externals list is read from the
// build:main script so it cannot drift from what the bundle leaves unresolved.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, closeSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { npm } from "../../../scripts/lib/npm.mjs";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const stageDir = join(desktopDir, "runtime");
const require = createRequire(join(desktopDir, "package.json"));

const pkg = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8"));
const externals = [...pkg.scripts["build:main"].matchAll(/--external:(\S+)/g)]
  .map((match) => match[1])
  // Electron is provided by the host binary, not installed.
  .filter((name) => name !== "electron");

// Pin what the workspace has installed (and was tested against), not the ranges in package.json.
const dependencies = Object.fromEntries(
  externals.map((name) => [name, require(`${name}/package.json`).version]),
);

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

writeFileSync(
  join(stageDir, "package.json"),
  JSON.stringify({ name: "desktop-runtime", private: true, dependencies }, null, 2),
);

npm(["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: stageDir });

// The app-bundle signing pass misses Mach-O files in Resources, and notarization rejects unsigned
// executables. esbuild's postinstall hard-links its binary over bin/esbuild, so one may sit in two places.
const MACHO_MAGIC = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]);
function isMachO(path) {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(4);
    return readSync(fd, header, 0, 4, 0) === 4 && MACHO_MAGIC.has(header.readUInt32BE(0));
  } finally {
    closeSync(fd);
  }
}

const esbuildDir = join(stageDir, "node_modules", "@esbuild");
const binaries = [
  join(stageDir, "node_modules", "esbuild", "bin", "esbuild"),
  ...(existsSync(esbuildDir) ? readdirSync(esbuildDir).map((name) => join(esbuildDir, name, "bin", "esbuild")) : []),
].filter((path) => existsSync(path) && isMachO(path));

if (process.platform === "darwin" && !process.env.SKIP_SIGN) {
  const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  const identity = identities.match(/"(Developer ID Application: [^"]+)"/)?.[1];
  if (identity) {
    for (const bin of binaries) {
      execFileSync("codesign", ["--force", "--options", "runtime", "--timestamp", "--sign", identity, bin], {
        stdio: "inherit",
      });
    }
  } else {
    console.warn("stage-runtime: no Developer ID identity found, leaving esbuild binaries unsigned");
  }
}

console.log(`stage-runtime: staged ${externals.join(", ")} at ${stageDir}`);
