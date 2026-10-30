/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For } from "solid-js";
import { createStore } from "solid-js/store";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";

import { AddButton, Section, Segmented, Toggle } from "./extension-ui";
import {
  DEFAULT_PROGRESS_BAR,
  addProgressBar,
  type ProgressBarOptions,
  type ProgressPosition,
  type ProgressThickness,
} from "@/engine/progress-bar";
import { msg, t } from "@/lib/i18n";

/** Kept across tab switches, so the next scene gets the same bar. */
const [options, setOptions] = createStore<ProgressBarOptions>({ ...DEFAULT_PROGRESS_BAR });

const POSITIONS: { id: ProgressPosition; label: string }[] = [
  { id: "bottom", label: msg("Bottom") },
  { id: "top", label: msg("Top") },
];

const THICKNESSES: { id: ProgressThickness; label: string }[] = [
  { id: "thin", label: msg("Thin") },
  { id: "medium", label: msg("Medium") },
  { id: "thick", label: msg("Thick") },
];

const COLORS: { value: string; label: string }[] = [
  { value: "#FFFFFF", label: msg("White") },
  { value: "#2F6FF0", label: msg("Blue") },
  { value: "#FFD60A", label: msg("Yellow") },
  { value: "#FF3B30", label: msg("Red") },
  { value: "#34C759", label: msg("Green") },
  { value: "#000000", label: msg("Black") },
];

/** Preview heights, in px of the stage, per thickness. */
const PREVIEW_HEIGHT: Record<ProgressThickness, number> = { thin: 2, medium: 3, thick: 5 };

export function ProgressBarPanel() {
  const world = useWorld();

  const add = () => {
    const bar = addProgressBar(world, { ...options });
    if (!bar) toast(t("Nothing to add it to"), { description: t("Open a scene first.") });
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="px-3 pb-3 pt-3">
          <Preview />
        </div>

        <div class="flex flex-col gap-4 px-3 pb-4 pt-1">
          <Section label={t("Position")}>
            <Segmented options={POSITIONS} value={options.position} onChange={(position) => setOptions("position", position)} />
          </Section>

          <Section label={t("Thickness")}>
            <Segmented options={THICKNESSES} value={options.thickness} onChange={(thickness) => setOptions("thickness", thickness)} />
          </Section>

          <Section label={t("Color")}>
            <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Color")}>
              <For each={COLORS}>
                {(color) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={options.color === color.value}
                    aria-label={t(color.label)}
                    title={t(color.label)}
                    class="grid size-7 place-items-center rounded-full border transition-colors focus-ring"
                    classList={{
                      "border-foreground": options.color === color.value,
                      "border-transparent hover:border-border-input": options.color !== color.value,
                    }}
                    onClick={() => setOptions("color", color.value)}
                  >
                    <span class="size-5 rounded-full border border-black/10 dark:border-white/15" style={{ background: color.value }} />
                  </button>
                )}
              </For>
            </div>
          </Section>

          <Section label={t("Extras")}>
            <div class="flex flex-wrap gap-1.5">
              <Toggle label={t("Background bar")} on={options.track} onChange={(on) => setOptions("track", on)} />
            </div>
          </Section>
        </div>
      </div>

      <AddButton label={t("Add progress bar")} onClick={add} />
    </div>
  );
}

function Preview() {
  return (
    <div
      class="relative h-20 overflow-hidden rounded-md border border-border"
      style={{ background: "radial-gradient(120% 140% at 50% 0%, #2A3140 0%, #0E1117 70%)" }}
    >
      <BarStrip position={options.position} height={PREVIEW_HEIGHT[options.thickness]} color={options.color} track={options.track} />
    </div>
  );
}

function BarStrip(props: { position: ProgressPosition; height: number; color: string; track: boolean }) {
  const edge = () => (props.position === "top" ? { top: "0" } : { bottom: "0" });
  return (
    <>
      <div
        class="absolute inset-x-0"
        style={{ ...edge(), height: `${props.height}px`, background: props.color, opacity: props.track ? 0.3 : 0 }}
      />
      <div class="absolute left-0 w-[62%]" style={{ ...edge(), height: `${props.height}px`, background: props.color }} />
    </>
  );
}

export function ProgressBarCover() {
  return (
    <div class="relative h-20 w-full overflow-hidden bg-black">
      <img src="/site/sunset.webp" alt="" draggable={false} class="pointer-events-none absolute inset-0 size-full object-cover" />
      <div class="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/50 to-transparent" />
      <BarStrip position="bottom" height={3} color="#2F6FF0" track />
    </div>
  );
}
