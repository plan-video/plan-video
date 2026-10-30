/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onMount, onCleanup, Show, createMemo } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";
import { assetName } from "@plan.video/assets";
import { insertAssetAtPlayhead, replaceAssetSource, saveAssetAs } from "@/engine/asset-actions";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { AssetThumbnail } from "../ui/asset-thumbnail";
import { formatAssetDuration } from "@/utils";
import { useLibrary } from "@/engine/library";
import { t } from "@/lib/i18n";
import { ASSET_DRAG_TYPE } from "./folder-item";
import { openAutoZoom } from "./auto-zoom-panel";
import { openCutout } from "./cutout-panel";
import { setDraggedAsset } from "@/engine/scene-drop";

import type { Asset } from "@plan.video/assets";

export type LazyAssetItemProps = {
  asset: Asset;
  selected: boolean;
  onSelect(): void;
};

export function LazyAssetItem(props: LazyAssetItemProps) {
  const world = useWorld();
  const library = useLibrary();

  const [isVisible, setIsVisible] = createSignal(false);
  const [isRenaming, setIsRenaming] = createSignal(false);
  const assetDuration = createMemo(() => formatAssetDuration(props.asset));
  const name = () => assetName(props.asset);

  let ref: HTMLDivElement | undefined;

  onMount(() => {
    if (!ref) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: "100px" }
    );

    observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  const handleDeleteAsset = async () => {
    try {
      await library()?.remove([props.asset]);
    } catch (e) {
      toast.error(t("Failed to delete"), { description: (e as Error).message });
    }
  };

  const handleDragStart = (event: DragEvent) => {
    event.dataTransfer?.setData(ASSET_DRAG_TYPE, props.asset.id);
    setDraggedAsset(props.asset);
  };

  const commitRename = (nextName: string) => {
    if (!isRenaming()) return;
    setIsRenaming(false);
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === name()) return;
    library()?.rename(props.asset, trimmed);
  };

  const handleRenameKeyDown = (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsRenaming(false);
    }
  };

  const handleFocusElement = (el: HTMLInputElement) => {
    queueMicrotask(() => {
      el.focus();
      el.select();
    });
  };

  const handleReplaceMedia = async () => {
    const lib = library();
    if (lib) await replaceAssetSource(lib, props.asset);
  };

  const handleSaveAs = () => saveAssetAs(props.asset);
  const handleInsertToTimeline = () => insertAssetAtPlayhead(world, props.asset);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        as="div"
        class="flex flex-col gap-1 text-left"
        data-asset-id={props.asset.id}
        draggable={true}
        onDragStart={handleDragStart}
        onDragEnd={() => setDraggedAsset(null)}
        onClick={props.onSelect}
        onContextMenu={props.onSelect}>
        <div
          ref={ref}
          data-selected={props.selected}
          class="relative aspect-video w-full overflow-clip rounded bg-muted after:pointer-events-none after:absolute after:inset-0 after:rounded after:opacity-0 after:ring-2 after:ring-inset after:ring-ring after:z-10 data-[selected=true]:after:opacity-100"
        >
          <Show when={isVisible()}>
            <AssetThumbnail asset={props.asset} class="absolute inset-0" cache={library()?.cache} />
          </Show>
          <Show when={assetDuration()}>
            {(duration) => (
              <div class="absolute left-1 top-1 z-20 flex h-4 items-center justify-center rounded bg-overlay px-1">
                <span class="text-xxs text-primary-foreground">
                  {duration()}
                </span>
              </div>
            )}
          </Show>
        </div>
        <Show
          when={isRenaming()}
          fallback={
            <div class="text-xs text-foreground truncate select-none" title={props.asset.source}>
              {name()}
            </div>
          }
        >
          <input
            ref={handleFocusElement}
            type="text"
            name="asset-name"
            autocomplete="off"
            value={name()}
            onKeyDown={handleRenameKeyDown}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            class="text-xs text-foreground truncate bg-transparent rounded-sm outline-none ring-1 ring-primary px-0.5"
          />
        </Show>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-[180px]">
          <ContextMenuItem onSelect={handleInsertToTimeline}>
            {t("Insert at playhead")}
          </ContextMenuItem>
          <Show when={props.asset.type === "IMAGE"}>
            <ContextMenuItem onSelect={() => openCutout(props.asset)}>
              {t("Remove background")}
            </ContextMenuItem>
          </Show>
          <Show when={props.asset.type === "VIDEO"}>
            <ContextMenuItem onSelect={openAutoZoom}>
              {t("Auto zoom")}
            </ContextMenuItem>
          </Show>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setIsRenaming(true)}>
            {t("Rename")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleReplaceMedia}>
            {t("Replace")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleSaveAs}>
            {t("Save as")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleDeleteAsset}>
            {t("Delete")}
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
