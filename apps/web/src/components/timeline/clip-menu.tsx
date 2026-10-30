/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, Show } from 'solid-js';
import { useWorld } from '@plan.video/koota-solid';
import { Selected, findGeometryAsset } from '@plan.video/runtime';
import { assetName } from '@plan.video/assets';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { pickAndImport } from '@/engine/asset-actions';
import { getDocumentEditor } from '@/engine/editor';
import { deleteSelection, duplicateSelection } from '@/engine';
import { useLibrary } from '@/engine/library';
import { clipMediaKind, mediaKind, replaceClipMediaAndReport, selectedMediaClips } from '@/engine/replace-media';
import { splitAtPlayhead } from '@/engine/split';
import { findClipAt } from '@/engine/timeline/render/clip';
import { TimelineSurface } from '@/engine/timeline/surface';
import { t } from '@/lib/i18n';

import type { JSX } from 'solid-js';
import type { Asset } from '@plan.video/assets';
import type { Entity } from 'koota';

export function TimelineClipMenu(props: { children: JSX.Element }) {
  const world = useWorld();
  const library = useLibrary();

  // Read when the menu opens: the menu is not the place to watch the selection change.
  const [clips, setClips] = createSignal<Entity[]>([]);
  const [mediaClips, setMediaClips] = createSignal<Entity[]>([]);

  const handleContextMenu = (event: MouseEvent) => {
    const surface = world.get(TimelineSurface);
    const rect = surface?.canvas?.getBoundingClientRect();
    const clip = surface && rect ? findClipAt(surface, event.clientX - rect.left, event.clientY - rect.top) : null;

    if (!clip) {
      setClips([]);
      return;
    }

    if (!clip.has(Selected)) getDocumentEditor(world).select(clip);
    setClips([...world.query(Selected)]);
    setMediaClips(selectedMediaClips(world));
  };

  const candidates = createMemo((): Asset[] => {
    const targets = mediaClips();
    if (!targets.length) return [];
    const kinds = new Set(targets.map((clip) => clipMediaKind(world, clip)));
    const playing = new Set(targets.map((clip) => findGeometryAsset(world, clip)?.id));
    const only = playing.size === 1 ? [...playing][0] : undefined;
    return (library()?.assets() ?? [])
      .filter((asset) => kinds.has(mediaKind(asset)) && asset.id !== only)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  const replaceWith = (asset: Asset) => replaceClipMediaAndReport(world, mediaClips(), asset);

  const replaceFromFile = async () => {
    const lib = library();
    const targets = mediaClips();
    if (!lib) return;
    const [asset] = await pickAndImport(lib, '');
    if (asset) replaceClipMediaAndReport(world, targets, asset);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        as="div"
        class="relative size-full"
        data-tour="timeline"
        disabled={clips().length === 0}
        onContextMenu={handleContextMenu}
      >
        {props.children}
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent class="w-[200px]">
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={mediaClips().length === 0}>{t('Replace media...')}</ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent class="w-[220px] max-h-[320px] overflow-y-auto">
                <ContextMenuItem onSelect={replaceFromFile}>{t('Choose file...')}</ContextMenuItem>
                <Show when={candidates().length > 0}>
                  <ContextMenuSeparator />
                  <For each={candidates()}>
                    {(asset) => (
                      <ContextMenuItem onSelect={() => replaceWith(asset)}>
                        <span class="min-w-0 truncate">{assetName(asset)}</span>
                      </ContextMenuItem>
                    )}
                  </For>
                </Show>
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
          <ContextMenuItem onSelect={() => duplicateSelection(world)}>
            {t('Duplicate')}
            <ContextMenuShortcut>⌘D</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => splitAtPlayhead(world)}>
            {t('Split at playhead')}
            <ContextMenuShortcut>⌘B</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => deleteSelection(world)}>
            {clips().length > 1 ? t('{count, plural, one {Delete # clip} other {Delete # clips}}', { count: clips().length }) : t('Delete')}
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}
