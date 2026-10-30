/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MeterScale, VolumeControl, VolumeMeter } from './volume-meter';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQuery, useTrait, useWorld } from '@plan.video/koota-solid';
import { AudioBusHandle, Computed, Name, Volume } from '@plan.video/runtime';
import { Or } from 'koota';
import { useDerived, useEditor, useTimelineIndex } from '@/engine/hooks';
import { syncKeyframe } from '@/engine/keyframes';
import { t } from '@/lib/i18n';

import type { Entity } from 'koota';

function LayerName(props: { entity: Entity | undefined }) {
  const name = useTrait(() => props.entity, Name);

  return <>{name()?.value || (props.entity ? t('Layer {id}', { id: props.entity.id() }) : t('Layer'))}</>;
}

export function Soundboard() {
  const world = useWorld();
  const editor = useEditor();
  const timelineIndex = useTimelineIndex();

  const scene = () => timelineIndex().root ?? undefined;

  // A bus is spun up the first time a node has audio to play, so what is meterable grows while a project plays:
  // the query follows that, the timeline index (which only reports a changed tree) would not.
  const audible = useQuery(Or(AudioBusHandle, Volume));

  const audioLayers = createMemo(() => {
    const metered = new Set<Entity>(audible());
    return timelineIndex()
      .layers
      .map((layer) => layer.entity)
      .filter((entity) => metered.has(entity));
  });

  const [leftMeterEntity, setLeftMeterEntity] = createSignal<Entity | undefined>(audioLayers()[1]);
  const [rightMeterEntity, setRightMeterEntity] = createSignal<Entity | undefined>(audioLayers()[0]);

  const leftOptions = () => audioLayers().filter((entity) => entity !== rightMeterEntity());
  const rightOptions = () => audioLayers().filter((entity) => entity !== leftMeterEntity());

  createEffect(() => {
    const list = audioLayers();
    let left = leftMeterEntity();
    let right = rightMeterEntity();

    if (left !== undefined && !list.includes(left)) left = undefined;
    if (right !== undefined && !list.includes(right)) right = undefined;

    // Prefer a layer the sibling doesn't show, so the two meters never collapse onto the same layer.
    if (right === undefined) right = list.find((entity) => entity !== left);
    if (left === undefined) left = list.find((entity) => entity !== right);

    setRightMeterEntity(right);
    setLeftMeterEntity(left);
  }, { defer: true });

  // The playback system sets the bus back to null when the node's decoders are released.
  const masterBus = useTrait(scene, AudioBusHandle);
  const leftMeterBus = useTrait(leftMeterEntity, AudioBusHandle);
  const rightMeterBus = useTrait(rightMeterEntity, AudioBusHandle);

  const masterNode = () => masterBus()?.getGain();
  const leftMeterNode = () => leftMeterBus()?.getGain();
  const rightMeterNode = () => rightMeterBus()?.getGain();

  // Computed is written by the systems without change events.
  const masterVolume = useDerived(() => scene()?.get(Computed)?.volume ?? 0);
  const leftMeterVolume = useDerived(() => leftMeterEntity()?.get(Computed)?.volume ?? 0);
  const rightMeterVolume = useDerived(() => rightMeterEntity()?.get(Computed)?.volume ?? 0);

  const editVolume = (entity: Entity | undefined, volume: number) => {
    if (entity === undefined) return;
    // Whole decibels: a dragged fader would otherwise write a new fraction per pointer event.
    const next = Math.round(volume);
    // 0 dB is unity, so a volume left there is unset.
    editor.editProperty(entity, 'volume', next === 0 ? false : next);
    syncKeyframe(world, editor, entity, 'volume', next);
  };

  const handleMasterVolumeChange = (volume: number) => editVolume(scene(), volume);
  const handleLeftMeterVolumeChange = (volume: number) => editVolume(leftMeterEntity(), volume);
  const handleRightMeterVolumeChange = (volume: number) => editVolume(rightMeterEntity(), volume);

  const handleLeftMeterLayerChange = (entity: Entity | null) => {
    if (entity === null) return;
    if (audioLayers().includes(entity)) setLeftMeterEntity(entity);
  }

  const handleRightMeterLayerChange = (entity: Entity | null) => {
    if (entity === null) return;
    if (audioLayers().includes(entity)) setRightMeterEntity(entity);
  }

  return (
    <div class="soundboard flex items-stretch h-full w-full justify-between px-4 pt-4 pb-1">
      <div class="flex flex-col items-center h-full gap-2">
        <div class="flex flex-1 min-h-0">
          <VolumeControl
            volume={leftMeterVolume()}
            disabled={!leftMeterNode()}
            onVolumeChange={handleLeftMeterVolumeChange}
          />
          <VolumeMeter audioNode={leftMeterNode()} />
          <MeterScale />
        </div>
        <div class="h-6 flex items-center justify-center shrink-0">
          <Show when={leftMeterEntity() !== undefined}>
            <Select<Entity>
              value={leftMeterEntity()}
              onChange={handleLeftMeterLayerChange}
              options={leftOptions()}
              disabled={leftOptions().length <= 1}
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}><LayerName entity={itemProps.item.rawValue} /></SelectItem>
              )}
            >
              <SelectTrigger class="text-xs text-muted-foreground hover:text-foreground bg-transparent hover:bg-transparent w-20">
                <SelectValue<Entity>>{(state) => <LayerName entity={state.selectedOption()} />}</SelectValue>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent />
              </SelectPortal>
            </Select>
          </Show>
        </div>
      </div>
      <div class="flex flex-col items-center h-full gap-2">
        <div class="flex flex-1 min-h-0">
          <VolumeControl
            volume={rightMeterVolume()}
            disabled={!rightMeterNode()}
            onVolumeChange={handleRightMeterVolumeChange}
          />
          <VolumeMeter audioNode={rightMeterNode()} />
          <MeterScale />
        </div>
        <div class="h-6 flex items-center justify-center shrink-0">
          <Show when={rightMeterEntity() !== undefined}>
            <Select<Entity>
              value={rightMeterEntity()}
              onChange={handleRightMeterLayerChange}
              options={rightOptions()}
              disabled={rightOptions().length <= 1}
              itemComponent={(itemProps) => (
                <SelectItem item={itemProps.item}><LayerName entity={itemProps.item.rawValue} /></SelectItem>
              )}
            >
              <SelectTrigger class="text-xs text-muted-foreground hover:text-foreground bg-transparent hover:bg-transparent w-20">
                <SelectValue<Entity>>{(state) => <LayerName entity={state.selectedOption()} />}</SelectValue>
              </SelectTrigger>
              <SelectPortal>
                <SelectContent />
              </SelectPortal>
            </Select>
          </Show>
        </div>
      </div>
      <div class="flex flex-col items-center h-full gap-2">
        <div class="flex flex-1 min-h-0">
          <VolumeControl
            volume={masterVolume()}
            disabled={!masterNode()}
            onVolumeChange={handleMasterVolumeChange}
          />
          <VolumeMeter audioNode={masterNode()} />
          <MeterScale />
        </div>
        <div class="h-6 flex items-center justify-center shrink-0">
          <span class="text-base text-muted-foreground">{t("Master")}</span>
        </div>
      </div>
    </div>
  );
}
