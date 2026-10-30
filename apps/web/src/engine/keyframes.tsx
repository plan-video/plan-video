/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Keyframes as document edits, so the file hears about them: a keyframed prop is a
// `<keyframeTrack property>` of `<keyframe time value easing>` children under its element.

import { Keyframe as KeyframeElement, KeyframeTrack as KeyframeTrackElement, trackPropertyPath } from "@plan.video/reconciler";
import {
  Cache,
  ChildOf,
  Expanded,
  Keyframe,
  KeyframeTrack,
  Scene,
  FrameRate,
  colorToHex,
  findKeyframeTargetNode,
  framesToSeconds,
  getNodeLocalFrame,
  getParentNode,
  getPropertyPaths,
} from "@plan.video/runtime";

import type { AnimatableProperty } from "@plan.video/jsx";
import type { Entity, World } from "koota";
import type { DocumentEditor } from "./editor";

export function findKeyframeTrack(world: World, target: Entity, property: AnimatableProperty): Entity | null {
  const path = trackPropertyPath(target, property);
  if (!path) return null;
  for (const track of world.query(KeyframeTrack, ChildOf(target))) {
    if (track.get(KeyframeTrack)!.property === path) return track;
  }
  return null;
}

export function findKeyframeAt(track: Entity, frame: number): Entity | null {
  const keyframes = track.get(Cache)?.keyframes ?? [];
  return keyframes.find((keyframe) => Math.round(keyframe.get(Keyframe)!.time) === frame) ?? null;
}

/** Its node's frame, in the node's source time. */
export function keyframeFrame(target: Entity): number | null {
  const node = findKeyframeTargetNode(target);
  return node === null ? null : getNodeLocalFrame(node);
}

/** The computed value, which a new keyframe here should hold; colors as CSS hex. */
function currentValue(world: World, target: Entity, property: AnimatableProperty): number | string | null {
  const path = trackPropertyPath(target, property);
  if (!path) return null;
  const value = getPropertyPaths(world)[path]?.computed[target.id()];
  if (typeof value !== "number") return null;
  return property === "color" ? colorToHex(value) : value;
}

/** Seconds at this project's frame rate, as the file spells it. */
function keyframeTime(world: World, frame: number): number {
  return framesToSeconds(frame, world.get(FrameRate)?.value ?? 30);
}

/** Null when the target is not keyframable: no node above it, no source to write under, or no such property. */
export function writeKeyframe(world: World, editor: DocumentEditor, target: Entity, property: AnimatableProperty, value?: number | string): Entity | null {
  const frame = keyframeFrame(target);
  if (frame === null) return null;
  const held = value ?? currentValue(world, target, property);
  if (held === null) return null;

  const track = findKeyframeTrack(world, target, property);
  const existing = track && findKeyframeAt(track, frame);
  if (existing) {
    editor.editProperty(existing, "value", held);
    return existing;
  }

  const time = keyframeTime(world, frame);
  if (track) {
    const [keyframe] = editor.insertElement(track, () => <KeyframeElement time={time} value={held} />);
    if (keyframe) revealKeyframes(editor, target);
    return keyframe ?? null;
  }

  const [created] = editor.insertElement(target, () => (
    <KeyframeTrackElement property={property}>
      <KeyframeElement time={time} value={held} />
    </KeyframeTrackElement>
  ));
  if (!created) return null;
  revealKeyframes(editor, target);
  return findKeyframeAt(created, frame);
}

/** Adding a keyframe expands the rows that show it; writing onto an existing one leaves the timeline alone. */
function revealKeyframes(editor: DocumentEditor, target: Entity): void {
  let current: Entity | null = target;
  while (current && !current.has(Scene)) {
    if (!current.has(Expanded)) editor.editProperty(current, "expanded", true);
    current = getParentNode(current);
  }
}

/** The track goes with its last keyframe. */
export function toggleKeyframe(world: World, editor: DocumentEditor, target: Entity, property: AnimatableProperty): void {
  const frame = keyframeFrame(target);
  if (frame === null) return;

  const track = findKeyframeTrack(world, target, property);
  const existing = track && findKeyframeAt(track, frame);
  if (!existing) {
    writeKeyframe(world, editor, target, property);
    return;
  }

  const last = (track.get(Cache)?.keyframes.length ?? 0) <= 1;
  editor.remove(last ? track : existing);
}

/**
 * Call after writing a keyframed prop, or the motion system overwrites the edit on the
 * next tick. No-op without a track.
 */
export function syncKeyframe(world: World, editor: DocumentEditor, target: Entity, property: AnimatableProperty, value: number | string): void {
  if (findKeyframeTrack(world, target, property) === null) return;
  writeKeyframe(world, editor, target, property, value);
}

export function removeKeyframeTrack(world: World, editor: DocumentEditor, target: Entity, property: AnimatableProperty): void {
  const track = findKeyframeTrack(world, target, property);
  if (track) editor.remove(track);
}
