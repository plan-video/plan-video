/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, dialog, shell, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { cp, mkdir, readdir, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { nanoid } from "nanoid";
import { MCP_URL } from "@plan.video/dapi";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type { PluginItem, TransformOptions } from "@babel/core";
import type { BuildOptions, Plugin } from "esbuild";

import { isTempPath, TEMP_PREFIX, writeFileAtomic } from "./atomic";
import { windowsCloudSyncKind } from "./cloud-sync-windows";
import { isHeadless } from "./headless";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";
import { applyEdits, editLabel, stampProject } from "./edit";
import { canonicalizeTagsPlugin, inspectPlugin, sourcePlugin } from "./source";
import type { CompileResult, FsEntry, FsStat, ProjectInfo, SourceEdit, WriteResult } from "./main-channels";
import type { SourceContext } from "./edit";

export const ENTRY_FILES = ["index.tsx", "index.ts", "index.jsx", "index.js"];

const RUNTIME_MODULE = "@plan.video/jsx";

/** Left for the renderer to resolve, so there is one solid-js reactive graph and one JSX host. */
const EXTERNAL = ["solid-js", "solid-js/*", RUNTIME_MODULE];

const BUILD_OPTIONS: BuildOptions = {
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "chrome130",
  external: EXTERNAL,
  logLevel: "silent",
};

// esbuild (native binary) and babel stay out of the main bundle. A packaged app has no
// node_modules, so they load from Contents/Resources/runtime/node_modules (scripts/stage-runtime.mjs).
let stagedRequire: NodeJS.Require | undefined;

function load<T>(name: string): T {
  if (!app.isPackaged) return require(name) as T;
  stagedRequire ??= createRequire(join(process.resourcesPath, "runtime", "package.json"));
  return stagedRequire(name) as T;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

type PackageJson = {
  name?: string;
  projectId?: string;
  displayName?: string;
  main?: string;
} & Record<string, unknown>;

async function readPackage(dir: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

async function writePackage(dir: string, pkg: PackageJson): Promise<void> {
  const path = join(dir, "package.json");
  const text = JSON.stringify(pkg, null, 2) + "\n";
  // Other readers have the folder open too, so the record is claimed and replaced whole.
  noteContent(path, text);
  await writeFileAtomic(path, text);
}

// Folder and displayName both get renamed, so the record carries an id nothing renames; app URLs
// and the editor key on it. Top level because `writeConfig` replaces `planvideo` whole.

const recordedId = (pkg: PackageJson | null): string =>
  typeof pkg?.projectId === "string" ? pkg.projectId.trim() : "";

async function ensureProjectId(dir: string): Promise<string> {
  const pkg = await readPackage(dir);
  const existing = recordedId(pkg);
  if (existing) return existing;

  const id = nanoid();
  await writePackage(dir, { ...(pkg ?? packageJson(basename(dir), basename(dir))), projectId: id });
  return id;
}

async function findEntry(dir: string, pkg?: PackageJson | null): Promise<string | undefined> {
  const main = (pkg ?? (await readPackage(dir)))?.main;
  if (typeof main === "string" && /\.[jt]sx?$/.test(main) && (await exists(join(dir, main)))) {
    return main.split(sep).join("/");
  }
  for (const name of ENTRY_FILES) {
    if (await exists(join(dir, name))) return name;
  }
  return undefined;
}

const noEntryError = (): string =>
  `No entry found in this folder (package.json "main" or ${ENTRY_FILES.join(" / ")}).`;

async function describe(dir: string): Promise<ProjectInfo | null> {
  const pkg = await readPackage(dir);
  const entry = await findEntry(dir, pkg);
  if (!entry) return null;
  const name = basename(dir);
  const [folder, file] = await Promise.all([stat(dir), stat(join(dir, entry))]);
  return {
    id: recordedId(pkg),
    name,
    displayName: pkg?.displayName?.trim() || name,
    dir,
    entry,
    modifiedAt: file.mtime.toISOString(),
    createdAt: folder.birthtime.toISOString(),
  };
}

export const getProject = (dir: string): Promise<ProjectInfo | null> => describe(dir);

/**
 * `~/Movies` (macOS) or `Videos`: the one media folder iCloud and OneDrive Known Folder Move
 * leave unsynced, and it needs no macOS permission prompt. Null when it is synced after all
 * and the user would rather pick somewhere else.
 */
export async function defaultRoot(window: BrowserWindow | null): Promise<string | null> {
  const dir = join(app.getPath("videos"), "plan.video");
  if (!(await confirmCloudLocation(window, dir, "Choose another folder"))) return null;
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function pickRoot(window: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Choose projects folder",
    defaultPath: app.getPath("videos"),
    properties: ["openDirectory", "createDirectory"],
  };

  while (true) {
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (canceled || !filePaths[0]) return null;
    if (await confirmCloudLocation(window, filePaths[0], "Choose another folder")) {
      return filePaths[0];
    }
  }
}

export async function pickFolder(window: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: "Choose project folder",
    defaultPath: app.getPath("videos"),
    properties: ["openDirectory", "createDirectory"],
  };

  const { canceled, filePaths } = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return canceled ? null : filePaths[0] ?? null;
}

/** macOS marks a sync-owned folder only with this attribute; a synced Desktop looks like any folder. */
const FILE_PROVIDER_ATTR = "com.apple.file-provider-domain-id";

const FILE_PROVIDERS: Array<[prefix: string, label: string]> = [
  ["com.apple.CloudDocs", "iCloud Drive"],
  ["com.google.drivefs", "Google Drive"],
  ["com.dropbox", "Dropbox"],
  ["com.microsoft.OneDrive", "OneDrive"],
  ["com.box", "Box"],
];

/** Resolves the deepest existing ancestor, so it works for a root not yet created. */
async function resolveDeepest(path: string): Promise<string> {
  let head = resolve(path);
  const tail: string[] = [];

  while (true) {
    try {
      return join(await realpath(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return resolve(path);
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

async function existingAncestors(path: string): Promise<string[]> {
  const found: string[] = [];
  let head = resolve(path);

  while (true) {
    if (await exists(head)) found.push(head);
    const parent = dirname(head);
    if (parent === head) return found;
    head = parent;
  }
}

/**
 * The attribute is not inherited, so the whole ancestor chain is asked. Any failure (no
 * attribute, no permission, no `xattr`) reads as "not synced".
 */
async function fileProviderDomains(paths: string[]): Promise<string[]> {
  if (process.platform !== "darwin" || !paths.length) return [];

  const stdout = await new Promise<string>((done) => {
    execFile("/usr/bin/xattr", ["-p", FILE_PROVIDER_ATTR, ...paths], (_error, out) =>
      done(out ?? ""),
    );
  });

  const domains: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // One path answers with the bare value, several with `<path>: <value>`.
    if (paths.length === 1) {
      domains.push(line.trim());
      continue;
    }
    const owner = paths.find((candidate) => line.startsWith(candidate + ": "));
    if (owner) domains.push(line.slice(owner.length + 2).trim());
  }
  return domains;
}

/** The home Desktop/Documents attribute needs a permission the app may lack (the read fails silently); iCloud's copies don't. */
async function desktopAndDocumentsSynced(): Promise<boolean> {
  const cloud = join(app.getPath("home"), "Library", "Mobile Documents", "com~apple~CloudDocs");
  return (await exists(join(cloud, "Desktop"))) || (await exists(join(cloud, "Documents")));
}

export async function cloudSyncKind(path: string): Promise<string | null> {
  const real = await resolveDeepest(path);
  const home = app.getPath("home");

  // iCloud Drive and its per-app containers are left unmarked, so they go by path.
  const mobile = await resolveDeepest(join(home, "Library", "Mobile Documents"));
  if (real === mobile || real.startsWith(mobile + sep)) return "iCloud Drive";

  // Windows has no File Provider.
  if (process.platform === "win32") return windowsCloudSyncKind(real, home);

  const under = async (name: "desktop" | "documents") => {
    const root = await resolveDeepest(app.getPath(name));
    return real === root || real.startsWith(root + sep);
  };
  if (((await under("desktop")) || (await under("documents"))) && (await desktopAndDocumentsSynced())) {
    return "iCloud Drive";
  }

  for (const domain of await fileProviderDomains(await existingAncestors(real))) {
    const known = FILE_PROVIDERS.find(([prefix]) => domain.startsWith(prefix));
    return known ? known[1] : "a cloud sync service";
  }
  return null;
}

/** Headless runs are never asked and proceed with a warning in the log. */
async function confirmCloudLocation(
  window: BrowserWindow | null,
  path: string,
  declineLabel: string,
): Promise<boolean> {
  const kind = await cloudSyncKind(path);
  if (!kind) return true;

  if (isHeadless()) {
    console.warn(`[projects] ${path} is synced by ${kind}; projects there may misbehave`);
    return true;
  }

  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title: "This folder is synced",
    message: `${kind} syncs this folder.`,
    detail:
      `Projects here are not supported. ` +
      `Expect glitches: edits reappearing after you change them, work lost to ` +
      `a conflicting copy, or the project failing to build.\n\n` +
      `Somewhere on local disk avoids all of this.`,
    buttons: [declineLabel, "Use anyway"],
    defaultId: 0,
    cancelId: 0,
  };

  const { response } = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return response === 1;
}

async function childDirs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .sort()
    .map((name) => join(root, name));
}

export async function scanProjects(root: string): Promise<ProjectInfo[]> {
  const projects = await Promise.all((await childDirs(root)).map(describe));
  return projects.filter((project): project is ProjectInfo => project !== null);
}

export async function resolveProject(dir: string): Promise<ProjectInfo | null> {
  const project = await describe(dir);
  if (!project || project.id) return project;
  await ensureProjectId(dir);
  return describe(dir);
}

function folderName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 64) || "project"
  );
}

async function freeFolder(root: string, base: string): Promise<string> {
  let name = base;
  for (let i = 2; await exists(join(root, name)); i++) name = `${base}-${i}`;
  return name;
}

/** npm names: lowercase, url-safe, no leading dot or underscore, <= 214 chars. */
function packageName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 214);
  return cleaned || "plan-video-project";
}

const JSX_VERSION = "latest";
const SOLID_VERSION = "^1.9.10";

const SCRIPTS: Record<string, string> = {
  open: "planvideo open .",
  context: "planvideo context",
  capture: "planvideo capture",
  probe: "planvideo media probe",
  transcribe: "planvideo media transcribe",
  grab: "planvideo media grab",
  filmstrip: "planvideo media filmstrip",
  waveform: "planvideo media waveform",
  listen: "planvideo media listen",
  models: "planvideo models",
  voices: "planvideo voices",
  fonts: "planvideo fonts",
  logs: "planvideo logs",
  screenshot: "planvideo screenshot",
  report: "planvideo report",
};

const packageJson = (name: string, displayName: string): PackageJson => ({
  name: packageName(name),
  projectId: nanoid(),
  displayName,
  private: true,
  type: "module",
  main: "index.tsx",
  scripts: { ...SCRIPTS },
  devDependencies: {
    "@plan.video/jsx": JSX_VERSION,
    "solid-js": SOLID_VERSION,
  },
});

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "@plan.video/jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
`;

const GITIGNORE = `node_modules/
cache/
.planvideo/
${TEMP_PREFIX}*
`;

const STARTER = `export default function Project() {
  return (
    <stage background="#161616">
    </stage>
  )
}
`;

const EMPTY_MANIFEST = { version: 1, folders: [], assets: [] };

const readme = (displayName: string): string => `# ${displayName}

A plan.video project: a video composition authored as code. The folder is
a plain npm package whose entry file is a [Solid](https://www.solidjs.com)
component; the app compiles it and renders every element into an editable node
on the canvas.

## Agents

Everything an agent needs is in the app's MCP server (\`planvideo\`): its tools
are the API, its instructions say how to work, and its resources are the
authoring reference for the installed version. If it is not among your tools,
add it — the app serves it at \`${MCP_URL}\` while it is running — and start
a new session.

## Structure

| Path | What it is |
| ---- | ---------- |
| \`index.tsx\` | The entry. Its default export renders the composition. |
| \`package.json\` | The project record: \`projectId\` (its identity, kept across renames), \`displayName\` (the name shown in the app), \`main\` (the entry), \`planvideo\` (how each scene is exported), and the planvideo commands as scripts. |
| \`tsconfig.json\` | Types for the composition tags, through \`jsxImportSource\`. |
| \`assets.yml\` | The asset library: for every asset its library path, where its bytes are, and what it was found to be; for a generation without bytes, where it stands. Written by the app; hand edits are read on the next load. |
| \`assets/\` | The library's files: put one here and it is taken in while the app watches, and the app writes its own here too — generations under \`assets/generated/\`. Media imported through the app is linked where it lies instead, never copied. |
| \`cache/\` | Derived data (thumbnails, waveforms). Disposable, and not checked in. |

## Authoring

The source is the document, in both directions. Saving recompiles the project
and remounts it — scenes rebuild in place, the way reloading a page does, and a
compile error leaves the last good render on the canvas. Edits made in the app
come back the other way: a dragged rect, a trimmed clip or a retyped line lands
as a prop on the element it was authored as.

\`\`\`tsx
export default function Project() {
  return (
    <stage background="#161616" camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="Intro" width={1920} height={1080} fill="black" active>
        <video src="b-roll/drone.mp4" start={0} end={6} width={1920} height={1080} />
        <text y={860} width={1920} textAlign="center" fontFamily="Inter" fontSize={96} start={1} end={5}>
          Hello
          <animation type="fade" duration={0.5} />
          <animation type="fade" phase="out" duration={0.5} />
        </text>
      </scene>
    </stage>
  )
}
\`\`\`

- \`<stage>\` is the root, and holds one \`<scene>\` per frame you cut in. A scene
  owns the timeline its children sit on; nothing outside a scene has a clock to
  be placed against.
- One scene carries \`active\` — the one the playhead, the timeline and an export
  are pointed at — and the stage carries the \`camera\` the canvas opens on, a
  \`[scale, 0, 0, scale, x, y]\` matrix (\`0.3\` fits a 1920×1080 frame). Both are
  editor state: the app writes them back as the view is panned or a scene is
  clicked, but a project that ships without them opens on an empty timeline,
  looking at the corner of nothing.
- Position and size are explicit, in pixels. There is no layout pass and no CSS.
- \`start\` / \`end\` place a clip on that timeline, \`sourceIn\` / \`sourceOut\` choose
  the part of the media that plays. Times are seconds (\`1.5\`), frames (\`45f\`) or
  \`"MM:SS"\`.
- Style and motion are children: \`<animation>\` for a preset in or out,
  \`<keyframeTrack>\` with \`<keyframe>\` children for one property, \`<solidPaint>\`
  and the gradient paints, \`<stroke>\`, \`<shadow>\`, \`<effect>\`.
- \`src\` takes a library path (\`"b-roll/drone.mp4"\` — the portable form, it
  survives the file being relinked), an asset id, a URL, or an absolute path.
- Generated assets are declared rather than fetched: \`src={generate.image({ prompt })}\`,
  and \`generate.video\`, \`generate.voice\`, \`generate.audio\`. They are produced on
  mount, in dependency order. \`planvideo context\` reports where each stands:
  generating, failed with the reason, or done with the asset path it landed as.
- Solid is fully available while mounting: \`<For>\`, \`<Show>\`, \`createMemo\`, and
  \`useTicker()\` for values that follow the playhead.
- npm packages work as they normally do. The folder is a real npm package, so
  \`npm i three\` in it is all it takes: anything in \`node_modules\` is resolved
  and bundled, subpath imports included. A composition runs in a browser
  context, so a package that needs Node APIs will not bundle.

Types are stripped at compile time and never checked, so typecheck the project
yourself with \`npx tsc --noEmit\`.

## Commands

Every planvideo command is a script here: \`npm run\` lists them, and
\`npm run <name> -- <args>\` runs one (\`npm run grab -- b-roll/drone.mp4 -c 6\`).
All of them talk to the running app, except \`fonts\`.

| Script | Command | What it does |
| ------ | ------- | ------------ |
| \`open\` | \`planvideo open .\` | Launch the app with this project open. |
| \`context\` | \`planvideo context\` | Which project the app has open, where its playhead sits, its fonts, where its generations stand. |
| \`capture\` | \`planvideo capture <id>\` | Render frames of a scene, as an export would, to labelled PNG contact sheets. |
| \`probe\` | \`planvideo media probe <id\\|path>\` | Container and per-track metadata, without decoding. |
| \`transcribe\` | \`planvideo media transcribe <id\\|path>\` | Timed speech transcript, word by word. |
| \`grab\` | \`planvideo media grab <id\\|path>\` | Decode frames of a video to labelled PNG contact sheets. |
| \`filmstrip\` | \`planvideo media filmstrip <id\\|path>\` | Thumbnail grid across a window of a video. |
| \`waveform\` | \`planvideo media waveform <id\\|path>\` | Loudness over time, with the silences marked. |
| \`listen\` | \`planvideo media listen <id\\|path>\` | Ask a multimodal model what is in an audio track. |
| \`models\` | \`planvideo models [type]\` | Generation models and their per-model constraints. |
| \`voices\` | \`planvideo voices\` | Speech voices for \`generate.voice\`. |
| \`fonts\` | \`planvideo fonts\` | Local font families, valid as \`fontFamily\`. |
| \`logs\` | \`planvideo logs\` | Recent console output from the app. |
| \`screenshot\` | \`planvideo screenshot\` | The whole app window as a PNG. |
| \`report\` | \`planvideo report <title>\` | File a bug against the editor, with diagnostics attached. |

## Reference

- [JSX reference](https://github.com/plan-video/plan-video/blob/main/docs/reference/jsx/README.md): elements, timing, paints, generation, captions
- [Tool reference](https://github.com/plan-video/plan-video/blob/main/docs/reference/tools/README.md): every tool and command, its options and its output
- [Examples](https://github.com/plan-video/plan-video/tree/main/docs/examples): runnable compositions to read
`;

/** Ignored by git and by the project watcher. */
const APP_DIR = ".planvideo";

async function writeIfMissing(dir: string, name: string, content: string): Promise<void> {
  const path = join(dir, name);
  if (await exists(path)) return;
  noteContent(path, content);
  await writeFileAtomic(path, content);
}

async function ensurePackage(dir: string, name: string, displayName: string, entry: string): Promise<void> {
  const pkg = await readPackage(dir);
  if (!pkg) {
    await writePackage(dir, { ...packageJson(name, displayName), main: entry });
    return;
  }
  const next = { ...pkg };
  if (!recordedId(next)) next.projectId = nanoid();
  if (typeof next.displayName !== "string") next.displayName = displayName;
  if (typeof next.main !== "string") next.main = entry;
  // A project that has its own scripts keeps them.
  if (typeof next.scripts !== "object" || next.scripts === null) next.scripts = { ...SCRIPTS };
  if (
    next.projectId !== pkg.projectId ||
    next.displayName !== pkg.displayName ||
    next.main !== pkg.main ||
    next.scripts !== pkg.scripts
  ) {
    await writePackage(dir, next);
  }
}

export async function scaffold(dir: string, displayName = basename(dir)): Promise<void> {
  const entry = await ensureRecord(dir, displayName);
  if (!entry) return;
  await writeIfMissing(dir, "tsconfig.json", TSCONFIG);
  await writeIfMissing(dir, ".gitignore", GITIGNORE);
  await writeIfMissing(dir, "README.md", readme(displayName));

  if (!(await exists(join(dir, MANIFEST_FILE)))) {
    await writeManifest(dir, EMPTY_MANIFEST);
  }
}

async function ensureRecord(dir: string, displayName = basename(dir)): Promise<string | undefined> {
  let entry = await findEntry(dir);
  if (entry && !/\.tsx?$/.test(entry)) return undefined;
  if (!entry) {
    await writeIfMissing(dir, "index.tsx", STARTER);
    entry = "index.tsx";
  }
  await ensurePackage(dir, basename(dir), displayName, entry);
  return entry;
}

/** Writes as little as it takes; tsconfig, README and .gitignore come only with `scaffold`. */
export async function initProject(window: BrowserWindow | null, dir: string): Promise<ProjectInfo> {
  if (!isAbsolute(dir)) {
    throw new Error(`The project folder must be an absolute path (got "${dir}").`);
  }
  const existing = await stat(dir).catch(() => null);
  if (existing && !existing.isDirectory()) {
    throw new Error(`${dir} exists but is not a folder.`);
  }
  if (!(await confirmCloudLocation(window, dir, "Cancel"))) {
    throw new Error("Cancelled: that folder is synced.");
  }

  await mkdir(dir, { recursive: true });
  await ensureRecord(dir);
  const project = await describe(dir);
  if (!project) throw new Error(noEntryError());
  return project;
}

export async function createProject(root: string, displayName: string): Promise<ProjectInfo> {
  const dir = join(root, await freeFolder(root, folderName(displayName)));
  await mkdir(dir, { recursive: true });
  await scaffold(dir, displayName);
  const project = await describe(dir);
  if (!project) throw new Error("Failed to scaffold the project.");
  return project;
}

export async function renameProject(dir: string, displayName: string): Promise<ProjectInfo> {
  const pkg = (await readPackage(dir)) ?? packageJson(basename(dir), displayName);
  const name = displayName.trim() || basename(dir);
  await writePackage(dir, { ...pkg, displayName: name });

  const project = await describe(await renameFolder(dir, name));
  if (!project) throw new Error("Not a project folder.");
  return project;
}

/** Best effort: a locked, open or uncooperative folder must not cost the user the new name. */
async function renameFolder(dir: string, displayName: string): Promise<string> {
  const root = dirname(dir);
  const base = folderName(displayName);
  const current = basename(dir);
  // Already named after it (numbered suffix and all): leave it.
  if (current === base || (current.startsWith(`${base}-`) && /^\d+$/.test(current.slice(base.length + 1)))) {
    return dir;
  }

  try {
    const target = join(root, await freeFolder(root, base));
    unwatchProject(dir);
    await rename(dir, target);
    return target;
  } catch {
    return dir;
  }
}

export async function duplicateProject(dir: string): Promise<ProjectInfo> {
  const source = await describe(dir);
  if (!source) throw new Error("Not a project folder.");

  const root = dirname(dir);
  const target = join(root, await freeFolder(root, `${source.name}-copy`));

  await cp(dir, target, { recursive: true, errorOnExist: true, force: false });
  // The copy carries the original's id; give it its own. Written here, not via `renameProject`, which would move it.
  const pkg = await readPackage(target);
  await writePackage(target, {
    ...(pkg ?? packageJson(basename(target), source.displayName)),
    projectId: nanoid(),
    displayName: `${source.displayName} (Copy)`,
  });
  const project = await describe(target);
  if (!project) throw new Error("Failed to duplicate the project.");
  return project;
}

export async function deleteProject(dir: string): Promise<string> {
  const id = recordedId(await readPackage(dir));
  unwatchProject(dir);
  await shell.trashItem(dir);
  return id;
}

type Babel = typeof import("@babel/core");
type Esbuild = typeof import("esbuild");

function preset(name: string): unknown {
  const loaded = load<{ default?: unknown }>(name);
  return loaded.default ?? loaded;
}

const babelOptions = (file: string, filename: string, projectPlugins: PluginItem[]): TransformOptions => ({
  filename,
  babelrc: false,
  configFile: false,
  plugins: [[sourcePlugin, { file }], canonicalizeTagsPlugin, [inspectPlugin, { file }], ...projectPlugins],
  presets: [
    [preset("babel-preset-solid"), { generate: "universal", moduleName: RUNTIME_MODULE }],
    [preset("@babel/preset-typescript"), { onlyRemoveTypeImports: true }],
  ],
});

async function projectBabelPlugins(root: string, entry: string): Promise<PluginItem[]> {
  const { loadPartialConfigAsync } = load<Babel>("@babel/core");
  const partial = await loadPartialConfigAsync({ root, filename: join(root, entry), babelrc: true });
  if (!partial?.hasFilesystemConfig()) return [];
  if (partial.options.presets?.length) {
    console.warn(`[projects] babel config in ${root}: presets are not supported here and were ignored`);
  }
  return partial.options.plugins ?? [];
}

function solidLoader(root: string, projectPlugins: PluginItem[]): Plugin {
  const { transformAsync } = load<Babel>("@babel/core");
  return {
    name: "solid-universal",
    setup(build) {
      build.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
        const name = relative(root, args.path);
        if (name.startsWith("..") || name.includes(`${sep}node_modules${sep}`) || name.startsWith(`node_modules${sep}`)) {
          return undefined;
        }
        const source = await readFile(args.path, "utf8");
        // The relative name is half of every element's id, so spell it the way ./source does.
        const result = await transformAsync(source, babelOptions(name.split(sep).join("/"), args.path, projectPlugins));
        return { contents: result?.code ?? "", loader: "js" };
      });
    },
  };
}

const sourceContext = (dir: string): SourceContext => ({
  dir,
  onWrite: (file, text) => noteContent(join(dir, file), text),
});

export async function compileProject(dir: string): Promise<CompileResult> {
  const entry = await findEntry(dir);
  if (!entry) return { ok: false, error: noEntryError() };

  await ensureRecord(dir);

  // Keys every element before compiling so the canvas gets durable ids.
  await stampProject(sourceContext(dir));

  // esbuild resolves symlinks, so the loader has to match on real paths.
  const root = await realpath(dir);

  let projectPlugins: PluginItem[];
  try {
    projectPlugins = await projectBabelPlugins(root, entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to load the project's babel config: ${message}` };
  }

  try {
    const { build } = load<Esbuild>("esbuild");
    const result = await build({
      ...BUILD_OPTIONS,
      entryPoints: [join(root, entry)],
      plugins: [solidLoader(root, projectPlugins)],
    });
    return { ok: true, code: result.outputFiles![0]!.text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Not a compile: the canvas already shows these values; the watcher is told what the file will hold. */
export async function writeProject(dir: string, edits: SourceEdit[]): Promise<WriteResult> {
  try {
    return await applyEdits(sourceContext(dir), edits);
  } catch (error) {
    return { skipped: edits.map(editLabel), error: error instanceof Error ? error.message : String(error) };
  }
}

export const MANIFEST_FILE = "assets.yml";

/** Refuses a relative source that leaves the project. */
function sourcePath(dir: string, source: string): string {
  if (isAbsolute(source)) return source;
  const path = resolve(dir, source);
  if (relative(dir, path).startsWith("..")) throw new Error(`Path leaves the project: ${source}`);
  return path;
}

export async function readManifest(dir: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(join(dir, MANIFEST_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseYaml(text) ?? null;
}

/** Atomic (temp + rename), and claimed first so the watcher does not report it as a change. */
export async function writeManifest(dir: string, manifest: unknown): Promise<void> {
  const path = join(dir, MANIFEST_FILE);
  const text = `# plan.video asset library. Edited by the app; hand edits are read on the next load.
${stringifyYaml(manifest, { lineWidth: 0 })}`;
  noteContent(path, text);
  await writeFileAtomic(path, text);
}

const CONFIG_FIELD = "planvideo";
/** Older projects' field name: still read, dropped on the next write. */
const LEGACY_CONFIG_FIELD = "diffusion";

export async function readConfig(dir: string): Promise<unknown> {
  const pkg = await readPackage(dir);
  return pkg?.[CONFIG_FIELD] ?? pkg?.[LEGACY_CONFIG_FIELD] ?? null;
}

/** Null removes the field. Claimed first so the watcher stays quiet. */
export async function writeConfig(dir: string, config: unknown): Promise<void> {
  const pkg = (await readPackage(dir)) ?? packageJson(basename(dir), basename(dir));
  const next: PackageJson = { ...pkg };
  delete next[LEGACY_CONFIG_FIELD];
  if (config === null || config === undefined) delete next[CONFIG_FIELD];
  else next[CONFIG_FIELD] = config;
  await writePackage(dir, next);
}

export async function listEntries(dir: string, source: string): Promise<FsEntry[]> {
  const path = sourcePath(dir, source);
  let names: import("node:fs").Dirent[];
  try {
    names = await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries = await Promise.all(names.map(async (entry): Promise<FsEntry | null> => {
    // Symlinks count as their target, so linked media is listed; a broken link is null.
    if (!entry.isFile() && !entry.isDirectory() && !entry.isSymbolicLink()) return null;
    try {
      const info = await stat(join(path, entry.name));
      if (!info.isFile() && !info.isDirectory()) return null;
      return {
        name: entry.name,
        kind: info.isDirectory() ? "directory" : "file",
        size: info.size,
        mtime: info.mtimeMs,
        // A link may point back into a folder the caller is already inside (see `realPathEntry`).
        ...(entry.isSymbolicLink() ? { link: true } : {}),
      };
    } catch {
      return null;
    }
  }));
  return entries.filter((entry): entry is FsEntry => entry !== null);
}

export async function statEntry(dir: string, source: string): Promise<FsStat | null> {
  try {
    const info = await stat(sourcePath(dir, source));
    return { size: info.size, mtime: info.mtimeMs };
  } catch {
    return null;
  }
}

/** Lets a scan of `assets/` spot a link that doubles back into a folder it is already inside. */
export async function realPathEntry(dir: string, source: string): Promise<string | null> {
  try {
    return await realpath(sourcePath(dir, source));
  } catch {
    return null;
  }
}

/**
 * Missing is fine. A symlink is removed as itself; anything whose real place is outside the
 * project is refused, since `rm` would follow a linked folder and delete the user's originals.
 */
export async function removeEntry(dir: string, path: string): Promise<void> {
  if (isAbsolute(path)) throw new Error("Only project files can be removed");
  const target = sourcePath(dir, path);

  let root: string;
  let real: string;
  try {
    root = await realpath(dir);
    // Resolve only the parent folders, so a link inside the project counts as inside it.
    real = join(await realpath(dirname(target)), basename(target));
  } catch {
    return;
  }
  const rel = relative(root, real);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to remove ${path}: it really lives outside the project`);
  }

  noteContent(target, null);
  await rm(target, { recursive: true, force: true });
}

const watchers = new Map<string, FSWatcher>();

/**
 * Digest of what the app believes is on disk, so its own writes don't come back as changes
 * (each would cost a recompile and remount) while outside edits always do. Content
 * identity, not timing, makes this exact.
 */
const known = new Map<string, string>();

const ABSENT = "";
const FOLDER = "folder";

/** Above this, fingerprint by size + mtime: re-reading whole videos costs more than a reload. A rename keeps both. */
const DIGEST_MAX = 8 * 1024 * 1024;

const digest = (content: Buffer | string): string => createHash("sha1").update(content).digest("hex");

async function digestOf(path: string): Promise<string> {
  try {
    const info = await stat(path);
    if (info.isDirectory()) return FOLDER;
    if (info.size > DIGEST_MAX) return `${info.size}:${info.mtimeMs}`;
    return digest(await readFile(path));
  } catch {
    return ABSENT;
  }
}

/**
 * Claim before the write: the event can arrive the instant the bytes land. A failed write
 * leaves a wrong claim, which the next event corrects by reporting a change (the safe side).
 */
export function noteContent(path: string, text: string | null): void {
  if (text === null) known.set(path, ABSENT);
  else if (Buffer.byteLength(text) > DIGEST_MAX) known.delete(path);
  else known.set(path, digest(text));
}

/** For streamed writes: claimed from the temp just before the rename, which keeps bytes and mtime. */
export async function noteRenamed(temp: string, as: string): Promise<void> {
  known.set(as, await digestOf(temp));
}

export function watchProject(window: BrowserWindow | null, dir: string): void {
  if (watchers.has(dir)) return;

  // One event at a time: two reads in flight could settle out of order and leave `known`
  // holding the older content, hiding a real change.
  let queue: Promise<void> = Promise.resolve();

  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    // Project-relative and `/`-separated; installs churn node_modules constantly.
    const path = filename.split(sep).join("/");
    if (path.startsWith("node_modules/") || path === "node_modules") return;
    // A docs refresh writes the whole app folder in one burst.
    if (path.startsWith(`${APP_DIR}/`) || path === APP_DIR) return;
    if (isTempPath(path)) return;

    const file = join(dir, filename);
    queue = queue
      .then(async () => {
        const current = await digestOf(file);
        if (known.get(file) === current) return;
        known.set(file, current);
        mainBridge.emit(window, MAIN_CHANNELS.PROJECTS_CHANGED, { dir, path });
      })
      .catch(() => { });
  });
  watcher.on("error", () => unwatchProject(dir));
  watchers.set(dir, watcher);
}

export function unwatchProject(dir: string): void {
  watchers.get(dir)?.close();
  watchers.delete(dir);
  const prefix = dir.endsWith(sep) ? dir : dir + sep;
  for (const path of known.keys()) if (path.startsWith(prefix)) known.delete(path);
}

export function unwatchAll(): void {
  for (const dir of [...watchers.keys()]) unwatchProject(dir);
}
