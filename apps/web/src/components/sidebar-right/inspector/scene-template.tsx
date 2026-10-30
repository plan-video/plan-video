/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createSignal } from "solid-js";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { useWorld } from "@plan.video/koota-solid";
import { Scene, SolidPaint } from "@plan.video/reconciler";
import { Root, Source, Tool, ToolType, getActiveEntity, getNextName, getViewport, isScene, screenToWorld } from "@plan.video/runtime";
import { useEditor } from "@/engine/hooks";
import { zoomToSelection } from "@/engine/camera";
import { activeLayoutId, layoutTarget, openStreamLayout } from "@/engine/stream-layout";
import { resizeScene } from "@/engine/scene-size";

import { msg, t } from "@/lib/i18n";
import { PRESET_CATEGORIES, type LayoutPresetCategory, type LayoutPreset } from "@/lib/layout-presets";
import {
  LAYOUT_HEIGHT,
  LAYOUT_WIDTH,
  STREAM_LAYOUTS,
  thumbnailSlots,
  type CropId,
  type StreamLayout,
} from "@/lib/stream-layouts";


export function SceneTemplatePanel() {
  const world = useWorld();
  const editor = useEditor();

  const createScene = (preset: LayoutPreset) => {
    const root = world.get(Root)!;
    if (!root.get(Source)?.value) return;

    const viewport = getViewport(world);
    const center = screenToWorld(world, (viewport?.width ?? 0) / 2, (viewport?.height ?? 0) / 2);
    const name = getNextName(world, "Scene");
    const x = Math.round(center.x - preset.width / 2);
    const y = Math.round(center.y - preset.height / 2);

    const [scene] = editor.insertElement(root, () => (
      <Scene name={name} x={x} y={y} width={preset.width} height={preset.height}>
        <SolidPaint color="#000000" />
      </Scene>
    ));
    if (scene) {
      editor.activate(scene);
      editor.select(scene);
    }

    world.set(Tool, { value: ToolType.MOVE });
  };

  const applyPreset = (preset: LayoutPreset) => {
    const active = getActiveEntity(world);
    if (active && isScene(active)) {
      resizeScene(world, active, preset.width, preset.height);
      editor.activate(active);
      editor.select(active);
      zoomToSelection(world);
      return;
    }
    createScene(preset);
  };

  return (
    <PanelSection
      title={
        <div class="flex items-center gap-4" role="tablist">
          <For each={TEMPLATE_TABS}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={templateTab() === tab.id}
                class="text-xs font-450 transition-colors focus-ring rounded-sm"
                classList={{
                  "text-foreground": templateTab() === tab.id,
                  "text-muted-foreground hover:text-foreground": templateTab() !== tab.id,
                }}
                onClick={() => setTemplateTab(tab.id)}
              >
                {t(tab.label)}
              </button>
            )}
          </For>
        </div>
      }
      class="px-0 pt-0 pb-0 gap-0"
    >
      <Show when={templateTab() === "layouts"}>
        <LayoutGrid />
      </Show>
      <Show when={templateTab() === "sizes"}>
        <For each={PRESET_CATEGORIES}>
          {(category) => <PresetGroup category={category} onSelect={applyPreset} />}
        </For>
      </Show>
    </PanelSection>
  );
}

type TemplateTab = "layouts" | "sizes";

const TEMPLATE_TABS: { id: TemplateTab; label: string }[] = [
  { id: "layouts", label: msg("Arrange") },
  { id: "sizes", label: msg("Size") },
];

const [templateTab, setTemplateTab] = createSignal<TemplateTab>("layouts");

function LayoutGrid() {
  const world = useWorld();

  return (
    <div class="px-4 pb-4">
      <div class="grid grid-cols-3 gap-2">
        <For each={STREAM_LAYOUTS}>
          {(layout) => {
            const active = () => !!layoutTarget() && activeLayoutId() === layout.id;
            return (
              <button
                type="button"
                class="group flex min-w-0 flex-col gap-1.5 text-left"
                style={{ cursor: "pointer" }}
                aria-pressed={active()}
                onClick={() => openStreamLayout(world, layout.id)}
              >
                <LayoutThumbnail layout={layout} active={active()} />
                <span
                  class="truncate text-[11px] transition-colors"
                  classList={{
                    "text-foreground": active(),
                    "text-muted-foreground group-hover:text-foreground": !active(),
                  }}
                >
                  {t(layout.label)}
                </span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

const THUMB_FILLS: Record<CropId, string> = {
  facecam: "rgba(0, 140, 255, 0.75)",
  facecam2: "rgba(155, 107, 255, 0.75)",
  gameplay: "light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.14))",
  ui: "rgba(245, 165, 36, 0.7)",
};

export function LayoutThumbnail(props: { layout: StreamLayout; active: boolean }) {
  const slots = thumbnailSlots(props.layout);
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  return (
    <div
      class="relative w-full overflow-hidden rounded-md border bg-[light-dark(#ececec,#000)] transition-colors"
      classList={{
        "border-primary": props.active,
        "border-border group-hover:border-border-strong": !props.active,
      }}
      style={{ "aspect-ratio": `${LAYOUT_WIDTH} / ${LAYOUT_HEIGHT}` }}
    >
      <For each={slots}>
        {(slot) => (
          <div
            class="absolute"
            style={{
              left: pct(slot.box.x, LAYOUT_WIDTH),
              top: pct(slot.box.y, LAYOUT_HEIGHT),
              width: pct(slot.box.width, LAYOUT_WIDTH),
              height: pct(slot.box.height, LAYOUT_HEIGHT),
              "background-color": slot.blur ? "light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.06))" : THUMB_FILLS[slot.crop],
              "border-radius": slot.radius ? `${(slot.radius / slot.box.width) * 100}% / ${(slot.radius / slot.box.height) * 100}%` : undefined,
              "box-shadow": slot.blur ? undefined : "inset 0 0 0 0.5px light-dark(rgba(0, 0, 0, 0.15), rgba(0, 0, 0, 0.6))",
            }}
          />
        )}
      </For>
    </div>
  );
}

type PresetGroupProps = {
  category: LayoutPresetCategory;
  onSelect: (preset: LayoutPreset) => void;
};

function PresetGroup(props: PresetGroupProps) {
  const [open, setOpen] = createSignal(true);

  return (
    <div class="flex flex-col w-full">
      <button
        class="flex items-center text-muted-foreground h-8 w-full px-4 hover:bg-muted/50 transition-transform"
        onClick={() => setOpen(!open())}
      >
        <div classList={{ "-rotate-90": !open() }} class="flex items-center justify-center size-4 overflow-clip">
          <Icon name="chevron-down" class="min-h-6 min-w-6" />
        </div>
        <div class="flex items-center justify-center size-4 overflow-clip ml-0.5">
          <Icon name={props.category.icon} class="min-h-6 min-w-6" />
        </div>
        <span class="text-xs truncate ml-1.5">
          {t(props.category.label)}
        </span>
      </button>
      <Show when={open()}>
        <For each={props.category.items}>
          {(preset) => (
            <button
              class="flex items-center gap-1 h-8 w-full pl-2 pr-4 hover:bg-muted/50"
              onClick={() => props.onSelect(preset)}
            >
              <div class="size-6 shrink-0" />
              <span class="flex-1 text-[11px] text-muted-foreground truncate text-left">
                {t(preset.label)}
              </span>
              <span class="text-[11px] text-muted-foreground/55 shrink-0">
                {preset.width}&times;{preset.height}
              </span>
            </button>
          )}
        </For>
      </Show>
    </div>
  );
}
