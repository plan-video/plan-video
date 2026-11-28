/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createRoot } from "solid-js";
import { SOURCE_ATTR } from "@plan.video/jsx";
import { Rect, Scene, SolidPaint, VideoPaint, getRuntimeDocument, insert, isSceneNode, withDocument } from "@plan.video/reconciler";
import { Computed, Library, getActiveEntity, getParentEntity, setActive, store } from "@plan.video/runtime";

import { getDocumentEditor } from "@/engine/editor";
import { DEFAULT_SCENE_FORMAT, sceneFrame } from "@/engine/new-scene";
import { Unsaved } from "@/engine/traits";
import { t } from "@/lib/i18n";

import type { Entity, World } from "koota";
import type { ProjectDocument } from "@plan.video/reconciler";
import type { SceneNode } from "@plan.video/runtime";
import type { Size } from "@/engine/new-scene";

// Shipped with the app and silent: no sound means no waveform is written into the project's cache.
const CLIPS = {
  wide: { path: "/site/sunset.mp4", name: "sunset", width: 960, height: 540 },
  tall: { path: "/site/creator.mp4", name: "creator", width: 540, height: 960 },
};

export type TourSample = { clip: Entity; remove: () => void };

function sceneSize(world: World, scene: Entity | null): Size {
  if (!scene) return DEFAULT_SCENE_FORMAT;
  const computed = store(world, Computed);
  return {
    width: computed.width[scene.id()] ?? DEFAULT_SCENE_FORMAT.width,
    height: computed.height[scene.id()] ?? DEFAULT_SCENE_FORMAT.height,
  };
}

function clipFor(size: Size) {
  const clip = size.width >= size.height ? CLIPS.wide : CLIPS.tall;
  const scale = Math.min(size.width / clip.width, size.height / clip.height);
  const width = Math.round(clip.width * scale);
  const height = Math.round(clip.height * scale);
  return {
    name: clip.name,
    width,
    height,
    x: Math.round((size.width - width) / 2),
    y: Math.round((size.height - height) / 2),
    // A URL is resolved as a transient asset: kept in memory, never added to the project's library.
    src: new URL(clip.path, location.origin).href,
  };
}

/** Resolves the clip early (in memory, as `placeTourSample` will), so it is ready by the step that shows it. */
export function warmTourSample(world: World, scene: Entity | null): void {
  world.get(Library)?.resolve(clipFor(sceneSize(world, scene)).src).catch(() => undefined);
}

/**
 * Puts a clip on `scene`, or on a new scene where the project has none, without touching the project:
 * built straight on the runtime document so the file and the history never hear of it, marked `Unsaved`
 * so no save writes it, and its own edits set aside.
 */
export function placeTourSample(world: World, scene: Entity | null): TourSample | null {
  const runtime = getRuntimeDocument(world);
  const clip = clipFor(sceneSize(world, scene));
  const created: Entity[] = [];
  let shown: Entity | undefined;
  const document: ProjectDocument<SceneNode> = {
    stage: runtime.stage,
    createElement: (tag) => {
      const node = runtime.createElement(tag);
      if (isSceneNode(node) && node !== runtime.stage) {
        runtime.setProperty(node, SOURCE_ATTR, `tour-sample:${created.length + 1}`);
        node.entity.add(Unsaved);
        created.push(node.entity);
        if (tag === "Rect") shown = node.entity;
      }
      return node;
    },
    setProperty: (node, name, value) => runtime.setProperty(node, name, value),
    createTextNode: (text) => runtime.createTextNode(text),
    replaceText: (node, text) => runtime.replaceText(node, text),
    isTextNode: (node) => runtime.isTextNode(node),
    insertNode: (parent, node, anchor) => runtime.insertNode(parent, node, anchor),
    removeNode: (parent, node) => runtime.removeNode(parent, node),
    getParentNode: (node) => runtime.getParentNode(node),
    getFirstChild: (node) => runtime.getFirstChild(node),
    getNextSibling: (node) => runtime.getNextSibling(node),
  };

  const video = () => (
    <Rect name={clip.name} keepAspectRatio x={clip.x} y={clip.y} width={clip.width} height={clip.height}>
      <VideoPaint src={clip.src} />
    </Rect>
  );
  // Where the empty project's placeholder frame stands, so the canvas doesn't move.
  const frame = sceneFrame(DEFAULT_SCENE_FORMAT);

  const dispose = createRoot((dispose) => {
    withDocument(document, () =>
      insert(
        scene ? runtime.node(scene) : runtime.stage,
        scene ? video : () => (
          <Scene name={t("New Scene")} x={frame.x} y={frame.y} width={frame.width} height={frame.height}>
            <SolidPaint color="#000000" />
            {video()}
          </Scene>
        ),
        null,
      ),
    );
    return dispose;
  });
  dispose();

  const top = created[0];
  if (!top || !shown) return null;
  if (!scene) setActive(world, top);
  const release = getDocumentEditor(world).aside(top, () => undefined);

  return {
    clip: shown,
    remove: () => {
      release();
      if (!top.isAlive()) return;
      if (getActiveEntity(world) === top) setActive(world, null);
      const parent = getParentEntity(top) ?? runtime.stage.entity;
      runtime.removeNode(runtime.node(parent), runtime.node(top));
    },
  };
}
