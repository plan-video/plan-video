/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Toggles only rewrite the element's `src`: the asset system notices the new declaration, runs it and binds the result.

import { createSignal, onCleanup } from "solid-js";
import { getAssetSpec, isAssetRef, isTransformSpec, mapAssetInputs, transform } from "@plan.video/jsx";
import { authoredElement } from "@plan.video/reconciler";
import { useEditor } from "@/engine/hooks";
import { useMediaSelection } from "./selection";

import type { AssetInput, TransformType } from "@plan.video/jsx";
import type { Entity } from "koota";

function hasTransform(input: AssetInput, type: TransformType): boolean {
  if (!isAssetRef(input)) return false;
  const spec = getAssetSpec(input);
  if (!isTransformSpec(spec)) return false;
  return spec.type === type || hasTransform(spec.input, type);
}

function withoutTransform(input: AssetInput, type: TransformType): AssetInput {
  if (!isAssetRef(input)) return input;
  const spec = getAssetSpec(input);
  if (!isTransformSpec(spec)) return input;
  if (spec.type === type) return withoutTransform(spec.input, type);
  return mapAssetInputs(input, (inner) => withoutTransform(inner, type));
}

export function sourceOf(entity: Entity): AssetInput | undefined {
  const src = authoredElement(entity)?.props.src;
  return typeof src === "string" && src !== "" ? src : isAssetRef(src) ? src : undefined;
}

export function useTransforms() {
  const editor = useEditor();
  const { imageNodes, videoNodes } = useMediaSelection();
  /** Bumped on every edit: `src` lives on the authored element, which nothing reactive tracks. */
  const [edits, setEdits] = createSignal(0);
  onCleanup(editor.onEdit(() => setEdits((count) => count + 1)));

  const targets = (type: TransformType): Entity[] => {
    if (type === "removeBackground") return imageNodes();
    if (type === "addAudio") return videoNodes();
    return [...imageNodes(), ...videoNodes()];
  };

  const isOn = (type: TransformType): boolean => {
    edits();
    const selected = targets(type);
    return selected.length > 0 && selected.every((entity) => {
      const src = sourceOf(entity);
      return src !== undefined && hasTransform(src, type);
    });
  };

  const toggle = (type: TransformType): void => {
    const next = !isOn(type);

    for (const entity of targets(type)) {
      const src = sourceOf(entity);
      if (src === undefined) continue;
      const declared = next
        ? (hasTransform(src, type) ? src : transform[type](src))
        : withoutTransform(src, type);
      if (declared !== src) editor.editProperty(entity, "src", declared);
    }
  };

  const turnOn = (type: TransformType, entity: Entity): void => {
    const src = sourceOf(entity);
    if (src !== undefined && !hasTransform(src, type)) editor.editProperty(entity, "src", transform[type](src));
  };

  return { isOn, toggle, turnOn };
}
