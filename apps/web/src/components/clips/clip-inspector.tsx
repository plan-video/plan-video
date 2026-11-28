/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Match, Show, Switch, createMemo, createSignal, onMount, type JSX } from "solid-js";

import { getTextLook, type TextLook } from "@plan.video/runtime";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { Field, FieldGroup, Segmented, SwitchRow, fieldControl, fieldControlBase } from "@/components/publish/controls";
import { Button } from "@/components/ui/button";
import { SliderRow } from "@/components/ui/slider-row";
import { CAPTION_COLORS, CLIP_CAPTION_STYLES, captionStyle, clock, readClock, trimmed, type ClipCaptionStyle, type ClipEdit } from "@/lib/clip-studio";
import { cx } from "@/lib/cva";
import { msg, t } from "@/lib/i18n";
import { captionsPlace, postLayout } from "@/lib/post-builder";
import { CROP_COLORS, LAYOUT_HEIGHT, LAYOUT_WIDTH, STREAM_LAYOUTS, thumbnailSlots, type Box, type CropId } from "@/lib/stream-layouts";

import { useFont } from "./clip-canvas";
import { CropEditor } from "./crop-editor";

import type { TranscriptWord } from "@plan.video/assets";

export type InspectorTab = "layout" | "captions" | "hook" | "post";

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "layout", label: msg("Layout") },
  { id: "captions", label: msg("Captions") },
  { id: "hook", label: msg("Hook") },
  { id: "post", label: msg("Post") },
];

type InspectorProps = {
  clip: ClipEdit;
  update(change: (clip: ClipEdit) => void): void;
  source: HTMLVideoElement | null;
  frame: number;
  finding: boolean;
  onFindFacecam(): void;
};

const [tab, setTab] = createSignal<InspectorTab>("layout");

export function ClipInspector(props: InspectorProps) {
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-(--plane-border-subtle) p-3">
        <Segmented options={TABS.map((entry) => ({ id: entry.id, label: t(entry.label) }))} value={tab()} onChange={setTab} label={t("Edit")} />
      </div>
      <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 pb-20">
        <Switch>
          <Match when={tab() === "layout"}>
            <LayoutTab {...props} />
          </Match>
          <Match when={tab() === "captions"}>
            <CaptionsTab {...props} />
          </Match>
          <Match when={tab() === "hook"}>
            <HookTab {...props} />
          </Match>
          <Match when={tab() === "post"}>
            <PostTab {...props} />
          </Match>
        </Switch>
      </div>
    </div>
  );
}

/** A small 9:16 drawing of a layout's slots, in each crop's colour. */
function LayoutThumb(props: { id: string }) {
  const layout = () => STREAM_LAYOUTS.find((entry) => entry.id === props.id)!;
  return (
    <svg viewBox={`0 0 ${LAYOUT_WIDTH} ${LAYOUT_HEIGHT}`} class="h-16 w-9 overflow-hidden rounded bg-(--plane-layer-2)" aria-hidden="true">
      <For each={thumbnailSlots(layout())}>
        {(slot) => (
          <rect
            x={slot.box.x}
            y={slot.box.y}
            width={slot.box.width}
            height={slot.box.height}
            rx={slot.radius ?? 0}
            fill={CROP_COLORS[slot.crop]}
            fill-opacity={slot.blur ? 0.18 : 0.55}
            stroke={slot.blur ? "none" : "rgba(0,0,0,0.35)"}
            stroke-width={8}
          />
        )}
      </For>
    </svg>
  );
}

function LayoutTab(props: InspectorProps) {
  const setCrop = (id: CropId, box: Box) =>
    props.update((clip) => {
      clip.crops = { ...clip.crops, [id]: box };
    });
  return (
    <>
      <FieldGroup label={t("Layout")}>
        <div class="grid grid-cols-3 gap-2">
          <For each={STREAM_LAYOUTS}>
            {(layout) => (
              <button
                type="button"
                aria-pressed={props.clip.layout === layout.id}
                class="flex flex-col items-center gap-1.5 rounded-lg p-2 text-xs outline-none press focus-ring"
                classList={{
                  "bg-(--plane-layer-2) text-foreground ring-2 ring-primary": props.clip.layout === layout.id,
                  "text-muted-foreground hover:bg-(--plane-layer-1) hover:text-foreground": props.clip.layout !== layout.id,
                }}
                onClick={() =>
                  props.update((clip) => {
                    clip.layout = layout.id;
                  })
                }
              >
                <LayoutThumb id={layout.id} />
                <span class="w-full truncate text-center">{t(layout.label)}</span>
              </button>
            )}
          </For>
        </div>
      </FieldGroup>
      <FieldGroup
        label={t("Crops")}
        hint={t("Drag a box to move it, or a corner to resize it. Arrow keys move a box a little.")}
        trailing={
          <span class="flex items-center gap-1">
            <Button variant="ghost" size="small" class="h-6 px-1.5 text-xs" disabled={props.finding} onClick={props.onFindFacecam}>
              <Show when={props.finding} fallback={t("Find facecam")}>
                {t("Looking…")}
              </Show>
            </Button>
            <Button
              variant="ghost"
              size="small"
              class="h-6 px-1.5 text-xs"
              onClick={() =>
                props.update((clip) => {
                  clip.crops = {};
                })
              }
            >
              {t("Reset")}
            </Button>
          </span>
        }
      >
        <CropEditor layout={props.clip.layout} crops={props.clip.crops} source={props.source} frame={props.frame} onChange={setCrop} />
      </FieldGroup>
    </>
  );
}

const STYLE_SIZE = 17;

function lookOf(style: ClipCaptionStyle): TextLook | null {
  return (style.look && getTextLook(style.look)) || null;
}

/** The look in CSS, close enough to choose by. */
function tileStyle(look: TextLook | null): JSX.CSSProperties {
  if (!look) return { "font-family": "Montserrat", "font-weight": "500", color: "#FFFFFF", "font-size": `${STYLE_SIZE - 3}px` };
  const stroke = look.strokes?.[0];
  const shadow = look.shadows?.[0];
  return {
    "font-family": `"${look.font}"`,
    "font-weight": String(look.weight),
    "font-style": look.italic ? "italic" : "normal",
    "text-transform": look.textCase === "upper" ? "uppercase" : "none",
    color: typeof look.fill === "string" ? look.fill : look.fill.from,
    "font-size": `${STYLE_SIZE * look.size}px`,
    "-webkit-text-stroke": stroke ? `${stroke.width * STYLE_SIZE}px ${stroke.color}` : undefined,
    "paint-order": "stroke fill",
    "text-shadow": shadow ? `${(shadow.x ?? 0) * STYLE_SIZE}px ${(shadow.y ?? 0) * STYLE_SIZE}px ${shadow.blur * STYLE_SIZE}px rgba(0,0,0,${shadow.opacity ?? 1})` : undefined,
  };
}

function StyleTile(props: { style: ClipCaptionStyle; active: boolean; onPick(): void }) {
  const look = () => lookOf(props.style);
  const accent = () => props.style.colors?.[0] ?? "#FFE14D";
  const words = () => [t("Best"), t("clip")];
  return (
    <button
      type="button"
      aria-pressed={props.active}
      class="flex flex-col gap-1.5 rounded-lg p-1.5 text-left text-xs outline-none press focus-ring"
      classList={{ "ring-2 ring-primary": props.active, "hover:bg-(--plane-layer-1)": !props.active }}
      onClick={props.onPick}
    >
      <span class="grid h-14 w-full place-items-center overflow-hidden rounded-md bg-[linear-gradient(160deg,#3b4252,#1c1d1f)]">
        <span class="flex items-center gap-1 leading-none" style={tileStyle(look())}>
          <span>{words()[0]}</span>
          <span
            class="rounded px-0.5"
            style={{
              ...(props.style.preset === "spotlight" ? { color: accent() } : {}),
              ...(props.style.preset === "box" ? { "background-color": accent() } : {}),
            }}
          >
            {words()[1]}
          </span>
        </span>
      </span>
      <span class={cx("px-0.5", props.active ? "text-foreground" : "text-muted-foreground")}>{t(props.style.label)}</span>
    </button>
  );
}

type Line = { from: number; to: number; text: string };

/** The clip's words as caption lines, with where each sits in the clip's word list. */
function linesOf(clip: ClipEdit): Line[] {
  const lines: Line[] = [];
  let from = -1;
  const flush = (to: number) => {
    if (from < 0) return;
    lines.push({ from, to, text: clip.words.slice(from, to + 1).map((word) => word.text).join(" ") });
    from = -1;
  };
  clip.words.forEach((word, index) => {
    const inside = word.end > clip.start + 0.05 && word.start < clip.end - 0.05;
    if (!inside) {
      flush(index - 1);
      return;
    }
    const previous = clip.words[index - 1];
    if (from >= 0 && previous && (word.start - previous.end > 0.45 || index - from >= 10)) flush(index - 1);
    if (from < 0) from = index;
    if (/[.!?]$/.test(word.text)) flush(index);
  });
  flush(clip.words.length - 1);
  return lines;
}

/** New words over the same stretch: same count keeps each one's time, otherwise they share it by length. */
function rewords(old: TranscriptWord[], text: string): TranscriptWord[] {
  const next = text.trim().split(/\s+/).filter(Boolean);
  if (!next.length) return [];
  if (next.length === old.length) return old.map((word, index) => ({ ...word, text: next[index]! }));
  const start = old[0]!.start;
  const end = old[old.length - 1]!.end;
  const total = next.reduce((sum, word) => sum + word.length + 1, 0);
  let at = start;
  return next.map((word) => {
    const length = ((word.length + 1) / total) * (end - start);
    const out = { text: word, start: Math.round(at * 1000) / 1000, end: Math.round((at + length * 0.92) * 1000) / 1000 };
    at += length;
    return out;
  });
}

function CaptionsTab(props: InspectorProps) {
  onMount(() => {
    for (const style of CLIP_CAPTION_STYLES) {
      const look = lookOf(style);
      if (look) useFont(look, () => {});
    }
  });
  const style = () => captionStyle(props.clip.captions.style);
  const lines = createMemo(() => linesOf(props.clip));
  const autoY = () => {
    const { slots } = postLayout(props.clip.layout, { width: props.source?.videoWidth || 1920, height: props.source?.videoHeight || 1080 }, props.clip.crops);
    return captionsPlace(slots);
  };
  return (
    <>
      <SwitchRow
        label={t("Captions")}
        description={props.clip.heard ? undefined : t("Written from the speech when the clip is made.")}
        checked={props.clip.captions.on}
        onChange={(on) =>
          props.update((clip) => {
            clip.captions.on = on;
          })
        }
      />
      <Show when={props.clip.captions.on}>
        <FieldGroup label={t("Style")}>
          <div class="grid grid-cols-2 gap-1.5">
            <For each={CLIP_CAPTION_STYLES}>
              {(entry) => (
                <StyleTile
                  style={entry}
                  active={style().id === entry.id}
                  onPick={() =>
                    props.update((clip) => {
                      clip.captions.style = entry.id;
                      clip.captions.size = entry.size;
                      clip.captions.words = entry.words;
                    })
                  }
                />
              )}
            </For>
          </div>
        </FieldGroup>
        <SliderRow
          label={t("Size")}
          value={props.clip.captions.size}
          min={30}
          max={160}
          values={<span class="text-xs tabular-nums text-foreground">{props.clip.captions.size}</span>}
          onChange={(value) =>
            props.update((clip) => {
              clip.captions.size = Math.round(value);
            })
          }
        />
        <FieldGroup label={t("Words at once")}>
          <Segmented
            options={["1", "2", "3", "4", "6"].map((id) => ({ id, label: id }))}
            value={String(props.clip.captions.words)}
            onChange={(value) =>
              props.update((clip) => {
                clip.captions.words = Number(value);
              })
            }
          />
        </FieldGroup>
        <SliderRow
          label={t("Position")}
          value={Math.round((props.clip.captions.y ?? autoY()) * 100)}
          min={5}
          max={95}
          values={
            <Show
              when={props.clip.captions.y !== null}
              fallback={<span class="text-xs text-foreground">{t("Auto")}</span>}
            >
              <button
                type="button"
                class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() =>
                  props.update((clip) => {
                    clip.captions.y = null;
                  })
                }
              >
                {t("Auto")}
              </button>
            </Show>
          }
          onChange={(value) =>
            props.update((clip) => {
              clip.captions.y = value / 100;
            })
          }
        />
        <FieldGroup label={t("Color")}>
          <div class="grid grid-cols-7 gap-1.5">
            <button
              type="button"
              aria-pressed={props.clip.captions.color === null}
              class="grid h-7 place-items-center rounded-md text-xs outline-none press focus-ring"
              classList={{ "bg-(--plane-layer-2) text-foreground ring-2 ring-primary": props.clip.captions.color === null, "bg-(--plane-layer-1) text-muted-foreground hover:text-foreground": props.clip.captions.color !== null }}
              onClick={() =>
                props.update((clip) => {
                  clip.captions.color = null;
                })
              }
            >
              {t("Auto")}
            </button>
            <For each={CAPTION_COLORS}>
              {(color) => (
                <button
                  type="button"
                  aria-label={color}
                  aria-pressed={props.clip.captions.color === color}
                  class="h-7 rounded-md outline-none ring-offset-2 ring-offset-(--plane-surface-1) focus-ring"
                  classList={{ "ring-2 ring-primary": props.clip.captions.color === color }}
                  style={{ "background-color": color, "box-shadow": "inset 0 0 0 1px rgba(0,0,0,0.25)" }}
                  onClick={() =>
                    props.update((clip) => {
                      clip.captions.color = color;
                    })
                  }
                />
              )}
            </For>
          </div>
        </FieldGroup>
        <Show when={props.clip.heard}>
          <FieldGroup label={t("Words")} hint={t("Fix a word and its timing stays. Clear a line to drop it.")}>
            <Show when={lines().length} fallback={<p class="text-xs text-muted-foreground">{t("Nothing is said in this part.")}</p>}>
              <div class="flex flex-col gap-1">
                <For each={lines()}>
                  {(line) => (
                    <div class="flex items-center gap-2">
                      <span class="w-10 shrink-0 text-xxs tabular-nums text-(--plane-text-placeholder)">
                        {clock(Math.max(0, (props.clip.words[line.from]?.start ?? 0) - props.clip.start))}
                      </span>
                      <input
                        class={cx(fieldControl, "min-w-0 flex-1")}
                        value={line.text}
                        aria-label={t("Caption line")}
                        onChange={(event) => {
                          const text = event.currentTarget.value;
                          props.update((clip) => {
                            const old = clip.words.slice(line.from, line.to + 1);
                            clip.words = [...clip.words.slice(0, line.from), ...rewords(old, text), ...clip.words.slice(line.to + 1)];
                          });
                        }}
                      />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </FieldGroup>
        </Show>
      </Show>
    </>
  );
}

function HookTab(props: InspectorProps) {
  return (
    <>
      <SwitchRow
        label={t("Hook")}
        description={t("A big line over the first seconds, to stop the scroll.")}
        checked={props.clip.hook.on}
        onChange={(on) =>
          props.update((clip) => {
            clip.hook.on = on;
          })
        }
      />
      <Show when={props.clip.hook.on}>
        <Field label={t("Text")} trailing={<span class="tabular-nums">{props.clip.hook.text.length}/80</span>}>
          <textarea
            class={cx(fieldControlBase, "min-h-16 resize-none py-1.5")}
            maxLength={80}
            value={props.clip.hook.text}
            onInput={(event) => {
              const text = event.currentTarget.value;
              props.update((clip) => {
                clip.hook.text = text;
              });
            }}
          />
        </Field>
        <SliderRow
          label={t("On screen for")}
          value={props.clip.hook.seconds}
          min={1}
          max={8}
          step={0.1}
          values={<span class="text-xs tabular-nums text-foreground">{t("{seconds} s", { seconds: props.clip.hook.seconds.toFixed(1) })}</span>}
          onChange={(value) =>
            props.update((clip) => {
              clip.hook.seconds = Math.round(value * 10) / 10;
            })
          }
        />
        <SliderRow
          label={t("Size")}
          value={props.clip.hook.size}
          min={40}
          max={150}
          values={<span class="text-xs tabular-nums text-foreground">{props.clip.hook.size}</span>}
          onChange={(value) =>
            props.update((clip) => {
              clip.hook.size = Math.round(value);
            })
          }
        />
        <SliderRow
          label={t("Position")}
          value={Math.round(props.clip.hook.y * 100)}
          min={5}
          max={95}
          values={<span class="text-xs tabular-nums text-foreground">{Math.round(props.clip.hook.y * 100)}%</span>}
          onChange={(value) =>
            props.update((clip) => {
              clip.hook.y = value / 100;
            })
          }
        />
      </Show>
    </>
  );
}

function TimeField(props: { label: string; value: number; onCommit(seconds: number): void }) {
  return (
    <Field label={props.label}>
      <input
        class={cx(fieldControl, "tabular-nums")}
        value={clock(props.value, true)}
        onChange={(event) => {
          const seconds = readClock(event.currentTarget.value);
          if (seconds === null) event.currentTarget.value = clock(props.value, true);
          else props.onCommit(seconds);
        }}
      />
    </Field>
  );
}

function PostTab(props: InspectorProps) {
  const trim = (start: number, end: number) =>
    props.update((clip) => {
      const next = trimmed(clip, start, end);
      clip.start = next.start;
      clip.end = next.end;
    });
  return (
    <>
      <Field label={t("Title")} trailing={<span class="tabular-nums">{props.clip.title.length}/100</span>}>
        <input
          class={fieldControl}
          maxLength={100}
          value={props.clip.title}
          onInput={(event) => {
            const text = event.currentTarget.value;
            props.update((clip) => {
              clip.title = text;
            });
          }}
        />
      </Field>
      <Field label={t("Caption")} trailing={<span class="tabular-nums">{props.clip.caption.length}</span>}>
        <textarea
          class={cx(fieldControlBase, "min-h-24 resize-y py-1.5")}
          value={props.clip.caption}
          onInput={(event) => {
            const text = event.currentTarget.value;
            props.update((clip) => {
              clip.caption = text;
            });
          }}
        />
      </Field>
      <div class="grid grid-cols-2 gap-2">
        <TimeField label={t("Starts at")} value={props.clip.start} onCommit={(seconds) => trim(seconds, props.clip.end)} />
        <TimeField label={t("Ends at")} value={props.clip.end} onCommit={(seconds) => trim(props.clip.start, seconds)} />
      </div>
      <p class="text-xs text-muted-foreground">
        {t("Can run from {from} to {to} in the stream.", { from: clock(props.clip.range.start), to: clock(props.clip.range.end) })}
      </p>
      <Show when={props.clip.reason}>
        <FieldGroup label={t("Why it was picked")}>
          <p class="flex items-start gap-2 text-xs text-foreground">
            <Show when={props.clip.score !== null}>
              <span class="shrink-0 rounded bg-(--plane-layer-2) px-1.5 py-0.5 tabular-nums text-muted-foreground">{t("Virality {score}", { score: props.clip.score ?? 0 })}</span>
            </Show>
            <span>{props.clip.reason}</span>
          </p>
        </FieldGroup>
      </Show>
      <Show when={props.clip.from === "added"}>
        <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="scissors" class="size-4" />
          {t("You added this clip.")}
        </p>
      </Show>
    </>
  );
}
