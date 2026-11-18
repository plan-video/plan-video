/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo } from "solid-js";
import { Captions, authoredElement } from "@plan.video/reconciler";
import { Caption, getEntityTree, getSceneAncestor, isScene } from "@plan.video/runtime";
import { useWorld } from "@plan.video/koota-solid";
import { useAuth } from "@/context/auth";
import { useEditor, useSelection } from "@/engine/hooks";
import { captionBrandStyle, loadCaptionStyles } from "@/lib/caption-brand";
import { applyCaptionLook } from "@/lib/caption-look";
import type { CaptionTemplate } from "@/lib/caption-templates";
import { t } from "@/lib/i18n";
import { toast } from "somoto";
import { useMediaSelection } from "./selection";

import type { Entity } from "koota";

export function useAutoCaptions() {
  const world = useWorld();
  const editor = useEditor();
  const { nodes } = useSelection();
  const { videoNodes } = useMediaSelection();
  const auth = useAuth();

  createEffect(() => loadCaptionStyles(auth.ownerId()));

  const scenes = createMemo(() => {
    const found: Entity[] = [];
    const seen = new Set<Entity>();
    const add = (scene: Entity | null) => {
      if (!scene || seen.has(scene)) return;
      seen.add(scene);
      found.push(scene);
    };

    for (const node of nodes()) {
      if (isScene(node)) add(node);
    }
    for (const video of videoNodes()) add(getSceneAncestor(video));
    return found;
  });
  const canCaption = () => scenes().length > 0;

  /** A template picked in the Captions tab wins over the saved brand style. */
  const insertFresh = (scene: Entity, template?: CaptionTemplate) => {
    const [entity] = editor.insertElement(scene, () =>
      template ? (
        <Captions seed={Date.now()} look={template.look} preset={template.preset} colors={template.colors} />
      ) : (
        <Captions seed={Date.now()} look="commentary" />
      ),
    );
    if (!entity) {
      toast.error(t("Could not add captions"), {
        description: t("The scene has no source to write the element into."),
      });
      return;
    }
    const brand = template ? null : captionBrandStyle();
    if (brand) applyCaptionLook(world, editor, entity, brand);
  };

  /** Adds captions, or takes the words again if the scene has some. True when it added new ones. */
  const captionScene = (scene: Entity, template?: CaptionTemplate) => {
    const existing = getEntityTree(world, scene).find(
      (entity) => entity !== scene && entity.has(Caption),
    );

    if (!existing) {
      insertFresh(scene, template);
      return true;
    }

    const authored = authoredElement(existing);

    // A subtitle-bound caption shows its file; auto-captions transcribe, so the element is replaced by one that does.
    if (authored?.props.src !== undefined) {
      editor.remove(existing);
      insertFresh(scene, template);
      return true;
    }

    // A new take: a fresh seed re-transcribes the scene.
    editor.editProperty(existing, "seed", Date.now());
    editor.select(existing);
    return false;
  };

  const generate = () => {
    for (const scene of scenes()) {
      if (captionScene(scene)) return;
    }
  };

  return { canCaption, generate, captionScene };
}
