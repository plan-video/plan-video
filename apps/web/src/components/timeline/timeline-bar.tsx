/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, Index, Show } from 'solid-js';
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
import ChevronDownIcon from 'lucide-solid/icons/chevron-down';
import { ToolOptionsIcon } from '@/components/editor/rail-icons';
import ZoomInIcon from 'lucide-solid/icons/zoom-in';
import ZoomOutIcon from 'lucide-solid/icons/zoom-out';
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
import { Icon } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { SliderRow } from '@/components/ui/slider-row';
import { CanvasTools, HistoryButtons } from '@/components/canvas/toolbar';
import { ZoomMenu } from '@/components/sidebar-right/inspector/inspector-header';
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@/components/ui/tooltip';
import { DEFAULT_CLIP_HEIGHT, setSimpleClips, simpleClips, TIMELINE_BAR_HEIGHT } from '@/engine/timeline';
import { useDerived, useEditor, useTimelineIndex } from '@/engine/hooks';
import { useTimeline } from '@/context/timeline';
import { useLayout } from '@/context/layout';
import { store } from '@/init';
import { createStoredSignal } from '@/lib/store';
import { msg, t } from '@/lib/i18n';
import { formatFrames, TIME_FORMAT_OPTIONS, type TimeFormat } from './time-format';

import type { TimelineNode } from '@plan.video/runtime';
import type { Entity } from 'koota';

const HEIGHT_PRESETS = [
  { label: msg('Tight'), height: 28 },
  { label: msg('Snug'), height: 32 },
  { label: msg('Normal'), height: 40 },
  { label: msg('Relaxed'), height: 64 },
  { label: msg('Loose'), height: 116 },
];

const ZOOM_BUTTON_STEP = 0.08;

export function TimelineBar(props: { toolsShift: number }) {
  const world = useWorld();
  const editor = useEditor();
  const timeline = useTimeline();
  const index = useTimelineIndex();
  const { timelineMinimized, toggleTimeline, hiddenSections, hideSection, showSection } = useLayout();

  const layers = createMemo(() => index().layers);
  const scene = createMemo(() => index().root);

  const frameRate = useTrait(world, FrameRate);
  const playback = useTrait(scene, Playback);
  const now = useDerived(() => scene()?.get(Computed)?.localTime ?? 0);
  const duration = useDerived(() => scene()?.get(Computed)?.duration ?? 0);
  const zoom = useDerived(() => timeline.getZoom());

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

  const mixerHidden = () => hiddenSections().includes('mixer');

  const handleDoubleClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, [role="slider"], input')) return;
    toggleTimeline();
  };

  return (
    <div class="@container shrink-0" style={{ height: `${TIMELINE_BAR_HEIGHT}px` }} data-tour="timeline">
      {/* The outer columns take free room before the 1fr ones, so the tools shift only as far as the bar has space. */}
      <div
        class="grid h-full grid-cols-[minmax(0,var(--tools-left))_minmax(min-content,1fr)_max-content_minmax(min-content,1fr)_minmax(0,var(--tools-right))] @max-3xl:grid-cols-[0px_minmax(0,1fr)_minmax(0,auto)_auto_0px] items-center px-2 text-muted-foreground select-none"
        style={{
          '--tools-left': `${Math.max(0, props.toolsShift * 2)}px`,
          '--tools-right': `${Math.max(0, props.toolsShift * -2)}px`,
        }}
        on:dblclick={handleDoubleClick}
      >
        <div class="col-span-2 flex min-w-0 items-center gap-1">
          <Tooltip placement="top">
            <TooltipTrigger
              as={Button}
              variant="secondary"
              size="icon-square"
              aria-label={playback()?.playing ? t('Pause') : t('Play')}
              class="rounded-full"
              onClick={handlePlay}
            >
              {/* A triangle's weight sits left of its box, so it is nudged to look centred in the circle. */}
              <Show when={playback()?.playing} fallback={<PlayIcon class="size-3.5 translate-x-px" fill="currentColor" stroke-width={1.5} />}>
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
          <span class="ml-1.5 truncate font-mono text-xs tabular-nums">
            <span class="text-foreground">{clock()}</span>
            <span class="mx-1.5 text-muted-foreground/50">/</span>
            <span>{total()}</span>
          </span>
        </div>

        <div class="mx-2 flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          <CanvasTools />
          <Separator orientation="vertical" class="min-h-4 mx-2" />
          <DropdownMenu>
            <Tooltip placement="top">
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button {...buttonProps} variant="ghost" aria-label={t("Timeline options")} class="h-8 gap-0.5 px-1.5 text-foreground hover:text-foreground data-[expanded]:text-foreground">
                        <ToolOptionsIcon />
                        <ChevronDownIcon class="size-3" stroke-width={2.5} />
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
                <DropdownMenuItem
                  role="menuitemcheckbox"
                  aria-checked={simpleClips()}
                  closeOnSelect={false}
                  onSelect={() => setSimpleClips(!simpleClips())}
                >
                  {t("Simple clips")}
                  <Show when={simpleClips()}>
                    <Icon name="confirm-check" class="ml-auto -mr-1 text-foreground" />
                  </Show>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => (mixerHidden() ? showSection('mixer') : hideSection('mixer'))}>
                  {t(mixerHidden() ? 'Show {section}' : 'Hide {section}', { section: t('Audio') })}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={toggleTimeline}>
                  {timelineMinimized() ? t('Show timeline') : t('Collapse timeline')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
          <ZoomMenu placement="top-end" />
          <Separator orientation="vertical" class="min-h-4 mx-2" />
          <HistoryButtons />
        </div>

        <div class="col-span-2 flex items-center justify-end gap-1 @max-xl:hidden">
          <Tooltip placement="top">
            <TooltipTrigger
              as={Button}
              variant="ghost"
              size="icon"
              aria-label={t("Zoom out")}
              class="hover:text-foreground"
              onClick={() => timeline.setZoom(zoom() - ZOOM_BUTTON_STEP)}
            >
              <ZoomOutIcon class="size-4" stroke-width={2} />
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>{t("Zoom out")}</TooltipContent>
            </TooltipPortal>
          </Tooltip>
          <div class="w-28 @max-4xl:hidden">
            <SliderRow label={t("Zoom")} hideLabel value={zoom()} min={0} max={1} step={0.01} onChange={timeline.setZoom} />
          </div>
          <Tooltip placement="top">
            <TooltipTrigger
              as={Button}
              variant="ghost"
              size="icon"
              aria-label={t("Zoom in")}
              class="hover:text-foreground"
              onClick={() => timeline.setZoom(zoom() + ZOOM_BUTTON_STEP)}
            >
              <ZoomInIcon class="size-4" stroke-width={2} />
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>{t("Zoom in")}</TooltipContent>
            </TooltipPortal>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function* geometryEntities(nodes: TimelineNode[]): Generator<Entity> {
  for (const node of nodes) {
    if (node.kind === 'geometry') yield node.entity;
    yield* geometryEntities(node.children);
  }
}
