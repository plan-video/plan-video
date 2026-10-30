/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ControlScrollArea } from "@/components/ui/control-scrollarea";
import { Show, createMemo } from "solid-js";
import {
  isAdjustmentLayer,
  isAudio,
  isCaption,
  isGroup,
  isMask,
  isScene,
  isSequence,
  isShape,
  isText,
} from "@plan.video/runtime";
import { useAssetSelection, useSelection } from "@/engine/hooks";
import { captionWordSelection } from "@/engine/timeline/caption-word-selection";
import { InspectorHeader } from "./inspector-header";
import { BackgroundSettings } from "./background";
import { VariablesSettings } from "./variables";
import { AssetInfoPanel } from "./asset-info";
import { TimeSettings } from "./time";
import { AppearanceSettings } from "./appearance";
import { Alignment } from "./alignment";
import { LayoutPanel } from "./layout";
import { TransformSettings } from "./transform";
import { CaptionSettings } from "./caption-settings";
import { CaptionCuts } from "./caption-cuts";
import { CaptionWords } from "./caption-words";
import { CaptionTools } from "./caption-tools";
import { CaptionWordStyle } from "./caption-word-style";
import { TextPanel } from "./text";
import { FillsSettings } from "./fills";
import { SourceSettings } from "./source";
import { StrokesSettings } from "./strokes";
import { ShadowsSettings } from "./shadows";
import { EffectsSettings } from "./effects";
import { GradeSettings } from "./grade";
import { AnimationsSettings } from "./animations";
import { TransitionSettings } from "./transition";
import { EffectSettings } from "./effect-settings";
import { MasksSettings } from "./masks";
import { AudioSettings } from "./audio";
import { InterpolationSettings } from "./interpolation";
import { LayoutPreviewPanel } from "./layout-preview";
import { layoutTarget } from "@/engine/stream-layout";
import { getClipFallbackName } from "@/engine/timeline/style";
import { t } from "@/lib/i18n";
import { useWorld } from "@plan.video/koota-solid";

import type { Entity } from "koota";

export type SelectionTarget =
  | "keyframe"
  | "asset"
  | "scene"
  | "mask"
  | "sequence"
  | "caption"
  | "words"
  | "audio"
  | "adjustment"
  | "text"
  | "shape"
  | "group"
  | "stage";

function classifyNode(entity: Entity): SelectionTarget {
  if (isScene(entity)) return "scene";
  if (isMask(entity)) return "mask";
  if (isSequence(entity)) return "sequence";
  if (isCaption(entity)) return "caption";
  if (isAudio(entity)) return "audio";
  if (isAdjustmentLayer(entity)) return "adjustment";
  if (isText(entity)) return "text";
  if (isShape(entity)) return "shape";
  if (isGroup(entity)) return "group";
  return "stage";
}

export function Inspector() {
  const world = useWorld();
  const { nodes, keyframes, first } = useSelection();
  const { asset, partial } = useAssetSelection();
  const wordPick = captionWordSelection;

  // A picked caption word is not the captions layer: the panels style the
  // picked words alone (see CaptionWordStyle).
  const selection = createMemo(() => {
    const current = nodes();
    if (current.length > 0) return current;
    const picked = wordPick();
    return picked?.entity.isAlive() ? [picked.entity] : current;
  });
  const primary = createMemo(() => selection()[0] ?? first());

  // Words picked on the timeline, when nothing else is selected.
  const pickedWords = createMemo(() => {
    const picked = wordPick();
    if (!picked || nodes().length > 0 || keyframes().length > 0 || asset() || partial()) return null;
    return picked.entity.isAlive() && isCaption(picked.entity) ? picked : null;
  });

  const selectionTarget = createMemo<SelectionTarget>(() => {
    if (keyframes().length > 0) return "keyframe";
    if (asset() || partial()) return "asset";
    if (pickedWords()) return "words";
    const entity = primary();
    if (selection().length === 1 && entity) return classifyNode(entity);
    return "stage";
  });

  // Remounts the panels when the selection changes
  const selectionHash = createMemo(() => {
    return [...selection(), ...keyframes(), asset()?.id ?? partial()?.id ?? ""].join(",") + selectionTarget();
  });

  // What the panels are about, in a word: the same word the timeline gives a
  // clip with no name.
  const title = createMemo(() => {
    if (layoutTarget()) return t("Stream layout");
    const target = selectionTarget();
    if (target === "keyframe") return keyframes().length > 1 ? t("Keyframes") : t("Keyframe");
    if (target === "asset") return t("Asset");
    if (target === "words") return t("Caption words");
    if (selection().length > 1) return t("{count, plural, one {# layer} other {# layers}}", { count: selection().length });
    const entity = primary();
    if (target === "stage" || !entity) return t("Canvas");
    return getClipFallbackName(world, entity);
  });

  const includesTarget = (...targets: SelectionTarget[]) => {
    return targets.includes(selectionTarget());
  };

  return (
    <div class="h-full min-h-0 flex flex-col" data-right-sidebar data-tour="inspector">
      <InspectorHeader title={title()} />
      <Show when={layoutTarget()}>
        <ControlScrollArea class="flex-1 min-h-0" scrollKey="stream-layout">
          <LayoutPreviewPanel />
        </ControlScrollArea>
      </Show>
      <Show when={!layoutTarget() && selectionHash()} keyed>
        <ControlScrollArea class="flex-1 min-h-0" scrollKey={selectionHash()}>
          <Show when={selection().length > 1}>
            <Alignment />
          </Show>

          <Show when={pickedWords()} keyed>
            {(picked) => <CaptionWordStyle entity={picked.entity} indices={picked.indices} />}
          </Show>

          <Show when={includesTarget("stage")}>
            <BackgroundSettings />
          </Show>

          <Show when={includesTarget("stage")}>
            <VariablesSettings />
          </Show>

          <Show when={includesTarget("shape", "group", "adjustment")}>
            <EffectSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "audio", "scene", "caption", "group", "mask", "adjustment")}>
            <TimeSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "audio", "scene", "caption", "group", "mask", "adjustment")}>
            <TransformSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "audio", "scene", "mask")}>
            <LayoutPanel selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "scene", "caption", "group", "audio", "mask")}>
            <AppearanceSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("caption")}>
            <CaptionSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("caption")}>
            <CaptionCuts selection={selection()} />
          </Show>

          <Show when={includesTarget("caption")}>
            <CaptionTools selection={selection()} />
          </Show>

          <Show when={includesTarget("caption")}>
            <CaptionWords selection={selection()} />
          </Show>

          <Show when={includesTarget("text", "caption")}>
            <TextPanel selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "scene")}>
            <FillsSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "caption")}>
            <SourceSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "scene", "caption")}>
            <StrokesSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "scene")}>
            <ShadowsSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "scene", "group")}>
            <GradeSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "scene", "caption")}>
            <EffectsSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "caption", "group", "mask")}>
            <AnimationsSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "caption", "group", "sequence")}>
            <TransitionSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "text", "caption", "group")}>
            <MasksSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("shape", "audio", "group")}>
            <AudioSettings selection={selection()} />
          </Show>

          <Show when={includesTarget("asset")}>
            <AssetInfoPanel />
          </Show>

          <Show when={includesTarget("keyframe")}>
            <InterpolationSettings selection={keyframes()} />
          </Show>
        </ControlScrollArea>
      </Show>
    </div>
  );
}
