/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, Show } from "solid-js";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import { PresetGrid, PresetTile } from "@/components/ui/preset-tile";
import { TextStyleLook } from "@/components/editor/text-style-look";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ColorOpacityRow } from "@/components/ui/color-opacity-row";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { useTrait } from "@plan.video/koota-solid";
import { Caption, colorToHex } from "@plan.video/runtime";
import { useEditor } from "@/engine/hooks";
import { TEXT_STYLES, type TextStyle } from "@/engine/text-presets";
import { cx } from "@/lib/cva";
import { msg, t } from "@/lib/i18n";
import {
  CAPTION_MOTIONS,
  DEFAULT_CAPTION_PRESET,
  captionPresetOption,
} from "./caption-types";

import type { CaptionPresetOption } from "./caption-types";
import type { Entity } from "koota";

type CaptionSettingsProps = {
  selection: Entity[];
};

/** How many looks show before "All looks". */
const FIRST_LOOKS = 6;

/**
 * What a `<captions>` element says for itself: the look its words wear
 * (`look`, the same looks as the Text tab), the motion that shows them as
 * they are said (`preset`), and the colors filling that motion's slots
 * (`colors`). Everything else is the preset's base coat — the document writes
 * it onto the entity, the look over it, and lets authored style props (font,
 * position) overwrite both — and not in the file at all unless the user edits
 * it, which is why this panel is as short as it is.
 */
export function CaptionSettings(props: CaptionSettingsProps) {
  const editor = useEditor();
  const entity = () => props.selection[0]!;

  let anchorRef!: HTMLDivElement;

  const caption = useTrait(entity, Caption);
  const preset = createMemo(() => captionPresetOption(caption()?.type));
  const look = () => caption()?.look;
  // Pop's slot is its fill, which a look brings itself.
  const slots = () => (look() && preset().name === "pop" ? [] : preset().slots);
  const colors = () => caption()?.colors ?? [];

  const [openSlot, setOpenSlot] = createSignal<number | null>(null);
  const [showAll, setShowAll] = createSignal(false);

  // Folded, the grid shows the first few; a look further down takes the last
  // place, so the one the caption has is never hidden.
  const shownLooks = () => {
    if (showAll()) return TEXT_STYLES;
    const first = TEXT_STYLES.slice(0, FIRST_LOOKS);
    const worn = TEXT_STYLES.find((style) => style.id === look());
    return worn && !first.includes(worn) ? [...first.slice(0, -1), worn] : first;
  };

  const setMotion = (next: CaptionPresetOption) => {
    setOpenSlot(null);
    // The slots belong to the preset, so the colors filling them go with it.
    editor.editProperty(entity(), "colors", false);
    editor.editProperty(
      entity(),
      "preset",
      next === DEFAULT_CAPTION_PRESET ? false : next.name,
    );
  };

  const handleMotionChange = (next: CaptionPresetOption) => {
    if (next !== preset()) setMotion(next);
  };

  /** Picking the look the caption has takes it off again. */
  const handleLookChange = (next: TextStyle) => {
    const wearing = look() === next.id;
    editor.editProperty(entity(), "look", wearing ? false : next.id);
    // A style from before looks paints the words itself; a look goes on the plain motion.
    if (!wearing && !CAPTION_MOTIONS.includes(preset())) setMotion(DEFAULT_CAPTION_PRESET);
  };

  /** A slot the file has not filled shows what the preset's decoder falls back to. */
  const slotColor = (index: number) => colors()[index] ?? slots()[index]?.defaultColor ?? 0;

  /**
   * `colors` is positional, so setting one slot spells every slot the preset
   * has: a sparse write would read back as the ones before it.
   */
  const setSlotColor = (index: number, next: number) => {
    const values = slots().map((_, i) => colorToHex(i === index ? next : slotColor(i)));
    editor.editProperty(entity(), "colors", values);
  };

  return (
    <PanelSection title={t({ message: "Caption", context: "video subtitles" })} ref={anchorRef}>
      <PresetGrid>
        <For each={shownLooks()}>
          {(style) => {
            // A still: made once, not again each time the tile is hovered.
            const preview = <TextStyleLook style={style} />;
            return (
              <PresetTile
                title={t(style.name)}
                aspect="16 / 10"
                selected={look() === style.id}
                onClick={() => handleLookChange(style)}
              >
                {() => preview}
              </PresetTile>
            );
          }}
        </For>
      </PresetGrid>

      <button
        type="button"
        aria-expanded={showAll()}
        class="flex h-7 w-full items-center justify-between rounded-md bg-accent px-2 text-xs text-foreground transition-colors hover:bg-secondary-hover focus-ring"
        onClick={() => setShowAll(!showAll())}
      >
        {showAll() ? t("Fewer looks") : t("All looks")}
        <Icon
          name="chevron-down"
          class={showAll() ? "size-4 rotate-180 text-muted-foreground transition-transform" : "size-4 text-muted-foreground transition-transform"}
        />
      </button>

      <h3 class="pt-1 text-xs text-muted-foreground">{t("Motion")}</h3>
      <div class="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t("Motion")}>
        <For each={CAPTION_MOTIONS}>
          {(option) => (
            <button
              type="button"
              role="radio"
              aria-checked={option === preset()}
              class={cx(
                "h-8 truncate rounded-md px-2 text-xs transition-colors focus-ring",
                option === preset()
                  ? "bg-foreground/16 text-foreground"
                  : "bg-accent text-muted-foreground hover:bg-secondary-hover hover:text-foreground",
              )}
              onClick={() => handleMotionChange(option)}
            >
              {t(option.label)}
            </button>
          )}
        </For>
      </div>

      <For each={slots()}>
        {(slot, index) => (
          <ControlRow label={t(slot.label)}>
            <ColorOpacityRow
              color={slotColor(index())}
              onChangeColor={(next) => setSlotColor(index(), next)}
              onClick={() => setOpenSlot(openSlot() === index() ? null : index())}
            />
          </ControlRow>
        )}
      </For>

      <Show when={openSlot() !== null}>
        <FloatingInspector open anchorRef={anchorRef}>
          <FloatingInspectorHeader>
            <FloatingInspectorTitle>
              {t(slots()[openSlot()!]?.label ?? msg("Color"))}
            </FloatingInspectorTitle>
            <div class="ml-auto">
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={() => setOpenSlot(null)}
                >
                  <Icon name="close-remove" class="size-6" />
                </TooltipTrigger>
                <TooltipContent>{t("Close")}</TooltipContent>
              </Tooltip>
            </div>
          </FloatingInspectorHeader>
          <FloatingInspectorContent class="p-0">
            <ColorOpacityPicker
              color={slotColor(openSlot()!)}
              opacity={1}
              onColorChange={(next) => setSlotColor(openSlot()!, next)}
              withoutOpacity
            />
          </FloatingInspectorContent>
        </FloatingInspector>
      </Show>
    </PanelSection>
  );
}
