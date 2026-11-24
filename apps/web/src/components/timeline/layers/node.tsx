/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, Show } from 'solid-js';
import { useTag, useTrait, useWorld } from '@plan.video/koota-solid';
import {
  ClipHeight,
  Expanded,
  Hidden,
  Hovering,
  Muted,
  Name,
  Selected,
  Soloed,
  getEntityChildren,
  getParentEntity,
} from '@plan.video/runtime';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipPortal, TooltipTrigger } from '@/components/ui/tooltip';
import EyeIcon from 'lucide-solid/icons/eye';
import EyeOffIcon from 'lucide-solid/icons/eye-off';
import HeadphonesIcon from 'lucide-solid/icons/headphones';
import Volume2Icon from 'lucide-solid/icons/volume-2';
import VolumeXIcon from 'lucide-solid/icons/volume-x';
import { useDerived, useEditor } from '@/engine/hooks';
import { DEFAULT_CLIP_HEIGHT, MAX_CLIP_HEIGHT, MIN_CLIP_HEIGHT, clipMakesSound, getClipFallbackName } from '@/engine/timeline';
import { t } from '@/lib/i18n';
import { useLayerContext } from './context';
import { setRowHover } from './hover';
import { Lane } from './lane';
import { RowLabel } from './row-label';

import type { LayerRowProps } from './layer';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const ROW_ICON = 'size-3.5';

export function NodeLayer(props: LayerRowProps) {
  const world = useWorld();
  const editor = useEditor();

  const entity = () => props.layer.entity;

  const clipHeight = useTrait(entity, ClipHeight);
  const height = () => clipHeight()?.value ?? DEFAULT_CLIP_HEIGHT;

  const muted = useTag(entity, Muted);
  const soloed = useTag(entity, Soloed);
  const hidden = useTag(entity, Hidden);
  const hovering = useTag(entity, Hovering);
  const selected = useTag(entity, Selected);
  const sounds = useDerived(() => clipMakesSound(world, entity()));

  const { resized: resizedSignal, drag } = useLayerContext();
  const [resized, setResized] = resizedSignal;

  const [editing, setEditing] = createSignal(false);
  let originalName = '';

  const nameTrait = useTrait(entity, Name);
  const name = createMemo(() => nameTrait()?.value || getClipFallbackName(world, entity()));

  const toggleMuted = (e?: Event) => {
    e?.stopPropagation();
    editor.editProperty(entity(), 'muted', !muted());
  };

  const toggleHidden = (e?: Event) => {
    e?.stopPropagation();
    editor.editProperty(entity(), 'hidden', !hidden());
  };

  const toggleExpanded = (e?: Event) => {
    e?.stopPropagation();
    editor.editProperty(entity(), 'expanded', !entity().has(Expanded));
  };

  // Solo is monitoring, not composition, so it is written to the trait alone and only one node holds it.
  const toggleSoloed = (e?: Event) => {
    e?.stopPropagation();

    const wasSoloed = soloed();
    for (const other of world.query(Soloed)) other.remove(Soloed);
    if (!wasSoloed) entity().add(Soloed);
  };

  const handleRowPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || resized() !== null) return;
    if ((e.target as HTMLElement | null)?.closest('button')) return;

    const extending = e.shiftKey || (MAC ? e.metaKey : e.ctrlKey);
    if (extending && selected()) editor.deselect(entity());
    else editor.select(entity(), { extend: extending });
    if (!extending) drag.begin(e, entity());
  };

  let resizeStartY = 0;
  let resizeStartHeight = 0;

  const handleResizeMove = (e: PointerEvent) => {
    if ((e.buttons & 1) === 0) return handleResizeEnd();
    const next = Math.max(MIN_CLIP_HEIGHT, Math.min(MAX_CLIP_HEIGHT, resizeStartHeight + e.clientY - resizeStartY));
    editor.editProperty(entity(), 'clipHeight', next);
  };

  const handleResizeEnd = () => {
    setResized(null);
    document.removeEventListener('pointermove', handleResizeMove);
    document.removeEventListener('pointerup', handleResizeEnd);
  };

  const handleResizeStart = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeStartY = e.clientY;
    resizeStartHeight = height();
    setResized(entity());

    document.addEventListener('pointermove', handleResizeMove);
    document.addEventListener('pointerup', handleResizeEnd);
  };

  const handleRowDoubleClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('button')) startEditing();
  };

  const handleRemove = () => editor.remove(selected() ? [...world.query(Selected)] : entity());

  // The last child is drawn on top, so "front" is the end of the file and "back" the beginning.
  const handleReorder = (target: 'front' | 'back') => {
    const parent = getParentEntity(entity());
    if (!parent) return;

    const siblings = getEntityChildren(world, parent).filter((sibling) => sibling !== entity());
    editor.reparent(entity(), parent, target === 'back' ? siblings[0] : undefined);
  };

  const startEditing = () => {
    originalName = name();
    setEditing(true);
  };

  const finishEditing = (input: HTMLInputElement) => {
    if (!editing()) return;
    // An empty name is not a name; the row falls back to what it had.
    if (!input.value.trim()) editor.editProperty(entity(), 'name', originalName);
    setEditing(false);
  };

  const handleNameInput = (e: InputEvent) => {
    editor.editProperty(entity(), 'name', (e.currentTarget as HTMLInputElement).value);
  };

  const handleNameKeyDown = (e: KeyboardEvent) => {
    // The canvas is listening for keys; a name being typed is not a shortcut.
    e.stopPropagation();
    const input = e.currentTarget as HTMLInputElement;

    if (e.key === 'Escape') {
      editor.editProperty(entity(), 'name', originalName);
      input.blur();
    } else if (e.key === 'Enter') {
      input.blur();
    }
  };

  const mountNameInput = (input: HTMLInputElement) => {
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        as="div"
        data-layer-row
        class="w-full text-muted-foreground group relative select-none"
        onPointerEnter={() => setRowHover(world, entity())}
        onPointerLeave={() => setRowHover(world, null)}
        onPointerDown={handleRowPointerDown}
        onDblClick={handleRowDoubleClick}
        classList={{ 'opacity-60': drag.dragging() === entity() }}
        style={{ height: height() + 'px' }}
      >
        <Lane
          selected={selected()}
          hovered={hovering() && resized() === null && drag.dragging() === null}
          nested={props.ancestorSelected}
        />
        <div class="relative flex h-full w-full items-center justify-between pl-2.5 pr-0.5">
          <Show when={props.layer.expandable}>
            <button
              onClick={toggleExpanded}
              class="size-4 shrink-0 flex items-center justify-center overflow-clip invisible group-hover/layers:visible focus-ring rounded-sm"
            >
              <Icon name={props.expanded ? "chevron-down" : "chevron-right"} class="size-6 hover:text-foreground" />
            </button>
          </Show>

          <div class="ml-auto flex shrink-0 items-center" classList={{ 'invisible': resized() !== null }}>
            {/* A row with nothing to hear has nothing to mute. */}
            <Show when={sounds() || muted() || soloed()}>
              <Show
                when={soloed()}
                fallback={
                  <Tooltip placement="bottom">
                    <TooltipTrigger
                      as={Button}
                      variant="ghost"
                      size="icon"
                      aria-label={muted() ? t("Unmute") : t("Mute")}
                      aria-pressed={muted()}
                      class={muted() ? "text-foreground" : "hover:text-foreground"}
                      onClick={toggleMuted}
                    >
                      <Show when={muted()} fallback={<Volume2Icon class={ROW_ICON} stroke-width={2} />}>
                        <VolumeXIcon class={ROW_ICON} stroke-width={2} />
                      </Show>
                    </TooltipTrigger>
                    <TooltipPortal>
                      <TooltipContent>{muted() ? t("Unmute") : t("Mute")}</TooltipContent>
                    </TooltipPortal>
                  </Tooltip>
                }
              >
                <Tooltip placement="bottom">
                  <TooltipTrigger as={Button} variant="on" size="icon" aria-label={t("Unsolo")} aria-pressed="true" onClick={toggleSoloed}>
                    <HeadphonesIcon class={ROW_ICON} stroke-width={2} />
                  </TooltipTrigger>
                  <TooltipPortal>
                    <TooltipContent>{t("Unsolo")}</TooltipContent>
                  </TooltipPortal>
                </Tooltip>
              </Show>
            </Show>
            <Tooltip placement="bottom">
              <TooltipTrigger
                as={Button}
                variant="ghost"
                size="icon"
                aria-label={hidden() ? t("Show") : t("Hide")}
                aria-pressed={hidden()}
                class={hidden() ? "text-foreground" : "hover:text-foreground"}
                onClick={toggleHidden}
              >
                <Show when={hidden()} fallback={<EyeIcon class={ROW_ICON} stroke-width={2} />}>
                  <EyeOffIcon class={ROW_ICON} stroke-width={2} />
                </Show>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent>{hidden() ? t("Show") : t("Hide")}</TooltipContent>
              </TooltipPortal>
            </Tooltip>
          </div>
        </div>

        <Show when={editing()} fallback={<Show when={props.depth > 0}><RowLabel>{name()}</RowLabel></Show>}>
          <input
            ref={mountNameInput}
            type="text"
            class="absolute left-full top-1/2 z-30 ml-1.5 h-6 w-40 -translate-y-1/2 rounded-sm border border-primary bg-background px-1.5 text-xs text-foreground outline-none"
            value={name()}
            onInput={handleNameInput}
            onKeyDown={handleNameKeyDown}
            onBlur={(e) => finishEditing(e.currentTarget)}
            onPointerDown={(e) => e.stopPropagation()}
            onDblClick={(e) => e.stopPropagation()}
          />
        </Show>

        <div
          class="absolute bottom-0 left-0 right-0 h-[3px] cursor-ns-resize translate-y-0.5 z-20 group/resize"
          onPointerDown={handleResizeStart}
        >
          <div
            class="absolute left-0 right-0 top-px h-px transition-colors group-hover/resize:bg-primary"
            classList={{ 'bg-primary': resized() === entity() }}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent
          class="w-[160px]"
          // The menu hands focus back as it closes, which would blur the field Rename just opened.
          onCloseAutoFocus={(event: Event) => {
            if (editing()) event.preventDefault();
          }}
        >
          <ContextMenuItem onSelect={startEditing}>{t("Rename")}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={toggleMuted}>{muted() ? t('Unmute') : t('Mute')}</ContextMenuItem>
          <ContextMenuItem onSelect={toggleSoloed}>{soloed() ? t('Unsolo') : t('Solo')}</ContextMenuItem>
          <ContextMenuItem onSelect={toggleHidden}>{hidden() ? t('Unhide') : t('Hide')}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => handleReorder('front')}>
            {t("Bring to front")}
            <ContextMenuShortcut>]</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => handleReorder('back')}>
            {t("Send to back")}
            <ContextMenuShortcut>[</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleRemove}>{t("Remove")}</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  )
}
