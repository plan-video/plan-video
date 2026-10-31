// The empty composition is compiled ahead of time: the browser has no esbuild.

import type { CompileResult, ProjectInfo, SourceEdit, WriteResult } from "./types";
import type { FsEntry, Manifest, ProjectFS } from "@plan.video/assets";
import { isAbsoluteSource } from "@plan.video/assets";
import { formatSource } from "@plan.video/jsx";
import { setBundleReader } from "@plan.video/reconciler";

import { t } from "@/lib/i18n";
import {
  compositionBundle,
  compositionProject,
  readBrowserComposition,
  readCompositionBundle,
  type CompositionJsx,
  type SavedNode,
} from "./composition";
import {
  baseName,
  copyTree,
  existsPath,
  listDirectory,
  parentPath,
  readBytes,
  readText,
  removeTree,
  statPath,
  writeBytes,
  writeText,
} from "./browser-store";

export const BROWSER_PROJECTS_ROOT = "/browser/projects";

const STARTER = `export default function Project() {
  return (
    <stage background="#161616">
    </stage>
  )
}
`;

// The desktop compiler's output for STARTER. A lowercase createElement("stage") would be a DOM node,
// which the renderer refuses outside <html>.
const STARTER_BUNDLE = `var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  default: () => Project
});
module.exports = __toCommonJS(index_exports);
var import_jsx = require("@plan.video/jsx");
var import_jsx2 = require("@plan.video/jsx");
function Project() {
  return (0, import_jsx.createComponent)(import_jsx2.Stage, {
    background: "#161616",
    __source: "index.tsx:0"
  });
}
`;

// The website reads bundles rather than evaluating them: its CSP has no 'unsafe-eval' (content-security-policy.ts).
setBundleReader((code, require) => {
  const jsx = require("@plan.video/jsx") as CompositionJsx;
  if (code === STARTER_BUNDLE) return compositionProject(jsx, { version: 1, background: "#161616", children: [] });
  return readCompositionBundle(code, jsx);
});

const EMPTY_MANIFEST: Manifest = { version: 1, folders: [], assets: [] };

interface PackageJson {
  name?: string;
  projectId?: string;
  displayName?: string;
  main?: string;
  private?: boolean;
  type?: string;
  planvideo?: unknown;
  /** Read once, from before the rename. */
  diffusion?: unknown;
}

export const isBrowserProjectDir = (dir: string): boolean =>
  dir === BROWSER_PROJECTS_ROOT || dir.startsWith(`${BROWSER_PROJECTS_ROOT}/`);

export const folderSlug = (displayName: string): string => {
  const slug = displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "project";
};

export async function freeFolder(root: string, slug: string): Promise<string> {
  if (!(await existsPath(`${root}/${slug}`))) return slug;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${slug}-${n}`;
    if (!(await existsPath(`${root}/${candidate}`))) return candidate;
  }
  return `${slug}-${crypto.randomUUID()}`;
}

async function readPackage(dir: string): Promise<PackageJson | null> {
  const text = await readText(`${dir}/package.json`);
  if (!text) return null;
  try {
    return JSON.parse(text) as PackageJson;
  } catch {
    return null;
  }
}

async function describe(dir: string): Promise<ProjectInfo | null> {
  const pkg = await readPackage(dir);
  if (!pkg?.projectId) return null;
  const entry = pkg.main || "index.tsx";
  const stat = await statPath(`${dir}/${entry}`);
  const now = new Date().toISOString();
  return {
    id: pkg.projectId,
    name: baseName(dir),
    displayName: pkg.displayName || baseName(dir),
    dir,
    entry,
    modifiedAt: stat ? new Date(stat.mtime).toISOString() : now,
    createdAt: now,
  };
}

export async function browserCreateProject(root: string, displayName: string): Promise<ProjectInfo> {
  const name = displayName.trim() || t("Untitled");
  const folder = await freeFolder(root, folderSlug(name));
  const dir = `${root}/${folder}`;
  const now = new Date().toISOString();
  const pkg: PackageJson = {
    name: folder,
    projectId: crypto.randomUUID(),
    displayName: name,
    private: true,
    type: "module",
    main: "index.tsx",
  };
  await writeText(`${dir}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`);
  await writeText(`${dir}/index.tsx`, STARTER);
  await writeText(`${dir}/assets.yml`, `${JSON.stringify(EMPTY_MANIFEST, null, 2)}\n`);
  // describe() uses "now" for both clocks; the entry mtime is the one the dashboard sorts on.
  const project = await describe(dir);
  if (!project) throw new Error("Failed to scaffold the project.");
  project.createdAt = now;
  return project;
}

export async function browserGetProject(dir: string): Promise<ProjectInfo | null> {
  if (!isBrowserProjectDir(dir)) return null;
  return describe(dir);
}

export async function browserDeleteProject(dir: string): Promise<void> {
  await removeTree(dir);
}

/** Inside the folder, so the trash travels to other browsers with the project's files. */
export const TRASHED_FILE = ".trashed";
/** Kept in the folder for the same reason. */
export const COVER_FILE = ".cover";

export async function browserMarkTrashed(dir: string, at: string | null): Promise<void> {
  if (at) await writeText(`${dir}/${TRASHED_FILE}`, at);
  else if (await existsPath(`${dir}/${TRASHED_FILE}`)) await removeTree(`${dir}/${TRASHED_FILE}`);
}

/** Not for a project that's gone. */
export async function browserKeepCover(dir: string, cover: Blob): Promise<void> {
  if (!(await existsPath(`${dir}/package.json`))) return;
  await writeBytes(`${dir}/${COVER_FILE}`, new Uint8Array(await cover.arrayBuffer()));
}

/** As `<name>-copy`, with a new id. */
export async function browserDuplicateProject(dir: string): Promise<ProjectInfo> {
  const source = await describe(dir);
  if (!source) throw new Error("Not a project folder.");

  const root = parentPath(dir);
  const folder = await freeFolder(root, `${source.name}-copy`);
  const target = `${root}/${folder}`;
  await copyTree(dir, target);

  const pkg = (await readPackage(target)) ?? {};
  await writeText(
    `${target}/package.json`,
    `${JSON.stringify({ ...pkg, name: folder, projectId: crypto.randomUUID(), displayName: t("{name} (Copy)", { name: source.displayName }) }, null, 2)}\n`,
  );

  const project = await describe(target);
  if (!project) throw new Error("Failed to duplicate the project.");
  project.createdAt = new Date().toISOString();
  return project;
}

export async function browserRenameProject(dir: string, displayName: string): Promise<ProjectInfo> {
  const pkg = (await readPackage(dir)) ?? {};
  const name = displayName.trim() || baseName(dir);
  await writeText(`${dir}/package.json`, `${JSON.stringify({ ...pkg, displayName: name }, null, 2)}\n`);
  const project = await describe(dir);
  if (!project) throw new Error("Not a project folder.");
  return project;
}

export async function browserCompileProject(dir: string): Promise<CompileResult> {
  // The saved stage wins over index.tsx: the web app can't compile the source file.
  const saved = await readBrowserComposition(dir);
  if (saved) {
    // Its sources go on the stage now, so no insert may be given one.
    takeSources(saved.children);
    return { ok: true, code: compositionBundle(saved) };
  }

  const source = await readText(`${dir}/index.tsx`);
  if (source?.trim() === STARTER.trim()) return { ok: true, code: STARTER_BUNDLE };
  return {
    ok: false,
    error: t("This browser project can open the empty stage. Editing the source file isn't available in the browser."),
  };
}

const CONFIG_FIELD = "planvideo" as const;
/** Still read, and dropped on the next write. */
const LEGACY_CONFIG_FIELD = "diffusion" as const;

export async function browserReadConfig(dir: string): Promise<unknown> {
  const pkg = await readPackage(dir);
  return pkg?.[CONFIG_FIELD] ?? pkg?.[LEGACY_CONFIG_FIELD] ?? null;
}

/** Null removes the field and leaves the rest of the record. */
export async function browserWriteConfig(dir: string, config: unknown): Promise<void> {
  const pkg = (await readPackage(dir)) ?? {};
  const next: PackageJson = { ...pkg };
  delete next[LEGACY_CONFIG_FIELD];
  if (config === null || config === undefined) delete next[CONFIG_FIELD];
  else next[CONFIG_FIELD] = config;
  await writeText(`${dir}/package.json`, `${JSON.stringify(next, null, 2)}\n`);
}

// The browser can't rewrite JSX, so each insert keeps a source of its own. That source is saved and mounted on
// every later open, so it must miss every source the project holds: a clash would make undo delete the wrong element.
const ID_LENGTH = 6;
const ID_SPACE = 36 ** ID_LENGTH;
const takenSources = new Set<string>();

function takeSources(nodes: SavedNode[]): void {
  for (const node of nodes) {
    takenSources.add(node.source);
    takeSources(node.children);
  }
}

function freshSource(): string {
  while (true) {
    // The letter keeps the id from reading as a position (see `parseSource`).
    const id = Math.floor(Math.random() * ID_SPACE).toString(36).padStart(ID_LENGTH, "0");
    const source = formatSource("index.tsx", `b${id}`);
    if (takenSources.has(source)) continue;
    takenSources.add(source);
    return source;
  }
}

export function browserWriteProject(edits: SourceEdit[] = []): WriteResult {
  const ids: Record<string, string> = {};
  for (const edit of edits) {
    if (edit.kind !== "insert") continue;
    ids[edit.source] = freshSource();
  }
  return {
    skipped: [],
    ...(Object.keys(ids).length ? { ids } : {}),
  };
}

export async function browserReadManifest(dir: string): Promise<Manifest> {
  const text = await readText(`${dir}/assets.yml`);
  if (!text) return EMPTY_MANIFEST;
  try {
    return JSON.parse(text) as Manifest;
  } catch {
    return EMPTY_MANIFEST;
  }
}

export async function browserWriteManifest(dir: string, manifest: Manifest): Promise<void> {
  await writeText(`${dir}/assets.yml`, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function createBrowserProjectFS(dir: string): ProjectFS {
  const absolute = (source: string): string =>
    isAbsoluteSource(source) ? source : `${dir}/${source.replace(/^\/+/, "")}`;

  return {
    absolute,
    readManifest: () => browserReadManifest(dir),
    writeManifest: (manifest) => browserWriteManifest(dir, manifest),
    list: async (source): Promise<FsEntry[]> => {
      const path = absolute(source);
      if (!(await existsPath(path))) return [];
      return listDirectory(path);
    },
    stat: (source) => statPath(absolute(source)),
    file: async (source) => {
      const path = absolute(source);
      const data = await readBytes(path);
      if (!data) throw new Error(`No such file: ${path}`);
      // File wants an ArrayBuffer-backed view; IndexedDB hands back ArrayBufferLike.
      const bytes = new Uint8Array(data.byteLength);
      bytes.set(data);
      return new File([bytes], baseName(path));
    },
    write: async (path, blob) => {
      await writeBytes(absolute(path), new Uint8Array(await blob.arrayBuffer()));
    },
    remove: (path) => removeTree(absolute(path)),
    pathOf: () => null,
  };
}
