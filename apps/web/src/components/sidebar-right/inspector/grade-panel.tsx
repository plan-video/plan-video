/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useHas, useTrait, useWorld } from "@plan.video/koota-solid";
import {
  AssetId,
  GRADE_KEYS,
  Grade,
  Hidden,
  NEUTRAL_GRADE,
  fillGradeFilter,
  getEntityTree,
  gradePrimitives,
} from "@plan.video/runtime";

import { AssetThumbnail } from "@/components/ui/asset-thumbnail";
import { Button } from "@/components/ui/button";
import { ColorWheel } from "@/components/ui/color-wheel";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import { PresetGrid, PresetTile } from "@/components/ui/preset-tile";
import { SegmentedIconTabs } from "@/components/ui/segmented-icon-tabs";
import { SliderInput } from "@/components/ui/slider-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/engine/hooks";
import { useLibrary } from "@/engine/library";
import {
  canSaveGradePresets,
  definedGrade,
  deleteGradePreset,
  gradePresets,
  renameGradePreset,
  saveGradePreset,
  type GradePreset,
} from "@/lib/grade-presets";
import { t } from "@/lib/i18n";
import { LOOK_OPTIONS, SLIDER_GROUPS, WHEEL_OPTIONS } from "./grade-looks";

import type { GradeValues, GradeWheel } from "@plan.video/runtime";
import type { Entity } from "koota";
import type { ThumbnailAsset } from "@/components/ui/asset-thumbnail";

type Tab = "looks" | "adjust" | "wheels";

// Kept, so the panel opens where it was left.
const [lastTab, setLastTab] = createSignal<Tab>("looks");

const STILL = "/site/surf.webp";

/** Whether two grades say the same, neutral values aside. */
function sameGrade(a: Partial<GradeValues>, b: Partial<GradeValues>): boolean {
  return GRADE_KEYS.every((key) => (a[key] ?? NEUTRAL_GRADE[key]) === (b[key] ?? NEUTRAL_GRADE[key]));
}

type GradePanelProps = {
  grade: Entity;
  target: Entity;
  anchorRef: HTMLElement;
  onClose(): void;
};

export function GradePanel(props: GradePanelProps) {
  const world = useWorld();
  const editor = useEditor();
  const library = useLibrary();

  const trait = useTrait(() => props.grade, Grade);
  const hidden = useHas(() => props.grade, Hidden);
  const values = createMemo((): GradeValues => ({ ...NEUTRAL_GRADE, ...trait() }));

  const set = (key: keyof GradeValues, value: number | string) => {
    if (values()[key] !== value) editor.editProperty(props.grade, key, value);
  };

  /** What `next` leaves out goes back to neutral. */
  const apply = (next: Partial<GradeValues>) => {
    for (const key of GRADE_KEYS) set(key, next[key] ?? NEUTRAL_GRADE[key]);
  };

  const previewAsset = createMemo((): ThumbnailAsset | undefined => {
    const lib = library();
    if (!lib) return undefined;
    for (const entity of getEntityTree(world, props.target)) {
      const id = entity.get(AssetId)?.value;
      const asset = id ? lib.get(id) : undefined;
      if (asset && (asset.mimeType.startsWith("video") || asset.mimeType.startsWith("image"))) return asset;
    }
    return undefined;
  });

  const tabs = [
    { value: "looks" as const, label: t("Looks") },
    { value: "adjust" as const, label: t("Adjust") },
    { value: "wheels" as const, label: t("Wheels") },
  ];

  return (
    <FloatingInspector open anchorRef={props.anchorRef} width={296}>
      <FloatingInspectorHeader class="items-center justify-between pl-4 pr-2">
        <span class="text-xs font-450">{t("Color grade")}</span>
        <div class="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={() => editor.editProperty(props.grade, "hidden", !hidden())}
            >
              <Show when={!hidden()} fallback={<Icon name="eye-off" />}>
                <Icon name="eye-on" />
              </Show>
            </TooltipTrigger>
            <TooltipContent>{hidden() ? t("Show grade") : t("Hide grade")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as={Button} size="icon" variant="ghost" class="text-muted-foreground" onClick={props.onClose}>
              <Icon name="close-remove" />
            </TooltipTrigger>
            <TooltipContent>{t("Close")}</TooltipContent>
          </Tooltip>
        </div>
      </FloatingInspectorHeader>
      <FloatingInspectorSeparator />
      <div class="px-4 pt-3">
        <SegmentedIconTabs value={lastTab} onChange={setLastTab} items={tabs} />
      </div>
      <FloatingInspectorContent class="flex max-h-[min(560px,70vh)] flex-col gap-4 overflow-y-auto p-4">
        <Show when={lastTab() === "looks"}>
          <LooksTab values={values()} asset={previewAsset()} set={set} apply={apply} />
        </Show>
        <Show when={lastTab() === "adjust"}>
          <AdjustTab values={values()} set={set} />
        </Show>
        <Show when={lastTab() === "wheels"}>
          <WheelsTab values={values()} set={set} />
        </Show>
        <div class="flex justify-end">
          <Button
            variant="ghost"
            size="small"
            class="text-muted-foreground"
            disabled={sameGrade(values(), NEUTRAL_GRADE)}
            onClick={() => apply(NEUTRAL_GRADE)}
          >
            {t("Reset")}
          </Button>
        </div>
      </FloatingInspectorContent>
    </FloatingInspector>
  );
}

type TabProps = {
  values: GradeValues;
  set(key: keyof GradeValues, value: number | string): void;
};

function LooksTab(props: TabProps & { asset?: ThumbnailAsset; apply(next: Partial<GradeValues>): void }) {
  const library = useLibrary();
  const [naming, setNaming] = createSignal<{ id?: string; name: string } | null>(null);

  const withLook = (look: string): GradeValues => ({ ...props.values, look, lookAmount: props.values.look ? props.values.lookAmount : 100 });

  const pickLook = (look: string) => {
    if (look && !props.values.look) props.set("lookAmount", 100);
    props.set("look", look);
  };

  const commitName = () => {
    const current = naming();
    setNaming(null);
    if (!current) return;
    if (current.id) renameGradePreset(current.id, current.name);
    else saveGradePreset(current.name, props.values);
  };

  const startSave = () => {
    const base = t("My grade");
    const taken = new Set(gradePresets().map((preset) => preset.name.toLowerCase()));
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    setNaming({ name });
  };

  return (
    <>
      <PresetGrid columns={3}>
        <PresetTile label={t("No look")} aspect="4 / 3" selected={!props.values.look} onClick={() => pickLook("")}>
          {() => <GradePreview values={withLook("")} asset={props.asset} cache={library()?.cache} />}
        </PresetTile>
        <For each={LOOK_OPTIONS}>
          {(option) => (
            <PresetTile
              label={t(option.label)}
              title={t(option.label)}
              aspect="4 / 3"
              selected={props.values.look === option.id}
              onClick={() => pickLook(option.id)}
            >
              {() => <GradePreview values={withLook(option.id)} asset={props.asset} cache={library()?.cache} />}
            </PresetTile>
          )}
        </For>
      </PresetGrid>

      <Show when={props.values.look}>
        <GradeSlider
          label={t("Strength")}
          value={props.values.lookAmount}
          min={0}
          max={100}
          neutral={100}
          format={(value) => `${value}%`}
          onChange={(value) => props.set("lookAmount", value)}
        />
      </Show>

      <div class="flex flex-col gap-2">
        <div class="flex h-7 items-center justify-between">
          <span class="text-xs font-450">{t("Saved grades")}</span>
          <Show when={canSaveGradePresets() && !naming()}>
            <Button variant="ghost" size="small" class="text-muted-foreground" onClick={startSave}>
              {t("Save grade")}
            </Button>
          </Show>
        </div>

        <Show when={naming()}>
          {(current) => (
            <form
              class="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                commitName();
              }}
            >
              <input
                ref={(input) => queueMicrotask(() => input.select())}
                value={current().name}
                maxLength={40}
                aria-label={t("Grade name")}
                class="bg-input h-7 min-w-0 flex-1 rounded-md px-2 text-xs outline-none focus-ring"
                onInput={(event) => setNaming({ ...current(), name: event.currentTarget.value })}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setNaming(null);
                  }
                }}
              />
              <Button type="submit" size="small" disabled={!current().name.trim()}>
                {current().id ? t("Rename") : t("Save")}
              </Button>
            </form>
          )}
        </Show>

        <Show when={gradePresets().length > 0}>
          <PresetGrid columns={3}>
            <For each={gradePresets()}>
              {(preset) => (
                <SavedGradeTile
                  preset={preset}
                  asset={props.asset}
                  selected={sameGrade(definedGrade(props.values), preset.grade)}
                  onApply={() => props.apply(preset.grade)}
                  onRename={() => setNaming({ id: preset.id, name: preset.name })}
                />
              )}
            </For>
          </PresetGrid>
        </Show>
      </div>
    </>
  );
}

function SavedGradeTile(props: {
  preset: GradePreset;
  asset?: ThumbnailAsset;
  selected: boolean;
  onApply(): void;
  onRename(): void;
}) {
  const library = useLibrary();
  const values = createMemo((): GradeValues => ({ ...NEUTRAL_GRADE, ...props.preset.grade }));

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <PresetTile label={props.preset.name} title={props.preset.name} aspect="4 / 3" selected={props.selected} onClick={props.onApply}>
          {() => <GradePreview values={values()} asset={props.asset} cache={library()?.cache} />}
        </PresetTile>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={props.onApply}>{t("Apply")}</ContextMenuItem>
        <ContextMenuItem onSelect={props.onRename}>{t("Rename")}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => deleteGradePreset(props.preset.id)}>{t("Delete")}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AdjustTab(props: TabProps) {
  return (
    <For each={SLIDER_GROUPS}>
      {(group) => (
        <div class="flex flex-col gap-2">
          <span class="text-xs font-450">{t(group.title)}</span>
          <For each={group.sliders}>
            {(slider) => (
              <GradeSlider
                label={t(slider.label)}
                value={props.values[slider.key]}
                onChange={(value) => props.set(slider.key, value)}
              />
            )}
          </For>
        </div>
      )}
    </For>
  );
}

function WheelsTab(props: TabProps) {
  const setWheel = (wheel: GradeWheel, hue: number, amount: number) => {
    props.set(`${wheel}Hue`, hue);
    props.set(`${wheel}Amount`, amount);
  };

  return (
    <For each={WHEEL_OPTIONS}>
      {(option) => (
        <div class="flex items-center gap-3">
          <ColorWheel
            class="size-20 shrink-0"
            label={t(option.label)}
            hue={props.values[`${option.wheel}Hue`]}
            amount={props.values[`${option.wheel}Amount`]}
            onChange={(hue, amount) => setWheel(option.wheel, hue, amount)}
            onReset={() => setWheel(option.wheel, 0, 0)}
          />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class="text-xs text-muted-foreground">{t(option.label)}</span>
            <SliderInput
              value={props.values[`${option.wheel}Level`]}
              min={-100}
              max={100}
              onChange={(value) => props.set(`${option.wheel}Level`, value)}
            />
          </div>
        </div>
      )}
    </For>
  );
}

function GradeSlider(props: {
  label: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  neutral?: number;
  format?(value: number): string;
}) {
  const neutral = () => props.neutral ?? 0;
  return (
    <div class="flex items-center gap-2">
      <span
        class="w-24 shrink-0 cursor-default truncate text-xs text-muted-foreground select-none"
        title={t("Double-click to reset")}
        onDblClick={() => props.onChange(neutral())}
      >
        {props.label}
      </span>
      <SliderInput
        class="min-w-0 flex-1"
        value={props.value}
        min={props.min ?? -100}
        max={props.max ?? 100}
        format={props.format}
        onChange={props.onChange}
      />
    </div>
  );
}

let previews = 0;

// Each tile keeps its own filter, so the canvas's cache never takes one from under it.
function GradePreview(props: { values: GradeValues; asset?: ThumbnailAsset; cache?: Parameters<typeof AssetThumbnail>[0]["cache"] }) {
  const id = `pv-grade-tile-${previews++}`;
  let filter!: SVGFilterElement;

  const primitives = createMemo(() => gradePrimitives(props.values), null, {
    equals: (a, b) => a?.matrix === b?.matrix && a?.red === b?.red && a?.green === b?.green && a?.blue === b?.blue,
  });

  createEffect(() => {
    const current = primitives();
    if (current) fillGradeFilter(filter, current);
  });

  return (
    <div class="absolute inset-0">
      <svg aria-hidden="true" width="0" height="0" class="absolute">
        <filter ref={filter} id={id} />
      </svg>
      <div class="absolute inset-0" style={{ filter: primitives() ? `url(#${id})` : undefined }}>
        <Show when={props.asset} fallback={<img src={STILL} alt="" class="size-full object-cover" draggable={false} />}>
          {(asset) => <AssetThumbnail asset={asset()} cache={props.cache} class="size-full" size={{ width: 90, height: 68 }} />}
        </Show>
      </div>
    </div>
  );
}
