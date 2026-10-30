/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { onCleanup, onMount } from 'solid-js';
import { toast } from 'somoto';
import { useWorld } from '@plan.video/koota-solid';
import { FrameRate, Selected, framesToSeconds, getActiveEntity } from '@plan.video/runtime';
import { droppedFiles, importFiles } from '@/engine/asset-actions';
import { insertAsset } from '@/engine/insert-asset';
import { insertAssetsInNewScene } from '@/engine/new-scene';
import { clipMediaKind, replaceClipMediaAndReport, selectedMediaClips } from '@/engine/replace-media';
import { useLibrary } from '@/engine/library';
import { useTimeline } from '@/context/timeline';
import { TimelineSurface } from '@/engine/timeline/surface';
import { findClipAt } from '@/engine/timeline/render/clip';
import { findTransitionDrop } from '@/engine/timeline/render/transitions';
import { TRANSITION_DRAG_TYPE, applyTransition, setPickedTransition, spotAt } from '@/engine/transitions';
import { ASSET_DRAG_TYPE } from '@/components/sidebar-left/folder-item';
import { t } from '@/lib/i18n';
import { TimelineClipMenu } from './clip-menu';

import type { TransitionType as TransitionName } from '@plan.video/jsx';

export function Timeline() {
  const world = useWorld();
  const timeline = useTimeline();
  const library = useLibrary();

  onMount(() => timeline.attachCanvas());
  onCleanup(() => timeline.detachCanvas());

  const carriesTransition = (event: DragEvent) => event.dataTransfer?.types.includes(TRANSITION_DRAG_TYPE) ?? false;

  const aimTransition = (event: DragEvent) => {
    const surface = world.get(TimelineSurface);
    const rect = surface?.canvas?.getBoundingClientRect();
    if (!surface || !rect) return null;
    surface.transitionDrop = findTransitionDrop(surface, event.clientX - rect.left, event.clientY - rect.top);
    return surface.transitionDrop;
  };

  const clearTransitionAim = () => {
    const surface = world.get(TimelineSurface);
    if (surface) surface.transitionDrop = null;
  };

  const dropTransition = (event: DragEvent) => {
    const name = event.dataTransfer?.getData(TRANSITION_DRAG_TYPE) as TransitionName | undefined;
    const drop = aimTransition(event);
    clearTransitionAim();
    if (!name || !drop) return;
    setPickedTransition(name);
    applyTransition(world, [spotAt(world, drop.clip, drop.edge)], name);
  };

  const carriesFiles = (event: DragEvent) => {
    const types = event.dataTransfer?.types ?? [];
    return types.includes(ASSET_DRAG_TYPE) || types.includes('Files');
  };

  const aimReplace = (event: DragEvent) => {
    const surface = world.get(TimelineSurface);
    const rect = surface?.canvas?.getBoundingClientRect();
    if (!surface || !rect) return null;
    const clip = event.altKey && carriesFiles(event)
      ? findClipAt(surface, event.clientX - rect.left, event.clientY - rect.top)
      : null;
    const targets = clip && clipMediaKind(world, clip) !== null
      ? clip.has(Selected) ? selectedMediaClips(world) : [clip]
      : null;
    surface.replaceDrop = targets;
    return targets;
  };

  const clearReplaceAim = () => {
    const surface = world.get(TimelineSurface);
    if (surface) surface.replaceDrop = null;
  };

  // Dropped assets start where they were dropped, not at the playhead as on the canvas: aiming at the timeline says when.
  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (carriesTransition(event)) {
      dropTransition(event);
      return;
    }

    const replacing = aimReplace(event);
    clearReplaceAim();

    const lib = library();
    if (!lib) return;

    const fps = world.get(FrameRate)?.value ?? 30;
    const start = framesToSeconds(Math.max(0, timeline.clientToFrame(event.clientX)), fps);

    // Read the transfer before the first await: it is gone by the time an import resolves.
    const ids = event.dataTransfer?.getData(ASSET_DRAG_TYPE)?.split(',').filter(Boolean) ?? [];
    const files = droppedFiles(event);

    const assets = ids.map((id) => lib.get(id)).filter((asset) => asset != null);
    if (files.length) assets.push(...await importFiles(lib, files, ''));
    if (!assets.length) return;

    if (replacing) {
      replaceClipMediaAndReport(world, replacing, assets[0]);
      return;
    }

    if (!getActiveEntity(world)) {
      if (!insertAssetsInNewScene(world, assets, { start })) {
        toast(t("Nothing to insert into"), { description: t("Open a project first.") });
      }
      return;
    }

    for (const asset of assets) {
      if (!insertAsset(world, asset, { start })) {
        toast(t("Nothing to insert into"), { description: t("Open a scene first.") });
      }
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (carriesTransition(event)) {
      event.dataTransfer!.dropEffect = aimTransition(event) ? 'copy' : 'none';
      return;
    }
    aimReplace(event);
    event.dataTransfer!.dropEffect = 'copy';
  };

  const handleDragLeave = () => {
    clearTransitionAim();
    clearReplaceAim();
  };

  return (
    <TimelineClipMenu>
      <canvas
        class="absolute inset-0"
        id="timeline-canvas"
        on:drop={handleDrop}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
      />
    </TimelineClipMenu>
  );
}
