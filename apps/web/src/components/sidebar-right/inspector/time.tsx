/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createMemo, createSignal, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { IncrementDecrementControl } from "@/components/ui/increment-decrement-control";
import { PanelSection } from "@/components/ui/panel-section";
import { Keyframe } from "@/components/ui/keyframe";
import { ControlledTextField } from "@/components/ui/text-field";
import {
  Checkbox,
  CheckboxControl,
  CheckboxInput,
  CheckboxLabel,
} from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { t } from "@/lib/i18n";
import { useTrait, useWorld } from "@plan.video/koota-solid";
import {
  Computed,
  FrameRate,
  Geometry,
  PlaybackRate,
  SourceFrameRate,
  Trim,
  findGeometryAsset,
  findGeometryAssetSource,
  getSequenceFrameRate,
  isGroupLike,
  isScene,
  secondsToFrames,
} from "@plan.video/runtime";
import { useDerived, useEditor } from "@/engine/hooks";
import { findKeyframeTrack, syncKeyframe } from "@/engine/keyframes";
import { editTime, trimIn, trimOut } from "@/engine/timing";

import type { Entity } from "koota";

type TimeAddon = "inOut" | "playbackRate";
type TimeAddons = Partial<Record<TimeAddon, boolean>>;

function formatAsTimecode(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00:00";

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remaining = totalSeconds % 60;

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
}

function parseTimeInput(value: string) {
  const input = value.trim();
  if (!input) return null;

  if (!input.includes(":")) {
    const seconds = Number.parseFloat(input);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return seconds;
  }

  const parts = input.split(":").map((part) => part.trim());
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (parts.some((part) => part.length === 0)) return null;

  const numbers = parts.map((part) => Number.parseFloat(part));
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) return null;

  if (parts.length === 2) {
    const [minutes, seconds] = numbers;
    return minutes * 60 + seconds;
  }

  const [hours, minutes, seconds] = numbers;
  return hours * 3600 + minutes * 60 + seconds;
}

type TimeSettingsProps = {
  selection: Entity[];
};

/**
 * Where the node sits on the timeline and for how long. Edits are time props
 * (`start`/`end`/`sourceIn`/`sourceOut`/`playbackRate`) written through the
 * editor; the resolved bounds are read from Computed, which the systems
 * write, hence `useDerived`.
 */
export function TimeSettings(props: TimeSettingsProps) {
  const world = useWorld();
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  // Added on this node alone: In & Out shown on one clip doesn't follow
  // every other layer. The inspector remounts on a new selection.
  const [addons, setAddons] = createSignal<TimeAddons>({});

  const frameRate = useTrait(world, FrameRate);
  const fps = () => frameRate()?.value ?? 30;

  const trim = useTrait(entity, Trim);
  const start = useDerived(() => entity().get(Computed)?.start ?? 0);
  const end = useDerived(() => entity().get(Computed)?.end ?? 0);

  const isContainer = createMemo(() => isGroupLike(entity()));
  // A container whose trim closes spans that rather than fitting its children.
  const hasTrim = () => (trim()?.end ?? null) !== null;

  const playbackRatePercent = useDerived(() => Math.round((entity().get(Computed)?.playbackRate || 1) * 100));

  const startSeconds = createMemo(() => start() / fps());
  const endSeconds = createMemo(() => end() / fps());
  const durationSeconds = createMemo(() => endSeconds() - startSeconds());

  // Speed is for footage: a text or plain shape shows it only once it has one.
  const supportsPlaybackRate = createMemo(() => {
    const node = entity();
    if (!node.has(Geometry) || isScene(node)) return false;
    return findGeometryAsset(world, node) !== null
      || node.has(PlaybackRate)
      || findKeyframeTrack(world, node, "playbackRate") !== null;
  });

  // The frames directory the node shows, if any, and the element carrying it:
  // the clip itself for a <video>, the paint for a <rect> with a fill.
  const sequenceAsset = useDerived(() => {
    const asset = findGeometryAsset(world, entity());
    return asset?.type === 'SEQUENCE' ? asset : null;
  });
  const sequenceSource = useDerived(() => findGeometryAssetSource(world, entity()));
  // The element's own rate when it sets one, else the asset's. Both are
  // sampled: the trait is what the prop writes, the asset what it falls back to.
  const authoredFrameRate = useTrait(sequenceSource, SourceFrameRate);
  const sequenceFrameRate = createMemo(() => {
    const asset = sequenceAsset();
    const source = sequenceSource();
    if (!asset || !source) return null;

    return authoredFrameRate()?.value || getSequenceFrameRate(source, asset);
  });

  const handleAddAddon = (addon: TimeAddon) => setAddons({ ...addons(), [addon]: true });
  const handleRemoveAddon = (addon: TimeAddon) => setAddons({ ...addons(), [addon]: false });

  // The rate scales the source window onto the timeline around the node's
  // start, so the start stays put on its own; 1 is the default, so it is unset.
  // A speed track stores the rate on the keyframe at the playhead instead.
  const assignPlaybackRate = (rate: number) => {
    const next = Math.max(0.01, rate);
    if (findKeyframeTrack(world, entity(), 'playbackRate')) {
      syncKeyframe(world, editor, entity(), 'playbackRate', next);
      return;
    }
    editor.editProperty(entity(), 'playbackRate', next === 1 ? false : next);
  };

  const handleInChange = (event: Event & { currentTarget: HTMLInputElement }) => {
    const parsed = parseTimeInput(event.currentTarget.value);
    if (parsed === null) return;
    trimIn(world, entity(), secondsToFrames(parsed, fps()));
  };

  const handleOutChange = (event: Event & { currentTarget: HTMLInputElement }) => {
    const parsed = parseTimeInput(event.currentTarget.value);
    if (parsed === null) return;
    trimOut(world, entity(), secondsToFrames(parsed, fps()));
  };

  const handleLengthChange = (durationSec: number) => {
    trimOut(world, entity(), start() + secondsToFrames(durationSec, fps()));
  };

  const toggleTrim = (checked: boolean) => {
    if (checked) {
      trimIn(world, entity(), start());
    } else {
      editTime(world, entity(), 'end', null);
    }
  };

  const handleFrameRateChange = (newRate: number) => {
    const asset = sequenceAsset();
    const source = sequenceSource();
    if (!asset || !source) return;

    const clamped = Math.max(1, Math.min(240, Math.round(newRate)));
    editor.editProperty(source, 'frameRate', clamped === asset.frameRate ? false : clamped);
  };

  return (
    <PanelSection
      title={t("Time")}
      actions={
        <Show when={!addons().inOut}>
          <DropdownMenu placement="bottom-end">
            <Tooltip>
              <TooltipTrigger<typeof DropdownMenuTrigger>
                as={(triggerProps: object) => (
                  <DropdownMenuTrigger<typeof Button>
                    {...triggerProps}
                    as={(buttonProps) => (
                      <Button size="icon" variant="ghost" class="text-muted-foreground" {...buttonProps}>
                        <Icon name="plus-add" />
                      </Button>
                    )}
                  />
                )}
              />
              <TooltipContent>{t("Add option")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent>
              <Show when={!addons().inOut}>
                <DropdownMenuItem onSelect={() => handleAddAddon("inOut")}>
                  {t("In & Out")}
                </DropdownMenuItem>
              </Show>
            </DropdownMenuContent>
          </DropdownMenu>
        </Show>
      }
    >
      <ControlRow
        label={t("Length")}
        contentClass="grid grid-cols-2 gap-2 min-w-0"
      >
        <ControlledTextField
          value={Math.round(durationSeconds() * 10) / 10}
          min={0}
          step={0.1}
          unit="s"
          autoSelect
          limitEvents
          onNumber={handleLengthChange}
        />
        <IncrementDecrementControl
          decrementLabel={t("Decrease length")}
          incrementLabel={t("Increase length")}
          onDecrement={() => handleLengthChange(Math.max(0.1, durationSeconds() - 0.1))}
          onIncrement={() => handleLengthChange(durationSeconds() + 0.1)}
        />
      </ControlRow>

      <Show when={supportsPlaybackRate()}>
        <ControlRow
          label={t("Speed")}
          contentClass="grid grid-cols-2 gap-2 min-w-0"
        >
          <ControlledTextField
            value={playbackRatePercent()}
            min={1}
            step={5}
            unit="%"
            autoSelect
            limitEvents
            keyframe={<Keyframe target={entity()} property="playbackRate" />}
            onNumber={(value) => assignPlaybackRate(value / 100)}
          />
          <IncrementDecrementControl
            decrementLabel={t("Decrease speed")}
            incrementLabel={t("Increase speed")}
            onDecrement={() => assignPlaybackRate(Math.max(1, Math.round(playbackRatePercent() - 10)) / 100)}
            onIncrement={() => assignPlaybackRate(Math.round(playbackRatePercent() + 10) / 100)}
          />
        </ControlRow>
      </Show>

      <Show when={addons().inOut}>
        <ContextMenu>
          <ContextMenuTrigger<typeof ControlRow>
            as={ControlRow}
            label={t("In & Out")}
            contentClass="grid grid-cols-2 gap-2 min-w-0"
          >
            <ControlledTextField
              value={formatAsTimecode(startSeconds())}
              autoSelect
              onChange={handleInChange}
            />
            <ControlledTextField
              value={formatAsTimecode(endSeconds())}
              autoSelect
              onChange={handleOutChange}
            />
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => handleRemoveAddon("inOut")}>
              {t("Remove row")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Show>

      <Show when={sequenceFrameRate()}>
        {(rate) => (
          <ControlRow label={t("Frame Rate")}>
            <ControlledTextField
              value={Math.round(rate())}
              min={1}
              max={240}
              step={1}
              unit="FPS"
              autoSelect
              limitEvents
              onNumber={handleFrameRateChange}
            />
          </ControlRow>
        )}
      </Show>

      <Show when={isContainer()}>
        <Tooltip>
          <TooltipTrigger as="div" class="w-fit">
            <Checkbox
              checked={hasTrim()}
              onChange={toggleTrim}
              class="flex items-center"
            >
              <CheckboxInput />
              <CheckboxControl />
              <CheckboxLabel>
                {t("Trim content")}
              </CheckboxLabel>
            </Checkbox>
          </TooltipTrigger>
          <TooltipContent class="max-w-68 text-pretty">
            {t("Keep the scene this long. Anything past its end is cut off. When off, the scene ends where its last clip does.")}
          </TooltipContent>
        </Tooltip>
      </Show>
    </PanelSection>
  );
}
