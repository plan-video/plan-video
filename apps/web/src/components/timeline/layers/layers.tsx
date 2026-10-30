/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, Index, onCleanup, onMount, Show } from 'solid-js';
import { toast } from 'somoto';
import { useTrait, useWorld } from '@plan.video/koota-solid';
import { Sequence as SequenceElement } from '@plan.video/reconciler';
import {
  ClipHeight,
  Computed,
  FrameRate,
  getNextName,
  Playback,
  Source,
  togglePlayback,
} from '@plan.video/runtime';
import PlayIcon from 'lucide-solid/icons/play';
import PauseIcon from 'lucide-solid/icons/pause';
import RepeatIcon from 'lucide-solid/icons/repeat';
import ScissorsIcon from 'lucide-solid/icons/scissors';
import EllipsisIcon from 'lucide-solid/icons/ellipsis';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@/components/ui/tooltip';
import { DEFAULT_CLIP_HEIGHT, RULER_HEIGHT, SCROLLBAR_LANE } from '@/engine/timeline';
import { useDerived, useEditor, useTimelineIndex } from '@/engine/hooks';
import { useTimeline } from '@/context/timeline';
import { useLayout } from '@/context/layout';
import { splitAtPlayhead } from '@/engine/split';
import { store } from '@/init';
import { createStoredSignal } from '@/lib/store';
import { msg, t } from '@/lib/i18n';
import { formatFrames, TIME_FORMAT_OPTIONS, type TimeFormat } from '../time-format';
import { Layer } from './layer';
import { LayerContextProvider } from './context';
import { DropIndicator } from './drop-indicator';

import type { TimelineNode } from '@plan.video/runtime';
import type { Entity } from 'koota';

/** The row heights the height menu offers, tightest first. */
const HEIGHT_PRESETS = [
  { label: msg('Tight'), height: 28 },
  { label: msg('Snug'), height: 32 },
  { label: msg('Normal'), height: 40 },
  { label: msg('Relaxed'), height: 64 },
  { label: msg('Loose'), height: 116 },
];

export function Layers() {
  const world = useWorld();
  const editor = useEditor();
  const timeline = useTimeline();
  const index = useTimelineIndex();
  const { timelineMinimized, toggleTimeline } = useLayout();

  const layers = createMemo(() => index().layers);
  const scene = createMemo(() => index().root);

  const frameRate = useTrait(world, FrameRate);
  const playback = useTrait(scene, Playback);
  const now = useDerived(() => scene()?.get(Computed)?.localTime ?? 0);
  const duration = useDerived(() => scene()?.get(Computed)?.duration ?? 0);

  const [timeFormat, setTimeFormat] = createStoredSignal(
    store.define<TimeFormat>('timeline.timeFormat', 'standard'),
  );

  const fps = () => frameRate()?.value ?? 30;
  const clock = createMemo(() => formatFrames(now(), fps(), timeFormat()));
  const total = createMemo(() => formatFrames(duration(), fps(), timeFormat()));

  const handlePlay = () => {
    const entity = scene();
    if (entity) togglePlayback(world, entity);
  };

  const toggleLooping = () => {
    const entity = scene();
    if (!entity) return;
    entity.set(Playback, { loop: !playback()?.loop });
  };

  // What the height menu ticks: the height the rows share, or none of them if
  // they differ.
  const commonHeight = useDerived(() => {
    let common: number | null = null;

    for (const entity of geometryEntities(layers())) {
      const height = entity.get(ClipHeight)?.value ?? DEFAULT_CLIP_HEIGHT;
      if (common === null) common = height;
      else if (common !== height) return null;
    }

    return common;
  });

  const setCommonHeight = (height: number) => {
    for (const entity of geometryEntities(layers())) {
      editor.editProperty(entity, 'clipHeight', height);
    }
  };

  /**
   * A new layer is an empty sequence: a row of its own whose clips share
   * one line, laid end to end without overlapping.
   */
  const addLayer = () => {
    const parent = scene();
    if (!parent?.get(Source)?.value) {
      toast(t("Nothing to add a layer to"), { description: t("Open a scene first.") });
      return;
    }
    const [layer] = editor.insertElement(parent, () => (
      <SequenceElement name={getNextName(world, t('Layer'))} />
    ));
    if (layer) editor.select(layer);
  };

  // A press on the empty space below the rows, not on one of them.
  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    editor.clearSelection();
  };

  const handleHeaderDoubleClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    toggleTimeline();
  };

  createEffect(() => timeline.setMinimized(timelineMinimized()));

  onMount(timeline.mount);
  onCleanup(timeline.unmount);

  return (
    <div class="relative size-full" data-tour="timeline">
      <div
        class="grid grid-cols-1 h-full absolute border-b border-border inset-0 overflow-hidden"
        on:wheel={timeline.scroll}
        style={{ 'grid-template-rows': `${RULER_HEIGHT}px 1fr` }}
        data-timeline-layers-container
      >
        <div
          class="w-full z-10 flex flex-row gap-0.5 pl-2 pr-3 items-center text-muted-foreground select-none"
          on:dblclick={handleHeaderDoubleClick}
        >
          <Tooltip placement="top">
            <TooltipTrigger
              as={Button}
              variant="ghost"
              size="icon"
              aria-label={playback()?.playing ? t('Pause') : t('Play')}
              class="text-foreground"
              onClick={handlePlay}
            >
              <Show when={playback()?.playing} fallback={<PlayIcon class="size-3.5" fill="currentColor" stroke-width={1.5} />}>
                <PauseIcon class="size-3.5" fill="currentColor" stroke-width={1.5} />
              </Show>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent shortcut="Space">{playback()?.playing ? t('Pause') : t('Play')}</TooltipContent>
            </TooltipPortal>
          </Tooltip>
          <Tooltip placement="top">
            <TooltipTrigger
              as={Button}
              variant="ghost"
              size="icon"
              aria-label={playback()?.loop ? t('Disable loop') : t('Enable loop')}
              aria-pressed={!!playback()?.loop}
              class={playback()?.loop ? 'text-primary hover:text-primary' : 'hover:text-foreground'}
              onClick={toggleLooping}
            >
              <RepeatIcon class="size-4" stroke-width={2} />
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>{playback()?.loop ? t('Disable loop') : t('Enable loop')}</TooltipContent>
            </TooltipPortal>
          </Tooltip>
          <Show when={!timelineMinimized()}>
            <Tooltip placement="top">
              <TooltipTrigger
                as={Button}
                variant="ghost"
                size="icon"
                aria-label={t("Split at playhead")}
                class="hover:text-foreground"
                onClick={() => splitAtPlayhead(world)}
              >
                <ScissorsIcon class="size-4" stroke-width={2} />
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent shortcut="⌘B">{t("Split at playhead")}</TooltipContent>
              </TooltipPortal>
            </Tooltip>
          </Show>
          <DropdownMenu>
            <Tooltip placement="top">
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button {...buttonProps} variant="ghost" size="icon" aria-label={t("Timeline options")} class="hover:text-foreground">
                        <EllipsisIcon class="size-4" stroke-width={2} />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipPortal>
                <TooltipContent>{t("More options")}</TooltipContent>
              </TooltipPortal>
            </Tooltip>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-[190px]">
                <DropdownMenuItem onSelect={addLayer}>{t("Add layer")}</DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{t("Layer height")}</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent class="w-[140px]">
                      <Index each={HEIGHT_PRESETS}>
                        {(preset) => (
                          <DropdownMenuCheckboxItem
                            onSelect={() => setCommonHeight(preset().height)}
                            checked={commonHeight() === preset().height}
                          >
                            {t(preset().label)}
                            <span class="text-xxs text-muted-foreground ml-auto">{preset().height}</span>
                          </DropdownMenuCheckboxItem>
                        )}
                      </Index>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{t("Time format")}</DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent class="w-[200px]">
                      <DropdownMenuRadioGroup
                        value={timeFormat()}
                        onChange={(value) => setTimeFormat(value as TimeFormat)}
                      >
                        <Index each={TIME_FORMAT_OPTIONS}>
                          {(option) => (
                            <DropdownMenuRadioItem value={option().value}>
                              {t(option().label)}
                              <span class="text-xxs text-muted-foreground ml-auto">{t(option().example)}</span>
                            </DropdownMenuRadioItem>
                          )}
                        </Index>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={toggleTimeline}>
                  {timelineMinimized() ? t('Show timeline') : t('Collapse timeline')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <span class="ml-auto pl-2 whitespace-nowrap font-mono text-xxs tabular-nums">
            <span class="text-foreground">{clock()}</span>
            <span class="mx-1 text-muted-foreground/60">/</span>
            <span>{total()}</span>
          </span>
        </div>
        <div data-timeline-layers-viewport class="relative h-full z-0 overflow-hidden">
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

/** Every clip row of the tree, expanded ones included. */
function* geometryEntities(nodes: TimelineNode[]): Generator<Entity> {
  for (const node of nodes) {
    if (node.kind === 'geometry') yield node.entity;
    yield* geometryEntities(node.children);
  }
}
