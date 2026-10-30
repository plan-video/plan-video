/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";

import { Icon } from "@/components/ui/icon";
import { Kbd } from "@/components/ui/kbd";
import { cx } from "@/lib/cva";
import { msg, t } from "@/lib/i18n";
import { formatBytes } from "@/lib/social-media";

import type { Cutout, CutoutProgress } from "@/lib/background-removal";

export type CutoutMode = "compare" | "result" | "original";

const MODES: { id: CutoutMode; label: string }[] = [
  { id: "compare", label: msg("Compare") },
  { id: "result", label: msg("Result") },
  { id: "original", label: msg("Original") },
];

// bg0's progress messages, marked for translating; any other message is shown as it came.
export const BG0_PROGRESS_MESSAGES = [
  msg("Preparing image…"),
  msg("Loading cached model…"),
  msg("Downloading local model…"),
  msg("Removing background…"),
  msg("Retrying background removal…"),
  msg("Switching to compatibility mode…"),
  msg("Preparing compatibility mode…"),
  msg("Finishing edges…"),
  msg("Background removed"),
];

const STEP = 5;

export const CHECKERBOARD: JSX.CSSProperties = {
  "background-color": "var(--background)",
  "background-image":
    "conic-gradient(color-mix(in srgb, var(--foreground) 7%, transparent) 25%, transparent 0 50%, color-mix(in srgb, var(--foreground) 7%, transparent) 0 75%, transparent 0)",
  "background-size": "20px 20px",
};

export function typingInto(event: Event): boolean {
  const target = event.target;
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, select, [role=menu], [role=listbox]"));
}

export function CutoutStage(props: {
  original: string;
  result?: string | null;
  progress?: CutoutProgress | null;
  mode: CutoutMode;
  class?: string;
  compact?: boolean;
  keys?: boolean;
  children?: JSX.Element;
}) {
  let stage: HTMLDivElement | undefined;
  let sweep: HTMLDivElement | undefined;
  const [position, setPosition] = createSignal(50);
  const [peeking, setPeeking] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  let reveal = 0;

  const comparing = () => !!props.result && props.mode === "compare" && !peeking();
  const clamp = (value: number) => Math.min(100, Math.max(0, value));

  const stopReveal = () => {
    cancelAnimationFrame(reveal);
    reveal = 0;
  };

  createEffect(
    on(
      () => props.result,
      (result) => {
        stopReveal();
        if (!result) return setPosition(50);
        const started = performance.now();
        const frame = (now: number) => {
          const at = Math.min(1, (now - started) / 900);
          setPosition(100 - 50 * (1 - (1 - at) ** 3));
          reveal = at < 1 ? requestAnimationFrame(frame) : 0;
        };
        setPosition(100);
        reveal = requestAnimationFrame(frame);
      },
    ),
  );

  createEffect(() => {
    if (!props.progress || !sweep) return;
    const animation = sweep.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(100%)" }], {
      duration: 1800,
      iterations: Infinity,
      easing: "ease-in-out",
    });
    onCleanup(() => animation.cancel());
  });

  const moveTo = (event: PointerEvent) => {
    const box = stage!.getBoundingClientRect();
    setPosition(clamp(((event.clientX - box.left) / box.width) * 100));
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!comparing() || event.button !== 0) return;
    event.preventDefault();
    stopReveal();
    setDragging(true);
    stage!.setPointerCapture(event.pointerId);
    moveTo(event);
  };

  onCleanup(stopReveal);

  onMount(() => {
    if (props.keys === false) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!props.result || event.metaKey || event.ctrlKey || event.altKey || typingInto(event)) return;
      if (event.key === " ") {
        if (!event.repeat) setPeeking(true);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (props.mode !== "compare") return;
        stopReveal();
        const by = (event.shiftKey ? STEP * 4 : STEP) * (event.key === "ArrowLeft" ? -1 : 1);
        setPosition((current) => clamp(Math.round((current + by) / STEP) * STEP));
      } else return;
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") setPeeking(false);
    };
    const onBlur = () => setPeeking(false);
    // Capture, so a host that keeps keys from the page behind it (the editor's dialog) still lets these through.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    });
  });

  const percent = () => Math.round((props.progress?.progress ?? 0) * 100);
  const layer = () =>
    cx("pointer-events-none absolute inset-0 size-full object-contain transition-opacity duration-200", props.compact ? "p-3" : "p-6");
  const edge = () => (props.compact ? "2" : "3");

  return (
    <div
      ref={stage}
      class={cx(
        "relative isolate touch-none select-none overflow-hidden border",
        props.compact ? "rounded-lg border-border" : "rounded-xl border-border-strong",
        props.class,
      )}
      classList={{ "cursor-ew-resize": comparing() }}
      style={CHECKERBOARD}
      onPointerDown={onPointerDown}
      onPointerMove={(event) => dragging() && moveTo(event)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      <Show when={props.result}>
        {(result) => (
          <img
            src={result()}
            alt=""
            data-layer="cutout"
            draggable={false}
            class={layer()}
            classList={{ "opacity-0": props.mode === "original" || peeking() }}
          />
        )}
      </Show>
      <img
        src={props.original}
        alt=""
        data-layer="original"
        draggable={false}
        class={layer()}
        classList={{ "opacity-0": !!props.result && props.mode === "result" && !peeking() }}
        style={{ "clip-path": comparing() ? `inset(0 ${100 - position()}% 0 0)` : undefined }}
      />

      <Show when={comparing()}>
        <div class="pointer-events-none absolute inset-y-0 -ml-px w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]" style={{ left: `${position()}%` }}>
          <span
            role="slider"
            tabIndex={-1}
            aria-label={t("Before and after")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(position())}
            class="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.2),0_4px_12px_rgba(0,0,0,0.18)] transition-transform"
            classList={{ "scale-110": dragging(), "size-8": !props.compact, "size-6": props.compact }}
          >
            <svg viewBox="0 0 16 16" class={props.compact ? "size-3.5" : "size-4"} fill="none" aria-hidden="true">
              <path d="M6 4.5 2.5 8 6 11.5M10 4.5 13.5 8 10 11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
        </div>
        <StageLabel edge={edge()} side="left">{t("Before")}</StageLabel>
        <StageLabel edge={edge()} side="right">{t("After")}</StageLabel>
      </Show>
      <Show when={peeking() && props.result}>
        <StageLabel edge={edge()} side="left">{t("Original")}</StageLabel>
      </Show>

      <Show when={props.progress}>
        {(progress) => (
          <>
            <div class="pointer-events-none absolute inset-0 overflow-hidden">
              <div ref={sweep} class="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            </div>
            <div class="absolute inset-x-0 top-0 h-0.5 bg-primary/15">
              <div class="h-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${percent()}%` }} />
            </div>
            <div
              class="absolute left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-black/75 pl-2 pr-3 font-mono text-xxs text-white backdrop-blur-sm animate-in fade-in-0 slide-in-from-bottom-1"
              classList={{ "bottom-4 h-7": !props.compact, "bottom-2.5 h-6": props.compact }}
            >
              <Icon name="spinner-loader" class="size-4 shrink-0 animate-spin" />
              <span class="min-w-0 truncate">{t(progress().message)}</span>
              <span class="tabular-nums text-white/60">{percent()}%</span>
            </div>
          </>
        )}
      </Show>

      {props.children}
    </div>
  );
}

function StageLabel(props: { edge: "2" | "3"; side: "left" | "right"; children: string }) {
  return (
    <span
      class="pointer-events-none absolute rounded-[5px] bg-black/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white backdrop-blur-sm"
      classList={{
        "top-2": props.edge === "2",
        "top-3": props.edge === "3",
        "left-2": props.edge === "2" && props.side === "left",
        "left-3": props.edge === "3" && props.side === "left",
        "right-2": props.edge === "2" && props.side === "right",
        "right-3": props.edge === "3" && props.side === "right",
      }}
    >
      {props.children}
    </span>
  );
}

export function CutoutTabs(props: { mode: CutoutMode; disabled?: boolean; class?: string; onChange(mode: CutoutMode): void }) {
  return (
    <div class={cx("flex h-7 items-center rounded-md bg-input p-0.5", props.class)} role="tablist" aria-label={t("View")}>
      <For each={MODES}>
        {(option) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.mode === option.id}
            disabled={props.disabled}
            class="h-6 rounded-[5px] px-2.5 text-xs transition-colors focus-ring disabled:opacity-50"
            classList={{
              "bg-background text-foreground shadow-[0_0_0_1px_var(--border-strong)]": props.mode === option.id,
              "text-muted-foreground hover:text-foreground": props.mode !== option.id,
            }}
            onClick={() => props.onChange(option.id)}
          >
            {t(option.label)}
          </button>
        )}
      </For>
    </div>
  );
}

export function CutoutMeta(props: { cutout: Cutout }) {
  return (
    <span class="flex items-center gap-1.5 whitespace-nowrap font-mono text-xxs text-muted-foreground tabular-nums">
      <span class="size-1.5 rounded-full" classList={{ "bg-emerald-400": props.cutout.provider === "webgpu", "bg-amber-400": props.cutout.provider !== "webgpu" }} />
      <span title={props.cutout.provider === "webgpu" ? t("Ran on the GPU") : t("Ran on the CPU (WebAssembly)")}>
        {props.cutout.provider === "webgpu" ? "WebGPU" : "CPU"}
      </span>
      · {(props.cutout.durationMs / 1000).toFixed(1)}s · {props.cutout.width}×{props.cutout.height}
    </span>
  );
}

export function KeyHint(props: { keys: string[]; children: string }) {
  return (
    <span class="flex items-center gap-1.5 text-xxs text-muted-foreground">
      <span class="flex items-center gap-0.5">
        <For each={props.keys}>{(key) => <Kbd class="h-[18px] min-w-[18px] text-xxs">{key}</Kbd>}</For>
      </span>
      {props.children}
    </span>
  );
}

export const pngSize = (blob: Blob | null | undefined): string => (blob ? formatBytes(blob.size) : "");
