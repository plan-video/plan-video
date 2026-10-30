/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The web app has no compiler, so the stage can't be written back as JSX; the canvas's state is saved here instead.

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

/** Absent means the project is still the empty stage. */
export const COMPOSITION_FILE = "composition.json";

const DEFAULT_STAGE = colorToHex(DEFAULT_BACKGROUND);
const PENDING_SOURCE = "pending#";

/**
 * Not saved, except `active` (without it the project opens on an empty timeline). The camera isn't saved:
 * an open frames the stage for its window (see `settleOpeningView`).
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

/** View state never reaches the file, so it never saves it. */
export function changesComposition(edit: EntityEdit): boolean {
  return edit.kind !== "prop" || edit.name === "active" || !VIEW_PROPS.has(edit.name);
}

export interface SavedNode {
  tag: string;
  props: Record<string, unknown>;
  text?: string;
  /** Stamped on the next mount, so edits can still find the element. */
  source: string;
  children: SavedNode[];
}

export interface SavedComposition {
  version: 1;
  background?: string;
  /** No longer saved: an open frames the stage (see `settleOpeningView`). */
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

/** Null for the empty default, kept as no file. Synchronous, so it's safe to call as the mount is torn down. */
export function browserCompositionText(world: World): string | null {
  const saved = capture(world);
  return saved ? `${JSON.stringify(saved)}\n` : null;
}

/** One at a time per path, so a project reopened at once reads its file after the closing editor's last save. */
const turns = new Map<string, Promise<unknown>>();

/**
 * A save goes through only while the file still says what this stage read or saved, so a tab never
 * writes over a save from another tab or device.
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
  // One per stage, so a save the last stage left queued is checked against what that stage was built on.
  let held: { text: string | null } | undefined;

  return {
    /**
     * Read before and after: a write from another tab in between means reading again. After a few tries
     * the earlier text is answered, which at worst turns this tab's next save away.
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
    adopt(text: string | null): void {
      held = { text };
    },
    holds(text: string | null): boolean {
      return held !== undefined && held.text === text;
    },
    /** Resolves false, writing nothing, when the file changed since the stage read or saved it. */
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

/** For the next open to mount. */
export function writeBrowserComposition(dir: string, composition: SavedComposition): Promise<void> {
  return writeText(`${dir}/${COMPOSITION_FILE}`, `${JSON.stringify(composition)}\n`);
}

/**
 * An encode mounts this, not the bundle remembered at open: the web app never recompiles edits,
 * so that copy predates the canvas. Null for the empty default.
 */
export function liveCompositionBundle(world: World): string | null {
  const saved = capture(world);
  return saved ? compositionBundle(saved) : null;
}

export type CompositionJsx = Record<string, unknown> & {
  AssetRef: new (spec: Record<string, unknown>) => unknown;
  Stage: unknown;
  createComponent(component: unknown, props: Record<string, unknown>): unknown;
  createTextNode(text: string): unknown;
};

/** The line after holds the saved tree as JSON. */
const BUNDLE_START = 'var import_jsx = require("@plan.video/jsx");\nvar saved = ';

/** Must rebuild the tree exactly as `compositionBundle`'s text does when evaluated. Change one, change the other. */
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

/** Must match `compositionProject`. Plain text, not that function's source, so nothing a bundler adds can leak in. */
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

/** Undefined for any other bundle. Bundles from older builds read too: their first two lines are the same. */
export function readCompositionBundle(code: string, jsx: CompositionJsx): (() => unknown) | undefined {
  if (!code.startsWith(BUNDLE_START)) return undefined;
  const line = code.slice(BUNDLE_START.length, code.indexOf("\n", BUNDLE_START.length));
  return compositionProject(jsx, JSON.parse(line.slice(0, -1)) as SavedComposition);
}
