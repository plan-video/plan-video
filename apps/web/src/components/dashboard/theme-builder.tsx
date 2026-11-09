/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { colord } from "colord";
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { toast } from "somoto";

import { fieldControl } from "@/components/calendar/popup";
import { Icon } from "@/components/dashboard/dashboard-icon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider, SliderFill, SliderThumb, SliderTrack } from "@/components/ui/slider";
import { endThemePreview, previewTheme, saveTheme } from "@/lib/app-theme";
import { cx } from "@/lib/cva";
import { dashboardTheme, type DashboardTheme } from "@/lib/dashboard-theme";
import { msg, t } from "@/lib/i18n";
import {
  CLIP_KINDS,
  FONT_STACKS,
  THEME_FONTS,
  encodeThemeCode,
  resolvePalette,
  type ClipKind,
  type ThemeFont,
  type ThemeSpec,
} from "@/lib/theme-palette";

import { PageToggle } from "./page-toggle";
import { ThemeDashboardArt, ThemeEditorArt } from "./theme-art";

const ACCENTS = ["#2f6ff0", "#6d7dff", "#b24bd6", "#e23a62", "#ef6c1a", "#d9a406", "#1f9d5c", "#0ea5c6"];

const HUE_TRACK = `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((hue) => `oklch(0.72 0.14 ${hue})`).join(", ")})`;

const CLIP_LABELS: Record<ClipKind, string> = {
  video: msg("Video"),
  audio: msg("Audio"),
  text: msg("Text"),
  image: msg("Image"),
  caption: msg("Captions"),
  shape: msg("Shapes"),
};

const FONT_LABELS: Record<ThemeFont, string> = {
  default: msg("Default"),
  inter: "Inter",
  geist: "Geist",
  system: msg({ message: "System", context: "font" }),
  mono: "Mono",
};

const CLIP_DEFAULTS: Record<ClipKind, string> = {
  video: "#7aa7f7",
  audio: "#34d399",
  text: "#94a3b8",
  image: "#f59e0b",
  caption: "#e879b9",
  shape: "#f87171",
};

type Tab = "colors" | "style" | "editor";
type Surface = "dashboard" | "editor";

const TABS: { value: Tab; label: string }[] = [
  { value: "colors", label: msg("Colors") },
  { value: "style", label: msg("Style") },
  { value: "editor", label: msg("Video editor") },
];

const SURFACES: { value: Surface; label: string }[] = [
  { value: "dashboard", label: msg("Dashboard") },
  { value: "editor", label: msg("Editor") },
];

const MODES: { value: DashboardTheme; label: string }[] = [
  { value: "light", label: msg("Light") },
  { value: "dark", label: msg("Dark") },
];

function Group(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-3 px-4 py-4">
      <h3 class="text-xs font-medium text-(--plane-text-secondary)">{props.title}</h3>
      {props.children}
    </section>
  );
}

function SliderRow(props: {
  label: string;
  value: number;
  max?: number;
  display?: string;
  trackStyle?: JSX.CSSProperties;
  onChange(value: number): void;
}) {
  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between text-sm">
        <span class="text-(--plane-text-primary)">{props.label}</span>
        <span class="font-mono text-xs tabular-nums text-(--plane-text-tertiary)">{props.display ?? props.value}</span>
      </div>
      <Slider minValue={0} maxValue={props.max ?? 100} value={[props.value]} onChange={([next]: number[]) => props.onChange(next!)}>
        <SliderTrack class="h-1.5! bg-(--plane-layer-3)" style={props.trackStyle}>
          <Show when={!props.trackStyle}>
            <SliderFill />
          </Show>
          <SliderThumb aria-label={props.label} />
        </SliderTrack>
      </Slider>
    </div>
  );
}

function ColorPad(props: { value: string; onChange(hex: string): void }) {
  const initial = colord(props.value).toHsv();
  const [hue, setHue] = createSignal(initial.h);
  const [saturation, setSaturation] = createSignal(initial.s);
  const [brightness, setBrightness] = createSignal(initial.v);
  const [typed, setTyped] = createSignal(props.value);
  let dragging = false;

  const emit = () => {
    const hex = colord({ h: hue(), s: saturation(), v: brightness() }).toHex().slice(0, 7);
    setTyped(hex);
    props.onChange(hex);
  };

  const track = (event: PointerEvent) => {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setSaturation(Math.round(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * 100));
    setBrightness(Math.round((1 - Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))) * 100));
    emit();
  };

  const commitTyped = (text: string) => {
    setTyped(text);
    const hex = text.startsWith("#") ? text : `#${text}`;
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    const next = colord(hex).toHsv();
    setHue(next.h);
    setSaturation(next.s);
    setBrightness(next.v);
    props.onChange(hex.toLowerCase());
  };

  return (
    <div class="flex w-56 flex-col gap-3 p-3">
      <div
        class="relative h-32 cursor-crosshair touch-none overflow-hidden rounded-md"
        style={{ background: `linear-gradient(0deg, #000, transparent), linear-gradient(90deg, #fff, hsl(${hue()} 100% 50%))` }}
        onPointerDown={(event) => {
          dragging = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          track(event);
        }}
        onPointerMove={(event) => dragging && track(event)}
        onPointerUp={() => (dragging = false)}
        onPointerCancel={() => (dragging = false)}
      >
        <span
          class="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]"
          style={{ left: `${saturation()}%`, top: `${100 - brightness()}%` }}
        />
      </div>
      <Slider
        minValue={0}
        maxValue={360}
        value={[hue()]}
        onChange={([next]: number[]) => {
          setHue(next!);
          emit();
        }}
      >
        <SliderTrack class="h-1.5!" style={{ background: "linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}>
          <SliderThumb aria-label={t("Hue")} />
        </SliderTrack>
      </Slider>
      <input
        aria-label={t("Hex color")}
        class={cx(fieldControl, "font-mono select-text")}
        spellcheck={false}
        maxLength={7}
        value={typed()}
        onInput={(event) => commitTyped(event.currentTarget.value.trim())}
      />
    </div>
  );
}

function ColorField(props: { label: string; value: string | null; fallback: string; onChange(hex: string | null): void; resettable?: boolean }) {
  const shown = () => props.value ?? props.fallback;
  return (
    <Popover placement="bottom-start" gutter={6}>
      <PopoverTrigger
        as="button"
        type="button"
        class="flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-(--plane-border-subtle-1) bg-(--plane-layer-1) px-1.5 text-left text-sm outline-none press hover:bg-(--plane-layer-1-hover) focus-ring"
      >
        <span class="size-5 shrink-0 rounded-sm ring-1 ring-black/15 ring-inset" style={{ background: shown() }} />
        <span class="min-w-0 flex-1 truncate text-(--plane-text-primary)">{props.label}</span>
        <span class="font-mono text-xs text-(--plane-text-tertiary)">{props.value ? props.value.slice(1).toUpperCase() : t("Auto")}</span>
      </PopoverTrigger>
      {/* Not portalled: the modal builder hides whatever sits outside it from screen readers. */}
      <PopoverContent class="w-auto rounded-lg border-(--plane-border-strong) p-0">
        <ColorPad value={shown()} onChange={props.onChange} />
        <Show when={props.resettable && props.value}>
          <div class="border-t border-(--plane-border-subtle) p-1.5">
            <Button variant="ghost" class="w-full" onClick={() => props.onChange(null)}>
              {t("Use automatic color")}
            </Button>
          </div>
        </Show>
      </PopoverContent>
    </Popover>
  );
}

export function ThemeBuilder(props: { start: { id: string | null; name: string; spec: ThemeSpec }; onClose(): void }) {
  const [spec, setSpec] = createSignal<ThemeSpec>(props.start.spec);
  const [name, setName] = createSignal(props.start.name);
  const [tab, setTab] = createSignal<Tab>("colors");
  const [surface, setSurface] = createSignal<Surface>("dashboard");
  const [previewMode, setPreviewMode] = createSignal<DashboardTheme>(dashboardTheme());

  const update = (changes: Partial<ThemeSpec>) => setSpec((current) => ({ ...current, ...changes }));
  const setClip = (kind: ClipKind, color: string | null) =>
    setSpec((current) => {
      const clips = { ...current.clips };
      if (color) clips[kind] = color;
      else delete clips[kind];
      return { ...current, clips };
    });

  createEffect(() => previewTheme(spec()));
  onCleanup(endThemePreview);

  const palette = createMemo(() => resolvePalette(spec(), previewMode()));
  const changed = () => JSON.stringify(spec()) !== JSON.stringify(props.start.spec);

  const chooseTab = (next: Tab) => {
    setTab(next);
    if (next === "editor") setSurface("editor");
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(encodeThemeCode(name(), spec()));
      toast.success(t("Theme code copied"));
    } catch {
      toast.error(t("Couldn't copy the theme code"));
    }
  };

  const save = () => {
    saveTheme({ id: props.start.id, name: name().trim() || t("My theme"), spec: spec() });
    props.onClose();
  };

  return (
    <Dialog open preventScroll={false} onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogContent
          showCloseButton={false}
          onInteractOutside={(event: Event) => event.preventDefault()}
          class="flex h-[min(720px,92dvh)] w-[min(1080px,96vw)] max-w-none! flex-col gap-0 overflow-hidden rounded-xl border-(--plane-border-subtle-1) p-0 sm:max-w-none"
        >
          <header class="flex h-12 shrink-0 items-center gap-3 border-b border-(--plane-border-subtle) px-4 max-md:h-auto max-md:flex-wrap max-md:py-2">
            <DialogTitle class="shrink-0 text-sm font-medium text-(--plane-text-primary)">{t("Theme")}</DialogTitle>
            <input
              aria-label={t("Theme name")}
              class={cx(fieldControl, "max-w-56 select-text max-md:max-w-none max-md:flex-1")}
              placeholder={t("My theme")}
              maxLength={40}
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
            />
            <div class="ml-auto flex items-center gap-2 max-md:ml-0 max-md:w-full max-md:justify-end">
              <DropdownMenu placement="bottom-end">
                <DropdownMenuTrigger as={Button} variant="ghost" size="icon-square" aria-label={t("More options")} class="text-(--plane-text-secondary)">
                  <Icon name="more-three-dots-small-horizontal" class="size-6" />
                </DropdownMenuTrigger>
                <DropdownMenuContent class="w-44">
                  <DropdownMenuItem onSelect={() => void copyCode()}>{t("Copy theme code")}</DropdownMenuItem>
                  <DropdownMenuItem disabled={!changed()} onSelect={() => setSpec(props.start.spec)}>
                    {t("Reset")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="secondary" onClick={props.onClose}>
                {t("Cancel")}
              </Button>
              <Button onClick={save}>{t("Save")}</Button>
            </div>
          </header>

          <div class="flex min-h-0 flex-1 max-md:flex-col">
            <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 bg-(--plane-canvas) p-4 max-md:h-56 max-md:flex-none">
              <div class="flex items-center justify-between gap-2">
                <PageToggle label={t("Preview")} options={SURFACES} value={surface()} onChange={setSurface} />
                <PageToggle label={t("Mode")} options={MODES} value={previewMode()} onChange={setPreviewMode} />
              </div>
              <div class="grid min-h-0 flex-1 place-items-center">
                <Switch>
                  <Match when={surface() === "dashboard"}>
                    <ThemeDashboardArt palette={palette()} class="aspect-[16/10] max-h-full w-full rounded-lg ring-1 ring-(--plane-border-subtle-1)" />
                  </Match>
                  <Match when={surface() === "editor"}>
                    <ThemeEditorArt palette={palette()} class="aspect-[16/10] max-h-full w-full rounded-lg ring-1 ring-(--plane-border-subtle-1)" />
                  </Match>
                </Switch>
              </div>
            </div>

            <aside class="flex w-80 shrink-0 flex-col border-l border-(--plane-border-subtle) max-md:min-h-0 max-md:w-full max-md:flex-1 max-md:border-t max-md:border-l-0">
              <div class="flex shrink-0 justify-center border-b border-(--plane-border-subtle) p-2.5 [&>div]:w-full [&>div>button]:flex-auto [&>div>button]:whitespace-nowrap">
                <PageToggle label={t("Theme settings")} options={TABS} value={tab()} onChange={chooseTab} />
              </div>
              <div class="min-h-0 flex-1 divide-y divide-(--plane-border-subtle) overflow-y-auto">
                <Switch>
                  <Match when={tab() === "colors"}>
                    <Group title={t("Accent")}>
                      <div class="grid grid-cols-8 gap-1.5">
                        <For each={ACCENTS}>
                          {(color) => (
                            <button
                              type="button"
                              aria-label={color}
                              aria-pressed={spec().accent === color}
                              class={cx(
                                "aspect-square rounded-md outline-none focus-ring",
                                spec().accent === color && "ring-2 ring-(--plane-text-primary) ring-offset-2 ring-offset-(--plane-surface-1)",
                              )}
                              style={{ background: color }}
                              onClick={() => update({ accent: color })}
                            />
                          )}
                        </For>
                      </div>
                      <ColorField label={t("Custom color")} value={spec().accent} fallback={spec().accent} onChange={(accent) => accent && update({ accent })} />
                    </Group>
                    <Group title={t("Background")}>
                      <SliderRow label={t("Hue")} value={spec().hue} max={360} display={`${spec().hue}°`} trackStyle={{ background: HUE_TRACK }} onChange={(hue) => update({ hue })} />
                      <SliderRow label={t("Tint")} value={spec().tint} onChange={(tint) => update({ tint })} />
                      <SliderRow label={t("Brightness")} value={spec().brightness} onChange={(brightness) => update({ brightness })} />
                    </Group>
                    <Group title={t("Contrast")}>
                      <SliderRow label={t("Layers")} value={spec().layers} onChange={(layers) => update({ layers })} />
                      <SliderRow label={t("Borders")} value={spec().borders} onChange={(borders) => update({ borders })} />
                      <SliderRow label={t("Text")} value={spec().text} onChange={(text) => update({ text })} />
                    </Group>
                  </Match>

                  <Match when={tab() === "style"}>
                    <Group title={t("Corners")}>
                      <SliderRow label={t("Roundness")} value={spec().corners} onChange={(corners) => update({ corners })} />
                    </Group>
                    <Group title={t("Font")}>
                      <div class="grid grid-cols-5 gap-1.5">
                        <For each={THEME_FONTS}>
                          {(font) => (
                            <button
                              type="button"
                              aria-pressed={spec().font === font}
                              class={cx(
                                "flex h-16 flex-col items-center justify-center gap-1 rounded-md border bg-(--plane-layer-1) outline-none press hover:bg-(--plane-layer-1-hover) focus-ring",
                                spec().font === font ? "border-(--plane-accent-primary)" : "border-(--plane-border-subtle-1)",
                              )}
                              onClick={() => update({ font })}
                            >
                              <span class="text-lg text-(--plane-text-primary)" style={{ "font-family": font === "default" ? undefined : FONT_STACKS[font] }}>
                                Ag
                              </span>
                              <span class="max-w-full truncate px-0.5 text-xs text-(--plane-text-secondary)">{t(FONT_LABELS[font])}</span>
                            </button>
                          )}
                        </For>
                      </div>
                    </Group>
                  </Match>

                  <Match when={tab() === "editor"}>
                    <Group title={t("Timeline")}>
                      <ColorField label={t("Playhead")} value={spec().playhead} fallback={spec().accent} resettable onChange={(playhead) => update({ playhead })} />
                    </Group>
                    <Group title={t("Clips")}>
                      <div class="grid grid-cols-2 gap-1.5">
                        <For each={CLIP_KINDS}>
                          {(kind) => (
                            <ColorField label={t(CLIP_LABELS[kind])} value={spec().clips[kind] ?? null} fallback={CLIP_DEFAULTS[kind]} resettable onChange={(color) => setClip(kind, color)} />
                          )}
                        </For>
                      </div>
                    </Group>
                  </Match>
                </Switch>
              </div>
            </aside>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
