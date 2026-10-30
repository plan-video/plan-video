/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getEntityChildren } from "@plan.video/runtime";
import { SOURCE_ATTR } from "@plan.video/jsx";
import { authoredElement, authoredTree, renderAuthored } from "@plan.video/reconciler";

import type { PropValue } from "@plan.video/jsx";
import type { DocumentEditor } from "@/engine/editor";
import type { CaptionLook } from "@/lib/caption-brand";
import type { Entity, World } from "koota";

/** Props about which caption this is, its time or its words, not how it looks. */
const NOT_LOOK = new Set([
  "name",
  "selected",
  "active",
  "clipHeight",
  "expanded",
  "start",
  "end",
  "sourceIn",
  "sourceOut",
  "playbackRate",
  "src",
  "seed",
  "id",
  "key",
  "ref",
  SOURCE_ATTR,
]);

/** They play at a time of their own, which another caption does not share. */
const TIMED = new Set(["keyframeTrack"]);

const isLookProp = (name: string) => !NOT_LOOK.has(name);

export function readCaptionLook(world: World, caption: Entity): CaptionLook | null {
  const tree = authoredTree(world, caption);
  if (!tree) return null;
  const props: Record<string, PropValue> = {};
  for (const [name, value] of Object.entries(tree.props)) {
    if (isLookProp(name) && value !== undefined) props[name] = value as PropValue;
  }
  return JSON.parse(JSON.stringify({ props, children: tree.children.filter((child) => !TIMED.has(child.tag)) })) as CaptionLook;
}

/** Look props it lacks are removed, its paints and animations replaced. One undo step: the edits land in one task. */
export function applyCaptionLook(world: World, editor: DocumentEditor, caption: Entity, look: CaptionLook): void {
  const current = authoredTree(world, caption);
  if (!current) return;

  for (const name of Object.keys(current.props)) {
    if (isLookProp(name) && !(name in look.props)) editor.editProperty(caption, name, false);
  }
  for (const [name, value] of Object.entries(look.props)) {
    if (JSON.stringify(current.props[name]) !== JSON.stringify(value)) editor.editProperty(caption, name, value);
  }

  const old = getEntityChildren(world, caption).filter((child) => {
    const element = authoredElement(child);
    return !!element && !TIMED.has(element.tag);
  });
  if (old.length > 0) editor.remove(old);
  for (const child of look.children) editor.insertElement(caption, () => renderAuthored(child));
}
