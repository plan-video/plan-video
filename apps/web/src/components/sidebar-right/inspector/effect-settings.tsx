/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createSignal } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";

import { ControlRow } from "@/components/ui/control-group";
import { PanelSection } from "@/components/ui/panel-section";
import { runAutoZoom } from "@/components/sidebar-left/auto-zoom-panel";
import { EFFECTS, effectFailed } from "@/components/sidebar-left/effects-panel";
import { siblingBefore } from "@/engine/auto-zoom";
import { SLOW_SPEEDS, effectOf, removeEffect, updateEffect, type EffectKind, type EffectOptions, type FoundEffect } from "@/engine/effects";
import { useDerived } from "@/engine/hooks";
import { msg, t } from "@/lib/i18n";

import type { Entity } from "koota";

type Option<T> = { id: T; label: string };

const STRENGTHS: Option<"subtle" | "medium" | "strong">[] = [
  { id: "subtle", label: msg("Subtle") },
  { id: "medium", label: msg("Medium") },
  { id: "strong", label: msg("Strong") },
];

const MOTIONS: Option<"smooth" | "snap">[] = [
  { id: "smooth", label: msg("Smooth") },
  { id: "snap", label: msg("Instant") },
];

const seconds = (values: number[]) => values.map((value) => ({ id: value, label: `${value}s` }));

const sameFound = (a: FoundEffect | null, b: FoundEffect | null) =>
  a === b || (!!a && !!b && a.entity === b.entity && a.kind === b.kind && JSON.stringify(a.options) === JSON.stringify(b.options));

export function EffectSettings(props: { selection: Entity[] }) {
  const world = useWorld();
  const found = useDerived(() => (props.selection.length === 1 ? effectOf(world, props.selection[0]) : null), sameFound);
  const [busy, setBusy] = createSignal(false);

  const label = (kind: EffectKind) => EFFECTS.find((effect) => effect.kind === kind)?.label ?? "";

  const change = <K extends EffectKind>(kind: K, patch: Partial<EffectOptions[K]>) => {
    const current = found();
    if (!current || current.kind !== kind || busy()) return;
    const options = { ...current.options, ...patch } as EffectOptions[K];
    if (JSON.stringify(options) === JSON.stringify(current.options)) return;

    if (current.kind === "autoZoom") {
      setBusy(true);
      void runAutoZoom(world, options as EffectOptions["autoZoom"], siblingBefore(current.entity)).finally(() => setBusy(false));
      return;
    }
    const result = updateEffect(world, current as never, options as never);
    if (!result.ok) effectFailed(result.reason);
  };

  return (
    <Show when={found()}>
      {(effect) => (
        <PanelSection title={t(label(effect().kind))}>
          <Switch>
            <Match when={effect().kind === "zoomIn" && (effect().options as EffectOptions["zoomIn"])}>
              {(options) => (
                <>
                  <Row label={t("Zoom")} options={STRENGTHS} value={options().strength} onChange={(strength) => change("zoomIn", { strength })} />
                  <Row label={t("Motion")} options={MOTIONS} value={options().motion} onChange={(motion) => change("zoomIn", { motion })} />
                  <Row label={t("Length")} options={seconds([1, 2, 3])} value={options().length} onChange={(length) => change("zoomIn", { length })} />
                </>
              )}
            </Match>

            <Match when={effect().kind === "autoZoom" && (effect().options as EffectOptions["autoZoom"])}>
              {(options) => (
                <>
                  <Row label={t("Zoom")} options={STRENGTHS} value={options().strength} onChange={(strength) => change("autoZoom", { strength })} />
                  <Row
                    label={t("How often")}
                    options={[{ id: "fewer" as const, label: msg("Less often") }, { id: "normal" as const, label: msg("Normal") }, { id: "more" as const, label: msg("More often") }]}
                    value={options().frequency}
                    onChange={(frequency) => change("autoZoom", { frequency })}
                  />
                  <Row label={t("Motion")} options={MOTIONS} value={options().motion} onChange={(motion) => change("autoZoom", { motion })} />
                </>
              )}
            </Match>

            <Match when={effect().kind === "slowZoom" && (effect().options as EffectOptions["slowZoom"])}>
              {(options) => (
                <>
                  <Row
                    label={t("Direction")}
                    options={[{ id: "in" as const, label: msg("Zoom in") }, { id: "out" as const, label: msg("Zoom out") }]}
                    value={options().direction}
                    onChange={(direction) => change("slowZoom", { direction })}
                  />
                  <Row label={t("Zoom")} options={STRENGTHS} value={options().strength} onChange={(strength) => change("slowZoom", { strength })} />
                  <Row
                    label={t("Length")}
                    options={[...seconds([3, 5]), { id: "clip" as const, label: msg("Whole clip") }]}
                    value={options().length}
                    onChange={(length) => change("slowZoom", { length })}
                  />
                </>
              )}
            </Match>

            <Match when={effect().kind === "shake" && (effect().options as EffectOptions["shake"])}>
              {(options) => (
                <>
                  <Row label={t("Strength")} options={STRENGTHS} value={options().strength} onChange={(strength) => change("shake", { strength })} />
                  <Row label={t("Length")} options={seconds([0.5, 1, 2])} value={options().length} onChange={(length) => change("shake", { length })} />
                </>
              )}
            </Match>

            <Match when={effect().kind === "slowMotion" && (effect().options as EffectOptions["slowMotion"])}>
              {(options) => (
                <>
                  <Row
                    label={t("Speed")}
                    options={SLOW_SPEEDS.map((value) => ({ id: value, label: `${value}×` }))}
                    value={options().speed}
                    onChange={(speed) => change("slowMotion", { speed })}
                  />
                  <Row label={t("Length")} options={seconds([1, 2, 3])} value={options().length} onChange={(length) => change("slowMotion", { length })} />
                  <Row label={t("Ramp")} options={MOTIONS} value={options().ramp} onChange={(ramp) => change("slowMotion", { ramp })} />
                </>
              )}
            </Match>

            <Match when={effect().kind === "flash" && (effect().options as EffectOptions["flash"])}>
              {(options) => (
                <>
                  <Row
                    label={t("Color")}
                    options={[{ id: "white" as const, label: msg("White") }, { id: "black" as const, label: msg("Black") }]}
                    value={options().color}
                    onChange={(color) => change("flash", { color })}
                  />
                  <Row label={t("Length")} options={seconds([0.25, 0.5, 1])} value={options().length} onChange={(length) => change("flash", { length })} />
                </>
              )}
            </Match>

            <Match when={effect().kind === "blur" && (effect().options as EffectOptions["blur"])}>
              {(options) => (
                <>
                  <Row
                    label={t("Direction")}
                    options={[{ id: "in" as const, label: msg("Into focus") }, { id: "out" as const, label: msg("Out of focus") }]}
                    value={options().direction}
                    onChange={(direction) => change("blur", { direction })}
                  />
                  <Row label={t("Strength")} options={STRENGTHS} value={options().strength} onChange={(strength) => change("blur", { strength })} />
                  <Row label={t("Length")} options={seconds([0.5, 1, 2])} value={options().length} onChange={(length) => change("blur", { length })} />
                </>
              )}
            </Match>

            <Match when={effect().kind === "bars" && (effect().options as EffectOptions["bars"])}>
              {(options) => (
                <>
                  <Row
                    label={t("Size")}
                    options={[{ id: "subtle" as const, label: msg("Thin") }, { id: "medium" as const, label: msg("Medium") }, { id: "strong" as const, label: msg("Wide") }]}
                    value={options().size}
                    onChange={(size) => change("bars", { size })}
                  />
                  <Row
                    label={t("Length")}
                    options={[...seconds([3, 5]), { id: "scene" as const, label: msg("To the end") }]}
                    value={options().length}
                    onChange={(length) => change("bars", { length })}
                  />
                </>
              )}
            </Match>
          </Switch>

          <Show when={effect().kind === "slowMotion"}>
            <button
              type="button"
              class="mt-1 flex h-7 w-full min-w-0 items-center justify-center rounded-md bg-secondary px-2 text-xs text-secondary-foreground transition-colors hover:bg-secondary-hover focus-ring"
              onClick={() => removeEffect(world, effect())}
            >
              <span class="min-w-0 truncate">{t("Remove slow motion")}</span>
            </button>
          </Show>
        </PanelSection>
      )}
    </Show>
  );
}

function Row<T extends string | number>(props: { label: string; options: Option<T>[]; value: T; onChange: (value: T) => void }) {
  return (
    <ControlRow label={props.label}>
      <div
        class="grid gap-1"
        style={{ "grid-template-columns": `repeat(${props.options.length}, minmax(0, 1fr))` }}
        role="radiogroup"
        aria-label={props.label}
      >
        <For each={props.options}>
          {(option) => (
            <button
              type="button"
              role="radio"
              aria-checked={props.value === option.id}
              class="flex h-7 min-w-0 items-center justify-center truncate rounded-md px-1 text-xs tabular-nums transition-colors focus-ring"
              classList={{
                "bg-secondary text-foreground inset-ring-1 inset-ring-primary": props.value === option.id,
                "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground": props.value !== option.id,
              }}
              onClick={() => props.onChange(option.id)}
            >
              <span class="min-w-0 truncate">{t(option.label)}</span>
            </button>
          )}
        </For>
      </div>
    </ControlRow>
  );
}
