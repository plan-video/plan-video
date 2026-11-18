/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, Index, onCleanup, onMount } from 'solid-js';
import { RULER_HEIGHT, SCROLLBAR_LANE } from '@/engine/timeline';
import { useEditor, useTimelineIndex } from '@/engine/hooks';
import { useTimeline } from '@/context/timeline';
import { useLayout } from '@/context/layout';
import { Layer } from './layer';
import { LayerContextProvider } from './context';
import { DropIndicator } from './drop-indicator';

export function Layers() {
  const editor = useEditor();
  const timeline = useTimeline();
  const index = useTimelineIndex();
  const { timelineMinimized } = useLayout();

  const layers = createMemo(() => index().layers);

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    editor.clearSelection();
  };

  createEffect(() => timeline.setMinimized(timelineMinimized()));

  onMount(timeline.mount);
  onCleanup(timeline.unmount);

  return (
    <div class="relative z-10 size-full" data-tour="timeline">
      {/* Sideways overflow stays visible so row labels and the rename field can reach over the tracks. */}
      <div
        class="grid grid-cols-1 h-full absolute inset-0 overflow-x-visible overflow-y-clip"
        on:wheel={timeline.scroll}
        style={{ 'grid-template-rows': `${RULER_HEIGHT}px 1fr` }}
        data-timeline-layers-container
      >
        <div />
        <div data-timeline-layers-viewport class="relative h-full z-0 overflow-x-visible overflow-y-clip">
          <div
            data-timeline-layers
            class="min-h-full group/layers flex flex-col"
            // The scrollbar's lane, so the last row can be scrolled clear of it.
            style={{ 'padding-bottom': `${SCROLLBAR_LANE}px` }}
            onPointerDown={handlePointerDown}
          >
            <LayerContextProvider>
              <Index each={layers()}>
                {(layer) => <Layer layer={layer()} />}
              </Index>
              <DropIndicator />
            </LayerContextProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
