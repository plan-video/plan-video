/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What the editor's AI can do, and how each of those runs against the world
// on screen. Every change goes through the document editor, one undo step per
// tool call, so an AI edit is the same edit a user would make by hand.

import { createImageEncoder } from "@plan.video/encoder";
import { TIME_FPS } from "@plan.video/jsx";
import { authoredElement, renderAuthored } from "@plan.video/reconciler";
import {
  Computed,
  FrameRate,
  Library,
  Playback,
  Root,
  Selected,
  Source,
  getActiveEntity,
  getEntityChildren,
  isScene,
  setPlayhead,
  store,
  togglePlayback,
} from "@plan.video/runtime";

import { createCapture } from "@/engine/capture";
import { getDocumentEditor } from "@/engine/editor";
import { getEditHistory } from "@/engine/history";
import { splitAtPlayhead } from "@/engine/split";
import { moveEntityTo, trimIn, trimOut } from "@/engine/timing";

import { editCaptionWords, readCaptionWords, type WordEdit, type WordInsert } from "./caption-words";

import type { AuthoredTree } from "@plan.video/reconciler";
import type { Entity, World } from "koota";

/** What a tool hands back: text for the model, and any frames it should look at. */
export type ToolOutput = {
  text: string;
  images?: { mediaType: "image/png"; data: string }[];
};

export type ToolContext = { world: World; dir: string };

// --- ids ------------------------------------------------------------------

const idOf = (entity: Entity): string => `e${entity.id()}`;

function resolve(world: World, value: unknown): Entity {
  const match = typeof value === "string" ? /^e?(\d+)$/.exec(value.trim()) : null;
  if (!match) throw new Error(`Not an element id: ${JSON.stringify(value)}`);
  const wanted = Number(match[1]);
  const found = world.query(Source).find((entity) => entity.id() === wanted);
  if (!found || !found.isAlive()) throw new Error(`No element ${value}. Call get_editor_state for current ids.`);
  return found;
}

const resolveAll = (world: World, values: unknown): Entity[] =>
  (Array.isArray(values) ? values : []).map((value) => resolve(world, value));

function activeScene(world: World): Entity {
  const scene = getActiveEntity(world);
  if (!scene || !isScene(scene)) throw new Error("No active scene. Ask the user to open or create one.");
  return scene;
}

const frameRate = (world: World): number => world.get(FrameRate)?.value || 30;
const round = (value: number): number => Math.round(value * 1000) / 1000;

// --- reading ------------------------------------------------------------

const HIDDEN_PROPS = new Set(["children", "ref", "selected", "timeline", "playhead", "expanded", "clipHeight"]);
const MAX_STRING = 400;

function describeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (HIDDEN_PROPS.has(key) || key.startsWith("__") || value === undefined) continue;
    if (typeof value === "function") continue;
    out[key] = typeof value === "string" && value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  return out;
}

type NodeView = {
  id: string;
  tag: string;
  props: Record<string, unknown>;
  text?: string;
  time?: [number, number];
  children?: NodeView[];
};

function describe(world: World, entity: Entity, depth: number): NodeView | null {
  const authored = authoredElement(entity);
  if (!authored) return null;
  const computed = store(world, Computed);
  const fps = frameRate(world);
  const start = computed.start[entity.id()];
  const end = computed.end[entity.id()];

  const view: NodeView = { id: idOf(entity), tag: authored.tag, props: describeProps(authored.props) };
  if (authored.text !== undefined) view.text = authored.text;
  if (start !== undefined && end !== undefined && !isScene(entity)) view.time = [round(start / fps), round(end / fps)];

  if (depth < 12) {
    const children = getEntityChildren(world, entity)
      .map((child) => describe(world, child, depth + 1))
      .filter((child): child is NodeView => child !== null);
    if (children.length) view.children = children;
  }
  return view;
}

function editorState(world: World): unknown {
  const scene = activeScene(world);
  const fps = frameRate(world);
  const computed = store(world, Computed);
  const root = world.get(Root);
  const others = root
    ? getEntityChildren(world, root)
      .filter((entity) => isScene(entity) && entity !== scene)
      .map((entity) => ({ id: idOf(entity), name: authoredElement(entity)?.props.name ?? null }))
    : [];

  return {
    frameRate: fps,
    playhead: round((computed.localTime[scene.id()] ?? 0) / fps),
    duration: round((computed.end[scene.id()] ?? 0) / fps),
    playing: !!scene.get(Playback)?.playing,
    selection: [...world.query(Selected)].map(idOf),
    scene: describe(world, scene, 0),
    otherScenes: others,
  };
}

function listAssets(world: World): unknown {
  const library = world.get(Library);
  if (!library) return [];
  return library.list()
    .filter((asset) => asset.type !== "SCRIPT")
    .map((asset) => ({
      path: asset.path,
      type: asset.type,
      ...("duration" in asset ? { duration: round(asset.duration) } : {}),
      ...("width" in asset ? { width: asset.width, height: asset.height } : {}),
    }));
}

// --- editing ------------------------------------------------------------

function toTree(value: unknown): AuthoredTree {
  if (!value || typeof value !== "object") throw new Error("An element must be an object with a tag and props.");
  const entry = value as { tag?: unknown; props?: unknown; text?: unknown; children?: unknown };
  if (typeof entry.tag !== "string" || !/^[a-z][A-Za-z]*$/.test(entry.tag)) throw new Error(`Not a tag: ${JSON.stringify(entry.tag)}`);
  const props = entry.props && typeof entry.props === "object" ? { ...(entry.props as Record<string, unknown>) } : {};
  delete props.children;
  return {
    tag: entry.tag,
    props,
    ...(typeof entry.text === "string" ? { text: entry.text } : {}),
    children: (Array.isArray(entry.children) ? entry.children : []).map(toTree),
  } as AuthoredTree;
}

function collectIds(world: World, entities: Entity[]): string[] {
  const out: string[] = [];
  const walk = (entity: Entity) => {
    out.push(idOf(entity));
    for (const child of getEntityChildren(world, entity)) walk(child);
  };
  entities.forEach(walk);
  return out;
}

/** Runs `edit` as one undo step. */
function gesture<T>(world: World, edit: () => T): T {
  const history = getEditHistory(world);
  history.beginGesture();
  try {
    return edit();
  } finally {
    history.endGesture();
  }
}

async function captureFrames(ctx: ToolContext, times: unknown): Promise<ToolOutput> {
  const list = (Array.isArray(times) ? times : [0]).filter((t): t is number => typeof t === "number").slice(0, 6);
  if (!list.length) list.push(0);
  const scene = activeScene(ctx.world);
  const target = await createCapture(ctx.world, scene, { dir: ctx.dir });
  try {
    const encoder = await createImageEncoder(target.world, { frames: list.map((t) => Math.round(t * TIME_FPS)), resolution: 720 });
    const result = await encoder.render();
    if (result.type === "canceled") throw new Error("Capture canceled");
    if (result.type === "error") throw result.error;
    return {
      text: `Captured ${result.data.length} frame(s): ${result.data.map((shot) => shot.timecode).join(", ")}`,
      images: result.data.map((shot) => ({ mediaType: "image/png", data: toBase64(shot.png) })),
    };
  } finally {
    target.dispose();
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const json = (value: unknown): ToolOutput => ({ text: JSON.stringify(value) });

export async function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<ToolOutput> {
  const { world } = ctx;
  const editor = getDocumentEditor(world);
  const fps = frameRate(world);

  switch (name) {
    case "get_editor_state":
      return json(editorState(world));

    case "list_assets":
      return json(listAssets(world));

    case "update_elements": {
      const updates = Array.isArray(input.updates) ? input.updates : [];
      gesture(world, () => {
        for (const update of updates as { id: unknown; props?: Record<string, unknown>; text?: unknown }[]) {
          const entity = resolve(world, update.id);
          for (const [key, value] of Object.entries(update.props ?? {})) {
            if (key === "children") continue;
            editor.editProperty(entity, key, value as never);
          }
          if (typeof update.text === "string") editor.editText(entity, update.text);
        }
      });
      return { text: `Updated ${updates.length} element(s).` };
    }

    case "insert_elements": {
      const parent = resolve(world, input.parent_id);
      const anchor = input.before_id ? resolve(world, input.before_id) : undefined;
      const trees = (Array.isArray(input.elements) ? input.elements : []).map(toTree);
      const created = gesture(world, () => editor.insertElement(parent, () => trees.map(renderAuthored), anchor));
      if (!created.length) throw new Error("Nothing was inserted. Check the parent id and the tags.");
      return json({ inserted: created.map(idOf), allIds: collectIds(world, created) });
    }

    case "delete_elements": {
      const targets = resolveAll(world, input.ids);
      const removed = gesture(world, () => editor.remove(targets));
      return { text: `Removed ${removed.length} element(s).` };
    }

    case "duplicate_elements": {
      const targets = resolveAll(world, input.ids);
      const copies = gesture(world, () => editor.duplicate(targets));
      return json({ copies: copies.map(idOf) });
    }

    case "move_element": {
      const entity = resolve(world, input.id);
      const parent = resolve(world, input.parent_id);
      const anchor = input.before_id ? resolve(world, input.before_id) : undefined;
      const moved = gesture(world, () => editor.reparent(entity, parent, anchor));
      if (!moved) throw new Error("That move is not allowed here.");
      return { text: "Moved." };
    }

    case "split_clips": {
      const scene = activeScene(world);
      const time = Number(input.time);
      if (!Number.isFinite(time)) throw new Error("time must be a number of seconds.");
      const targets = input.ids ? resolveAll(world, input.ids) : [];
      setPlayhead(world, scene, Math.round(time * fps));
      const tails = gesture(world, () => {
        if (targets.length) editor.select(targets);
        else editor.clearSelection();
        return splitAtPlayhead(world);
      });
      if (!tails.length) throw new Error(`No clip is under ${time}s${targets.length ? " among those ids" : ""}.`);
      return json({ secondHalves: tails.map(idOf) });
    }

    case "trim_clip": {
      const entity = resolve(world, input.id);
      gesture(world, () => {
        if (typeof input.start === "number") trimIn(world, entity, Math.round(input.start * fps));
        if (typeof input.end === "number") trimOut(world, entity, Math.round(input.end * fps));
      });
      return { text: "Trimmed." };
    }

    case "move_clip_to": {
      const entity = resolve(world, input.id);
      const start = Number(input.start);
      if (!Number.isFinite(start)) throw new Error("start must be a number of seconds.");
      gesture(world, () => moveEntityTo(world, entity, Math.round(start * fps)));
      return { text: "Moved in time." };
    }

    case "set_playhead": {
      const scene = activeScene(world);
      if (typeof input.time === "number") setPlayhead(world, scene, Math.round(input.time * fps));
      if (typeof input.playing === "boolean" && input.playing !== !!scene.get(Playback)?.playing) togglePlayback(world, scene);
      return { text: "Done." };
    }

    case "select_elements": {
      const targets = resolveAll(world, input.ids);
      if (targets.length) editor.select(targets);
      else editor.clearSelection();
      return { text: `Selected ${targets.length}.` };
    }

    case "capture_frames":
      return captureFrames(ctx, input.times);

    case "get_caption_words":
      return json(await readCaptionWords(world, resolve(world, input.id)));

    case "edit_caption_words": {
      const caption = resolve(world, input.id);
      const text = await editCaptionWords(world, caption, {
        edits: Array.isArray(input.edits) ? input.edits.map((edit: { style?: { children?: unknown } }) => ({
          ...edit,
          ...(edit.style ? { style: { ...edit.style, children: Array.isArray(edit.style.children) ? edit.style.children.map(toTree) : undefined } } : {}),
        })) as WordEdit[] : undefined,
        remove: Array.isArray(input.remove) ? input.remove as number[] : undefined,
        insert: Array.isArray(input.insert) ? input.insert as WordInsert[] : undefined,
      });
      return { text };
    }

    case "undo":
      getEditHistory(world).undo();
      return { text: "Undone." };

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}