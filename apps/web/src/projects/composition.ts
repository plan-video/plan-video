/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The web app has no compiler, so the stage cannot be written back as JSX.
// What the canvas is showing is saved here instead, and the next open mounts
// a bundle built from it. The desktop app keeps using the project source.

import { isAssetRef, serializeAssetRef } from "@plan.video/jsx";
import { authoredElement } from "@plan.video/reconciler";
import {
  Active,
  Background,
  DEFAULT_BACKGROUND,
  Root,
  Source,
  colorToHex,
  getEntityChildren,
} from "@plan.video/runtime";

import { readText, replaceText, writeText } from "./browser-store";

import type { EntityEdit } from "@/engine/editor";
import type { Entity, World } from "koota";

/** Saved next to package.json. Absent means the project is still the empty stage. */
export const COMPOSITION_FILE = "composition.json";

const DEFAULT_STAGE = colorToHex(DEFAULT_BACKGROUND);
const PENDING_SOURCE = "pending#";

/**
 * View state. It describes the session, not the composition, so it is not
 * saved — except `active`, which is put back from the trait: without it the
 * project opens on an empty timeline. Nor is the camera: an open frames the
 * stage for the window it opens in (see `settleOpeningView`).
 */
const VIEW_PROPS: ReadonlySet<string> = new Set([
  "selected",
  "active",
  "playhead",
  "timeline",
  "expanded",
  "clipHeight",
  "camera",
  "children",
  "ref",
]);

/**
 * Whether `edit` can change what is saved. Selecting, scrubbing, panning and
 * the rest of the view state never reach the file, so they never save it.
 */
export function changesComposition(edit: EntityEdit): boolean {
  return edit.kind !== "prop" || edit.name === "active" || !VIEW_PROPS.has(edit.name);
}

export interface SavedNode {
  tag: string;
  props: Record<string, unknown>;
  text?: string;
  /** `__source` to stamp on the next mount, so edits can still find the element. */
  source: string;
  children: SavedNode[];
}

export interface SavedComposition {
  version: 1;
  background?: string;
  /**
   * Where the canvas was looking. The editor no longer saves it: an open
   * frames the stage (see `settleOpeningView`).
   */
  camera?: [number, number, number, number, number, number];
  children: SavedNode[];
}

function toData(value: unknown): unknown {
  if (isAssetRef(value)) return serializeAssetRef(value);
  if (Array.isArray(value)) return value.map(toData);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry === undefined) continue;
      out[key] = toData(entry);
    }
    return out;
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    default:
      return value === null ? null : undefined;
  }
}

interface Stamp {
  taken: Set<string>;
  generated: number;
}

function freshSource(stamp: Stamp): string {
  let source: string;
  do {
    source = `index.tsx:s${++stamp.generated}`;
  } while (stamp.taken.has(source));
  stamp.taken.add(source);
  return source;
}

function captureNode(world: World, entity: Entity, source: string, stamp: Stamp): SavedNode | undefined {
  const element = authoredElement(entity);
  if (!element) return undefined;

  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(element.props)) {
    if (VIEW_PROPS.has(key)) continue;
    const data = toData(value);
    if (data !== undefined) props[key] = data;
  }
  if (entity.has(Active)) props.active = true;

  const children: SavedNode[] = [];
  for (const child of getEntityChildren(world, entity)) {
    const node = captureChild(world, child, stamp);
    if (node) children.push(node);
  }

  return {
    tag: element.tag,
    props,
    ...(element.text !== undefined ? { text: element.text } : {}),
    source,
    children,
  };
}

function captureChild(world: World, entity: Entity, stamp: Stamp): SavedNode | undefined {
  const current = entity.get(Source)?.value;
  const source = current && !current.startsWith(PENDING_SOURCE) && !stamp.taken.has(current) ? current : freshSource(stamp);
  stamp.taken.add(source);
  return captureNode(world, entity, source, stamp);
}

function capture(world: World): SavedComposition | null {
  const root = world.get(Root);
  if (!root) return null;

  const stamp: Stamp = { taken: new Set(), generated: 0 };
  const children: SavedNode[] = [];
  for (const child of getEntityChildren(world, root)) {
    const node = captureChild(world, child, stamp);
    if (node) children.push(node);
  }

  const background = colorToHex(root.get(Background)?.value ?? DEFAULT_BACKGROUND);
  if (children.length === 0 && background.toLowerCase() === DEFAULT_STAGE.toLowerCase()) return null;
  return {
    version: 1,
    ...(background.toLowerCase() === DEFAULT_STAGE.toLowerCase() ? {} : { background }),
    children,
  };
}

function isCamera(value: unknown): value is NonNullable<SavedComposition["camera"]> {
  return Array.isArray(value)
    && value.length === 6
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function isComposition(value: unknown): value is SavedComposition {
  if (!value || typeof value !== "object") return false;
  const record = value as SavedComposition;
  return record.version === 1 && Array.isArray(record.children);
}

export async function readBrowserComposition(dir: string): Promise<SavedComposition | null> {
  const text = await readText(`${dir}/${COMPOSITION_FILE}`);
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isComposition(parsed)) return null;
    if (!isCamera(parsed.camera)) delete parsed.camera;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * What a save writes for the stage `world` is showing: the composition, or
 * null for the empty default, which is kept as no file at all. The read of
 * the world is synchronous, so it is safe to call as the mount is about to
 * be torn down.
 */
export function browserCompositionText(world: World): string | null {
  const saved = capture(world);
  return saved ? `${JSON.stringify(saved)}\n` : null;
}

/**
 * Reads and saves of each composition file, one at a time, by path: a project
 * closed and opened again at once reads its file after the last save of the
 * editor that closed.
 */
const turns = new Map<string, Promise<unknown>>();

/**
 * The open editor's hold on a browser project's composition: the file as the
 * stage on the canvas read it or last saved it. A save goes through only
 * while the file still says that, so a tab never writes over a save made
 * since in another tab or on another device. Reads and saves take turns, so
 * a read never takes this tab's own save for someone else's.
 */
export function holdBrowserComposition(dir: string) {
  const path = `${dir}/${COMPOSITION_FILE}`;
  const inTurn = <T>(job: () => Promise<T>): Promise<T> => {
    const next = (turns.get(path) ?? Promise.resolve()).then(job);
    const done = next.catch(() => undefined);
    turns.set(path, done);
    void done.then(() => {
      if (turns.get(path) === done) turns.delete(path);
    });
    return next;
  };
  // One per stage, so a save the last stage left queued is still checked
  // against what that stage was built on.
  let held: { text: string | null } | undefined;

  return {
    /**
     * Runs `compile`, which reads the file, and answers with the file's text
     * as it compiled. It is read on both sides: a write from another tab in
     * between means reading again, or the stage would be held to a file it
     * never showed. After a few tries the earlier text is the one answered,
     * which at worst turns this tab's next save away.
     */
    read<T>(compile: () => Promise<T>): Promise<{ result: T; text: string | null }> {
      return inTurn(async () => {
        for (let tries = 1; ; tries++) {
          const text = await readText(path);
          const result = await compile();
          if (tries === 3 || (await readText(path)) === text) return { result, text };
        }
      });
    },
    /** The stage on the canvas is now the file's `text`, as `read` answered it. */
    adopt(text: string | null): void {
      held = { text };
    },
    /** Whether `text` is what the stage on the canvas was read from or last saved as. */
    holds(text: string | null): boolean {
      return held !== undefined && held.text === text;
    },
    /**
     * Saves the stage as `text` (see `browserCompositionText`). Resolves false
     * when the file changed since the stage read or saved it, and is left as
     * it is.
     */
    save(text: string | null): Promise<boolean> {
      const stage = held;
      return inTurn(async () => {
        if (!stage || text === stage.text) return true;
        if (!(await replaceText(path, stage.text, text))) return false;
        stage.text = text;
        return true;
      });
    },
  };
}

/** Writes a composition made outside the editor, for the next open to mount. */
export function writeBrowserComposition(dir: string, composition: SavedComposition): Promise<void> {
  return writeText(`${dir}/${COMPOSITION_FILE}`, `${JSON.stringify(composition)}\n`);
}

/**
 * The bundle the stage is showing right now. An encode mounts this rather
 * than the bundle remembered at open: the web app saves edits here and never
 * recompiles them, so that remembered copy predates the scene on the canvas.
 * Null when the stage is still the empty default.
 */
export function liveCompositionBundle(world: World): string | null {
  const saved = capture(world);
  return saved ? compositionBundle(saved) : null;
}

/** The JSX runtime a bundle requires, as far as a composition uses it. */
export type CompositionJsx = Record<string, unknown> & {
  AssetRef: new (spec: Record<string, unknown>) => unknown;
  Stage: unknown;
  createComponent(component: unknown, props: Record<string, unknown>): unknown;
  createTextNode(text: string): unknown;
};

/** How every composition bundle starts. The line after holds the saved tree as JSON. */
const BUNDLE_START = 'var import_jsx = require("@plan.video/jsx");\nvar saved = ';

/**
 * The project a composition mounts: the saved tree rebuilt with the same
 * `createComponent` calls a compiled project uses, as `compositionBundle`'s
 * text does when it's evaluated. Change one, change the other.
 */
export function compositionProject(jsx: CompositionJsx, saved: SavedComposition): () => unknown {
  type Data = Record<string, unknown>;
  const reviveInput = (value: unknown): unknown => (value && typeof value === "object" && (value as Data).$asset ? revive(value) : value);
  function revive(value: unknown): unknown {
    if (value == null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(revive);
    const asset = (value as Data).$asset;
    if (asset && typeof asset === "object" && !Array.isArray(asset)) {
      const spec: Data = {};
      for (const [key, entry] of Object.entries(asset)) {
        if (key === "refs" && Array.isArray(entry)) spec[key] = entry.map(reviveInput);
        else if (key === "startFrame" || key === "endFrame" || key === "input") spec[key] = reviveInput(entry);
        else spec[key] = entry;
      }
      return new jsx.AssetRef(spec);
    }
    const copy: Data = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = revive(entry);
    return copy;
  }
  function element(node: SavedNode): unknown {
    const props = revive(node.props) as Data;
    props.__source = node.source;
    const kids: unknown[] = [];
    if (node.text != null) kids.push(jsx.createTextNode(node.text));
    for (const child of node.children || []) kids.push(element(child));
    if (kids.length === 1) props.children = kids[0];
    else if (kids.length) props.children = kids;
    const component = jsx[node.tag.charAt(0).toUpperCase() + node.tag.slice(1)];
    if (!component) throw new Error("Unknown element <" + node.tag + ">");
    return jsx.createComponent(component, props);
  }
  return function Project() {
    const props: Data = { __source: "index.tsx:0" };
    if (saved.background) props.background = saved.background;
    if (saved.camera) props.camera = saved.camera;
    const kids = (saved.children || []).map(element);
    if (kids.length === 1) props.children = kids[0];
    else if (kids.length) props.children = kids;
    return jsx.createComponent(jsx.Stage, props);
  };
}

/**
 * A bundle `mount` can evaluate. The saved tree is embedded as JSON and
 * rebuilt with the same `createComponent` calls a compiled project uses, as
 * `compositionProject` does; the website reads it with `readCompositionBundle`
 * instead. Kept as plain text, not that function's source, so nothing a
 * bundler adds to it can leak in.
 */
export function compositionBundle(saved: SavedComposition): string {
  const json = JSON.stringify(saved).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `var import_jsx = require("@plan.video/jsx");
var saved = ${json};
function reviveInput(value) {
  return value && typeof value === "object" && value.$asset ? revive(value) : value;
}
function revive(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(revive);
  if (value.$asset && typeof value.$asset === "object" && !Array.isArray(value.$asset)) {
    var spec = {};
    var raw = value.$asset;
    for (var key in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
      var entry = raw[key];
      if (key === "refs" && Array.isArray(entry)) spec[key] = entry.map(reviveInput);
      else if (key === "startFrame" || key === "endFrame" || key === "input") spec[key] = reviveInput(entry);
      else spec[key] = entry;
    }
    return new import_jsx.AssetRef(spec);
  }
  var copy = {};
  for (var key2 in value) {
    if (Object.prototype.hasOwnProperty.call(value, key2)) copy[key2] = revive(value[key2]);
  }
  return copy;
}
function element(node) {
  var props = revive(node.props);
  props.__source = node.source;
  var kids = [];
  if (node.text != null) kids.push(import_jsx.createTextNode(node.text));
  var children = node.children || [];
  for (var i = 0; i < children.length; i++) kids.push(element(children[i]));
  if (kids.length === 1) props.children = kids[0];
  else if (kids.length) props.children = kids;
  var tag = node.tag.charAt(0).toUpperCase() + node.tag.slice(1);
  var component = import_jsx[tag];
  if (!component) throw new Error("Unknown element <" + node.tag + ">");
  return import_jsx.createComponent(component, props);
}
function Project() {
  var props = { __source: "index.tsx:0" };
  if (saved.background) props.background = saved.background;
  if (saved.camera) props.camera = saved.camera;
  var kids = (saved.children || []).map(element);
  if (kids.length === 1) props.children = kids[0];
  else if (kids.length) props.children = kids;
  return import_jsx.createComponent(import_jsx.Stage, props);
}
module.exports = { default: Project };
`;
}

/**
 * The project in a bundle `compositionBundle` wrote, without evaluating it;
 * undefined for any other bundle. Bundles remembered from older builds read
 * too: their first two lines are the same.
 */
export function readCompositionBundle(code: string, jsx: CompositionJsx): (() => unknown) | undefined {
  if (!code.startsWith(BUNDLE_START)) return undefined;
  const line = code.slice(BUNDLE_START.length, code.indexOf("\n", BUNDLE_START.length));
  return compositionProject(jsx, JSON.parse(line.slice(0, -1)) as SavedComposition);
}
