/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createRenderEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { useQuery, useTrait, useWorld } from "@plan.video/koota-solid";
import { ChildOf, Library, MIN_CAMERA_ZOOM, RenderSurface, Root, setCamera, Source } from "@plan.video/runtime";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuItemDetail,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PRESET_CATEGORIES,
} from "@/lib/layout-presets";
import { setEmptyFrame, useCamera, useEditor } from "@/engine";
import { droppedFiles, importFiles } from "@/engine/asset-actions";
import { createScene, insertAssetsInNewScene, sceneFrame } from "@/engine/new-scene";
import { ASSET_DRAG_TYPE } from "@/components/sidebar-left/folder-item";
import { msg, t } from "@/lib/i18n";

import type { Rect } from "@plan.video/runtime";
import type { LayoutPreset } from "@/lib/layout-presets";


const DEFAULT_NAME: string = msg("New Scene");
const DEFAULT_PRESET: LayoutPreset = { label: msg("Long-form 16:9"), width: 1920, height: 1080 };

/** Same breathing room `focusRect` leaves around a framed rect. */
const FRAME_PADDING = 80;

/**
 * Centers `rect` in `view`. Done here, rather than through `focusRect`,
 * because the canvas reports no viewport until the engine has mounted, and
 * the placeholder is on screen before that.
 */
function frameInView(world: ReturnType<typeof useWorld>, rect: Rect, view: { width: number; height: number }): boolean {
  const width = view.width - FRAME_PADDING * 2;
  const height = view.height - FRAME_PADDING * 2;
  if (width <= 0 || height <= 0 || rect.width <= 0 || rect.height <= 0) return false;

  const scale = Math.min(1, Math.max(MIN_CAMERA_ZOOM, Math.min(width / rect.width, height / rect.height)));
  setCamera(world, {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: view.width / 2 - (rect.x + rect.width / 2) * scale,
    f: view.height / 2 - (rect.y + rect.height / 2) * scale,
  });
  return true;
}

/**
 * The empty-project prompt: a placeholder frame where the first scene will
 * land. It is that scene's rect drawn through the camera, so the zoom control
 * scales it before anything exists. The first time a format is shown, the
 * camera frames it; a later zoom is left alone.
 */
export function SceneInitOverlay() {
  const world = useWorld();
  const editor = useEditor();
  const root = world.get(Root)!;
  const source = useTrait(root, Source);
  const children = useQuery(ChildOf(root));
  const camera = useCamera();

  const [editing, setEditing] = createSignal(false);
  const [selectedPreset, setSelectedPreset] = createSignal<LayoutPreset>(DEFAULT_PRESET);
  const [sceneName, setSceneName] = createSignal(DEFAULT_NAME);
  const [dropping, setDropping] = createSignal(false);
  const [overlayEl, setOverlayEl] = createSignal<HTMLDivElement>();
  const [overlaySize, setOverlaySize] = createSignal({ width: 0, height: 0 });
  // Hidden until the camera has framed this format, so the default camera
  // offset never flashes the frame off to one side.
  const [placed, setPlaced] = createSignal(false);

  let overlayRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;
  // The format the camera was last framed on. A zoom doesn't change it, so
  // the zoom is kept; picking another format frames that one instead.
  let framedPreset: LayoutPreset | undefined;

  const showOverlay = createMemo(() => source()?.value && children().length === 0);

  const frame = createMemo(() => {
    const { a = 1, b = 0, c = 0, d = 1, e = 0, f = 0 } = camera() ?? {};
    const rect = sceneFrame(selectedPreset());
    const scale = Math.hypot(a, b) || 1;
    return {
      left: e + a * rect.x + c * rect.y,
      top: f + b * rect.x + d * rect.y,
      width: rect.width * scale,
      height: rect.height * scale,
    };
  });

  createEffect(() => {
    const el = overlayEl();
    if (!el) return;
    const measure = () => setOverlaySize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  createRenderEffect(() => {
    const showing = showOverlay();
    const preset = selectedPreset();
    const { width, height } = overlaySize();
    if (!showing) {
      setEmptyFrame(null);
      framedPreset = undefined;
      setPlaced(false);
      return;
    }

    const rect = sceneFrame(preset);
    setEmptyFrame(rect);
    // Already framed this format: a zoom or a resize must not pull it back.
    if (framedPreset === preset) return;
    if (width <= 0 || height <= 0) return;
    if (!frameInView(world, rect, { width, height })) return;

    framedPreset = preset;
    setPlaced(true);
  });

  // The placeholder covers the canvas, so a wheel gesture never reaches the
  // camera controller underneath. Hand it the same event.
  createEffect(() => {
    const el = overlayEl();
    if (!el) return;

    const handleWheel = (event: WheelEvent) => {
      const canvas = world.get(RenderSurface)?.canvas;
      if (!(canvas instanceof HTMLCanvasElement)) return;
      event.preventDefault();
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        bubbles: false,
        cancelable: true,
      }));
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    onCleanup(() => el.removeEventListener('wheel', handleWheel));
  });

  const handleFocus = (e: FocusEvent) => {
    setEditing(true);
    const el = e.currentTarget as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const handleBlur = (e: FocusEvent) => {
    const el = e.currentTarget as HTMLElement;
    // The default name is shown in the app's language but kept in English, which is what tells it apart.
    const typed = el.textContent?.trim();
    const text = !typed || typed === t(DEFAULT_NAME) ? DEFAULT_NAME : typed;
    setSceneName(text);
    el.textContent = text === DEFAULT_NAME ? t(DEFAULT_NAME) : text;
    setEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
  };

  /**
   * Puts the new scene exactly where the placeholder frame is, rather than
   * framing it the way the camera would on its own. A scene made from a
   * dropped asset need not have the placeholder's aspect ratio, so it is
   * fitted inside the frame rather than stretched over it.
   */
  const focusPlaceholder = (rect: Rect) => {
    const buttonRect = buttonRef?.getBoundingClientRect();
    // The overlay covers the canvas, so its rect is the canvas rect.
    const canvasRect = overlayRef?.getBoundingClientRect();
    if (!buttonRect || !canvasRect) return;

    const scale = Math.min(buttonRect.width / rect.width, buttonRect.height / rect.height);
    const screenX = buttonRect.left - canvasRect.left + (buttonRect.width - rect.width * scale) / 2;
    const screenY = buttonRect.top - canvasRect.top + (buttonRect.height - rect.height * scale) / 2;
    setCamera(world, { a: scale, b: 0, c: 0, d: scale, e: screenX - rect.x * scale, f: screenY - rect.y * scale });
  };

  const sceneOptions = () => ({
    ...(sceneName() != DEFAULT_NAME ? { name: sceneName() } : {}),
    format: selectedPreset(),
    focus: focusPlaceholder,
  });

  const handleInitializeScene = () => {
    const scene = createScene(world, selectedPreset(), sceneOptions());
    if (scene) editor.select(scene);
  };

  /**
   * Assets dropped on the placeholder all go into the one scene it becomes,
   * which takes its format from the last of them that has one.
   */
  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDropping(false);

    const assets = await droppedAssets(event);
    if (!assets.length) return;

    insertAssetsInNewScene(world, assets, sceneOptions());
  };

  /** What a drop brings: library assets dragged in, and files imported now. */
  const droppedAssets = async (event: DragEvent) => {
    const library = world.get(Library);
    if (!library) return [];

    // Read the transfer before the first await: it is gone by the time an
    // import resolves.
    const assetIds = event.dataTransfer?.getData(ASSET_DRAG_TYPE)?.split(',').filter(Boolean) ?? [];
    const files = droppedFiles(event);

    const assets = assetIds.map((id) => library.get(id)).filter((asset) => asset != null);
    if (files.length) assets.push(...await importFiles(library, files, ''));
    return assets;
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDropping(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    // Moving onto the frame or the name is still a drag over the overlay.
    const to = event.relatedTarget;
    if (to instanceof Node && overlayRef?.contains(to)) return;
    setDropping(false);
  };

  return (
    <Show when={showOverlay()}>
      <div
        ref={(el) => {
          overlayRef = el;
          setOverlayEl(el);
          setOverlaySize({ width: el.clientWidth, height: el.clientHeight });
        }}
        class="absolute inset-0 z-2 overflow-hidden"
        on:drop={handleDrop}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
      >
        <div
          class="absolute"
          style={{
            left: `${frame().left}px`,
            top: `${frame().top}px`,
            width: `${frame().width}px`,
            height: `${frame().height}px`,
            visibility: placed() ? "visible" : "hidden",
          }}
        >
          <div class="absolute left-0 right-0 bottom-full mb-0.5 flex items-center justify-between">
            <div
              contentEditable
              onFocus={handleFocus}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              class="whitespace-nowrap text-xs h-4.5 font-450 flex items-center text-muted-foreground justify-center leading-none focus-ring outline-none px-0.5 rounded-sm box-content"
              classList={{ 'text-foreground': editing() }}
            >
              {sceneName() === DEFAULT_NAME ? t(DEFAULT_NAME) : sceneName()}
            </div>
            <DropdownMenu placement="right">
              <DropdownMenuTrigger
                as="button"
                type="button"
                class="flex items-center ursor-pointer bg-transparent border-none p-0 text-xs font-450 text-muted-foreground outline-none"
              >
                <span>{t(selectedPreset().label)}</span>
                <Icon name="chevron-down" class="size-6" />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent class="w-60">
                  <For each={PRESET_CATEGORIES}>
                    {(category, index) => (
                      <>
                        <Show when={index() > 0}>
                          <DropdownMenuSeparator />
                        </Show>
                        <DropdownMenuGroup>
                          <DropdownMenuGroupLabel>{t(category.label)}</DropdownMenuGroupLabel>
                          <For each={category.items}>
                            {(item) => (
                              <DropdownMenuItem onSelect={() => setSelectedPreset(item)}>
                                <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                  {t(item.label)}
                                </span>
                                <DropdownMenuItemDetail>
                                  {item.width}x{item.height}
                                </DropdownMenuItemDetail>
                              </DropdownMenuItem>
                            )}
                          </For>
                        </DropdownMenuGroup>
                      </>
                    )}
                  </For>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenu>
          </div>
          <button
            type="button"
            class="w-full h-full bg-accent/50 border border-border overflow-hidden flex items-center justify-center hover:bg-accent hover:border-input active:bg-muted active:border-input"
            classList={{ 'bg-accent! border-input!': dropping() }}
            onClick={handleInitializeScene}
            ref={buttonRef}
          >
            <Icon name="plus-add" class="size-6 text-muted-foreground" />
          </button>
        </div>

      </div>
    </Show>
  );
}
