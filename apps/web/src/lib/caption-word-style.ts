/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  BlendMode,
  Cache,
  Chars,
  Color,
  Culled,
  Hidden,
  Offset,
  Opacity,
  TextStyle,
  cloneFromRecords,
  getEntityTree,
  getParentEntity,
  isStyledWord,
  serializeEntity,
} from "@plan.video/runtime";
import { SOURCE_ATTR } from "@plan.video/jsx";
import { getRuntimeDocument } from "@plan.video/reconciler";

import type { Entity, World } from "koota";
import type { EntityRecord } from "@plan.video/runtime";
import type { Transcript, TranscriptWordLayer, TranscriptWordStyle, TranscriptWordText } from "@plan.video/assets";

const PAINTS = ["fills", "strokes", "shadows"] as const;
/** The caption's own apply to its whole layer. */
const OWN = ["effects", "animations"] as const;
const LAYERS = [...PAINTS, ...OWN] as const;
const TEXT_FIELDS = ["fontFamily", "fontWeight", "fontSize", "fontStyle", "letterSpacing", "textCase", "textBaseline"] as const;
const SCALARS = ["color", "opacity", "blendMode", "hidden", "offsetX", "offsetY"] as const;

type LayerKind = (typeof LAYERS)[number];
type Scalar = (typeof SCALARS)[number];

export type WordSetting = (typeof TEXT_FIELDS)[number] | Scalar | LayerKind;

const DEFAULT_COLOR = 0xffffff;

export type WordLook = {
  text: TranscriptWordText;
  color?: number;
  opacity: number;
  blendMode: number;
  hidden: boolean;
  offsetX: number;
  offsetY: number;
} & Record<LayerKind, TranscriptWordLayer[]>;

let proxies = 0;

/** For the caption itself, only what a word takes from it is read: the rest applies to its whole layer. */
export function readLook(world: World, entity: Entity, caption = false): WordLook {
  const style = entity.get(TextStyle);
  const text: Record<string, unknown> = {};
  for (const field of TEXT_FIELDS) {
    const value = style?.[field];
    if (value !== undefined) text[field] = value;
  }
  // No spacing is 0, which the panel writes as the prop's absence.
  text.letterSpacing ??= 0;

  const cache = entity.get(Cache);
  return {
    text: text as TranscriptWordText,
    ...(entity.has(Color) ? { color: entity.get(Color)!.value } : {}),
    opacity: !caption && entity.has(Opacity) ? entity.get(Opacity)!.value : 1,
    blendMode: !caption && entity.has(BlendMode) ? entity.get(BlendMode)!.value : 0,
    hidden: !caption && entity.has(Hidden),
    offsetX: caption ? 0 : (entity.get(Offset)?.x ?? 0),
    offsetY: caption ? 0 : (entity.get(Offset)?.y ?? 0),
    fills: layerRecords(world, cache?.fills ?? []),
    strokes: layerRecords(world, cache?.strokes ?? []),
    shadows: layerRecords(world, cache?.shadows ?? []),
    effects: caption ? [] : layerRecords(world, cache?.effects ?? []),
    animations: caption ? [] : layerRecords(world, cache?.animations ?? []),
  };
}

export function wordLook(style: TranscriptWordStyle | undefined, caption: WordLook): WordLook {
  return {
    text: { ...caption.text, ...style?.text },
    color: style?.color ?? caption.color ?? DEFAULT_COLOR,
    opacity: style?.opacity ?? caption.opacity,
    blendMode: style?.blendMode ?? caption.blendMode,
    hidden: style?.hidden ?? caption.hidden,
    offsetX: style?.offsetX ?? caption.offsetX,
    offsetY: style?.offsetY ?? caption.offsetY,
    fills: style?.fills ?? caption.fills,
    strokes: style?.strokes ?? caption.strokes,
    shadows: style?.shadows ?? caption.shadows,
    effects: style?.effects ?? caption.effects,
    animations: style?.animations ?? caption.animations,
  };
}

export function mixedSettings(looks: readonly WordLook[]): ReadonlySet<WordSetting> {
  const mixed = new Set<WordSetting>();
  const [first, ...rest] = looks;
  if (!first) return mixed;
  for (const look of rest) {
    for (const field of TEXT_FIELDS) if (look.text[field] !== first.text[field]) mixed.add(field);
    for (const scalar of SCALARS) if (look[scalar] !== first[scalar]) mixed.add(scalar);
    for (const kind of LAYERS) if (!sameLayers(look[kind], first[kind])) mixed.add(kind);
  }
  return mixed;
}

/** Their order is written into `ItemIndex`, so two lists that look the same compare the same. */
function layerRecords(world: World, list: readonly Entity[]): TranscriptWordLayer[] {
  const ids = new Map<Entity, number>();
  const members: Entity[] = [];
  for (const top of list) {
    for (const entity of getEntityTree(world, top)) {
      ids.set(entity, ids.size + 1);
      members.push(entity);
    }
  }

  return members.map((entity) => {
    const { id: _id, eid: _eid, ChildOf: _parent, MountScript: _script, MountPath: _path, ...traits } = serializeEntity(entity);
    const parent = getParentEntity(entity);
    const top = list.indexOf(entity);
    return {
      ...traits,
      ...(top === -1 ? {} : { ItemIndex: top }),
      eid: ids.get(entity)!,
      ChildOf: parent && ids.has(parent) ? ids.get(parent)! : 0,
    };
  });
}

/** Every entity carries a source, so the editor reports what happens to it (see `DocumentEditor.aside`). */
export function createWordProxy(world: World, caption: Entity, style: TranscriptWordStyle | undefined, text: string): Entity {
  const document = getRuntimeDocument(world);
  const node = document.createElement("Text");
  const source = `caption-words:${++proxies}`;
  document.setProperty(node, SOURCE_ATTR, source);

  const proxy = node.entity;
  // Kept out of the motion system: its animations are the word's, and the panels read the values it would move.
  proxy.add(Culled);

  const look = wordLook(style, readLook(world, caption, true));
  proxy.set(TextStyle, look.text);
  proxy.add(Color);
  proxy.set(Color, { value: look.color! });
  if (look.opacity !== 1) {
    proxy.add(Opacity);
    proxy.set(Opacity, { value: look.opacity });
  }
  if (look.blendMode !== 0) {
    proxy.add(BlendMode);
    proxy.set(BlendMode, { value: look.blendMode });
  }
  if (look.hidden) proxy.add(Hidden);
  proxy.add(Offset);
  proxy.set(Offset, { x: look.offsetX, y: look.offsetY });
  proxy.set(Chars, { value: text });

  let stamp = 0;
  for (const kind of LAYERS) {
    const layers = look[kind];
    if (layers.length === 0) continue;

    const records = layers.map((layer) => ({
      ...(layer as unknown as EntityRecord),
      id: String(layer.eid),
      ChildOf: layer.ChildOf ? layer.ChildOf : undefined,
    }));
    const clones = cloneFromRecords(world, records);
    for (const layer of layers) {
      const entity = clones.get(layer.eid);
      if (!entity?.isAlive()) continue;
      if (!layer.ChildOf) document.insertNode(node, document.node(entity));
    }
    for (const entity of clones.values()) {
      if (entity.isAlive()) document.setProperty(document.node(entity), SOURCE_ATTR, `${source}/${++stamp}`);
    }
  }

  return proxy;
}

export function disposeWordProxy(proxy: Entity): void {
  if (proxy.isAlive()) proxy.destroy();
}

const sameLayers = (a: TranscriptWordLayer[], b: TranscriptWordLayer[]) => JSON.stringify(a) === JSON.stringify(b);

/** Only changed fields are written, so other picked words keep theirs; a field back at the caption's look is dropped. */
export function restyleWord(
  style: TranscriptWordStyle | undefined,
  before: WordLook,
  after: WordLook,
  caption: WordLook,
): TranscriptWordStyle | undefined {
  const next: TranscriptWordStyle = { ...style };
  const text: Record<string, unknown> = { ...style?.text };

  for (const field of TEXT_FIELDS) {
    const value = after.text[field];
    if (value === before.text[field]) continue;
    if (value === undefined || value === caption.text[field]) delete text[field];
    else text[field] = value;
  }
  if (Object.keys(text).length > 0) next.text = text as TranscriptWordText;
  else delete next.text;

  for (const scalar of SCALARS) {
    const value = after[scalar];
    if (value === before[scalar]) continue;
    if (value === undefined || value === caption[scalar]) delete next[scalar];
    else (next as Record<Scalar, unknown>)[scalar] = value;
  }

  for (const kind of LAYERS) {
    if (sameLayers(after[kind], before[kind])) continue;
    if (sameLayers(after[kind], caption[kind])) delete next[kind];
    else next[kind] = after[kind];
  }

  return isStyledWord(next) ? next : undefined;
}

export function restyleWords(
  transcript: Transcript,
  positions: ReadonlySet<number>,
  restyle: (style: TranscriptWordStyle | undefined) => TranscriptWordStyle | undefined,
): Transcript {
  let position = 0;
  return transcript.map((segment) => ({
    text: segment.text,
    words: segment.words.map((word) => {
      const copy = { ...word };
      if (!positions.has(position++)) return copy;
      const style = restyle(word.style);
      if (style) copy.style = style;
      else delete copy.style;
      return copy;
    }),
  }));
}
