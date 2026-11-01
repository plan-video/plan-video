/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createResource, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { toast } from "somoto";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import {
  SHAPES,
  dragCrop,
  flipEdit,
  isUntouched,
  loadPicture,
  outputSize,
  pixelCrop,
  renderPicture,
  shapeRatio,
  startEdit,
  turnEdit,
  turnedSize,
  withShape,
  type Handle,
  type PictureEdit,
  type Rect,
  type ShapeId,
} from "@/lib/picture-edit";
import { MEDIA_LIMITS } from "@/lib/social-media";

/** Room around the picture, so a handle on its edge can still be grabbed. */
const GUTTER = 44;
/** On screen: smaller and the handles cover the crop. */
const MIN_CROP_PX = 48;

const CURSORS: Record<Handle, string> = {
  move: "move",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

const toolButton =
  "grid size-10 place-items-center rounded-xl text-white/70 press transition-colors hover:bg-white/6 hover:text-white focus-ring";

export function PictureEditor(props: {
  /** The picture as it was before any edit, so an earlier crop can be widened again. */
  file: File;
  edit?: PictureEdit | null;
  suggest?: ShapeId;
  saveLabel?: string;
  /** `edit` is null when the picture is back to how it was. */
  onSave(file: File, edit: PictureEdit | null): Promise<void> | void;
  onClose(): void;
}) {
  const url = URL.createObjectURL(props.file);
  onCleanup(() => URL.revokeObjectURL(url));
  const [picture] = createResource(() => loadPicture(url));
  const natural = () => {
    const image = picture();
    return image ? { width: image.naturalWidth, height: image.naturalHeight } : null;
  };

  const [chosen, setEdit] = createSignal<PictureEdit | null>(null);
  const edit = createMemo(() => {
    const size = natural();
    return size ? (chosen() ?? props.edit ?? startEdit(size, props.suggest)) : null;
  });
  const [stage, setStage] = createSignal({ width: 0, height: 0 });
  const [dragging, setDragging] = createSignal<Handle | null>(null);
  const [saving, setSaving] = createSignal(false);
  let stageEl: HTMLDivElement | undefined;
  let frameEl: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;

  onMount(() => {
    if (!stageEl) return;
    const observer = new ResizeObserver(([entry]) => entry && setStage({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(stageEl);
    onCleanup(() => observer.disconnect());
  });

  const size = () => {
    const current = edit();
    const base = natural();
    return current && base ? turnedSize(base, current.turns) : null;
  };
  const scale = createMemo(() => {
    const box = size();
    if (!box) return 0;
    return Math.max(0, Math.min((stage().width - GUTTER * 2) / box.width, (stage().height - GUTTER * 2) / box.height));
  });
  const ratio = () => {
    const current = edit();
    const box = size();
    return current && box ? shapeRatio(current.shape, box) : null;
  };
  const out = () => {
    const current = edit();
    const box = size();
    return current && box ? outputSize(pixelCrop(current.crop, box)) : null;
  };
  const changed = () => {
    const current = edit();
    const base = natural();
    return !!current && !!base && !isUntouched(current, base);
  };

  const update = (next: (current: PictureEdit, base: { width: number; height: number }) => PictureEdit) => {
    const current = edit();
    const base = natural();
    if (current && base) setEdit(next(current, base));
  };

  let drag: { id: number; handle: Handle; x: number; y: number; start: Rect } | null = null;

  const begin = (event: PointerEvent) => {
    const current = edit();
    if (event.button !== 0 || !current) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-handle]");
    const handle = (target?.dataset.handle as Handle | undefined) ?? "move";
    event.preventDefault();
    frameEl?.setPointerCapture(event.pointerId);
    frameEl?.focus({ preventScroll: true });
    drag = { id: event.pointerId, handle, x: event.clientX, y: event.clientY, start: current.crop };
    setDragging(handle);
  };

  const follow = (event: PointerEvent) => {
    const box = size();
    if (!drag || event.pointerId !== drag.id || !box) return;
    const by = scale();
    const min = Math.min(MIN_CROP_PX / by, box.width, box.height);
    const { handle, start, x, y } = drag;
    update((current) => ({ ...current, crop: dragCrop(start, handle, (event.clientX - x) / by, (event.clientY - y) / by, box, ratio(), min) }));
  };

  const end = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    setDragging(null);
  };

  const nudge = (event: KeyboardEvent) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    const box = size();
    if (!step || !box) return;
    event.preventDefault();
    const by = (event.shiftKey ? 10 : 1) / scale();
    update((current) => ({ ...current, crop: dragCrop(current.crop, "move", step[0]! * by, step[1]! * by, box, null, 0) }));
  };

  const save = async () => {
    const current = edit();
    const image = picture();
    const base = natural();
    if (!current || !image || !base || saving()) return;
    if (isUntouched(current, base) && !props.edit) {
      props.onClose();
      return;
    }
    setSaving(true);
    try {
      if (isUntouched(current, base)) await props.onSave(props.file, null);
      else await props.onSave(await renderPicture(image, current, props.file, MEDIA_LIMITS.imageMaxBytes), current);
      props.onClose();
    } catch (error) {
      toast.error(t("Couldn't save the picture"), { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const px = (value: number) => `${value * scale()}px`;
  const boxStyle = (rect: Rect): JSX.CSSProperties => ({ left: px(rect.x), top: px(rect.y), width: px(rect.width), height: px(rect.height) });

  return (
    <Dialog open onOpenChange={(open) => !open && !saving() && props.onClose()}>
      <DialogPortal>
        <DialogContent
          ref={content}
          showCloseButton={false}
          overlayClass="bg-black"
          class="top-0 left-0 flex size-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-transparent p-0 shadow-none outline-none sm:max-w-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            content?.focus();
          }}
          onKeyDown={(event: KeyboardEvent) => {
            // The page under it has window shortcuts, like ⌘Enter to send the post.
            event.stopPropagation();
            if (event.key !== "Enter" || (event.target as HTMLElement).closest("button")) return;
            event.preventDefault();
            void save();
          }}
        >
          <header class="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
            <div class="flex min-w-0 flex-1 items-baseline gap-2.5">
              <DialogTitle class="truncate text-sm font-medium text-white">{t("Edit picture")}</DialogTitle>
              <Show when={out()}>
                {(size) => (
                  <span class="shrink-0 text-xs text-white/50 tabular-nums">
                    {size().width} × {size().height}
                  </span>
                )}
              </Show>
            </div>
            <Button
              variant="ghost"
              class="text-white hover:bg-white/10 hover:text-white"
              disabled={!changed() || saving()}
              onClick={() => update((_, base) => startEdit(base))}
            >
              {t("Reset")}
            </Button>
            <Button variant="ghost" class="text-white hover:bg-white/10 hover:text-white" disabled={saving()} onClick={() => props.onClose()}>
              {t("Cancel")}
            </Button>
            <Button class="min-w-16 gap-1" disabled={!picture() || saving()} onClick={() => void save()}>
              <Show when={saving()}>
                <Icon name="spinner-loader" class="-ml-1 size-5 animate-spin" />
              </Show>
              {props.saveLabel ?? t("Save")}
            </Button>
          </header>

          <div ref={stageEl} class="relative min-h-0 flex-1 touch-none select-none">
            <Show
              when={size() && scale() > 0 ? size() : null}
              fallback={
                <div class="absolute inset-0 grid place-items-center text-sm text-white/60">
                  <Show when={picture.error} fallback={<Icon name="spinner-loader" class="size-6 animate-spin" />}>
                    {t("The picture could not be read.")}
                  </Show>
                </div>
              }
            >
              {(box) => (
                <div
                  class="absolute"
                  style={{
                    left: `${(stage().width - box().width * scale()) / 2}px`,
                    top: `${(stage().height - box().height * scale()) / 2}px`,
                    width: px(box().width),
                    height: px(box().height),
                  }}
                >
                  <div class="absolute inset-0 overflow-hidden">
                    <img
                      src={url}
                      alt=""
                      draggable={false}
                      class="absolute top-1/2 left-1/2 max-w-none"
                      style={{
                        width: px(natural()!.width),
                        height: px(natural()!.height),
                        transform: `translate(-50%, -50%) scale(${edit()!.flipX ? -1 : 1}, ${edit()!.flipY ? -1 : 1}) rotate(${edit()!.turns * 90}deg)`,
                      }}
                    />
                    <div class="pointer-events-none absolute shadow-[0_0_0_100vmax_rgb(0_0_0/0.6)]" style={boxStyle(edit()!.crop)} />
                  </div>

                  <div
                    ref={frameEl}
                    role="group"
                    tabIndex={0}
                    aria-label={t("Crop area")}
                    class="absolute outline-none ring-1 ring-white/85 focus-visible:ring-2 focus-visible:ring-primary"
                    style={{ ...boxStyle(edit()!.crop), cursor: CURSORS[dragging() ?? "move"] }}
                    onPointerDown={begin}
                    onPointerMove={follow}
                    onPointerUp={end}
                    onPointerCancel={end}
                    onKeyDown={nudge}
                  >
                    <div class="pointer-events-none absolute inset-0 transition-opacity duration-150" classList={{ "opacity-0": !dragging() }}>
                      <span class="absolute inset-y-0 left-1/3 w-px bg-white/40" />
                      <span class="absolute inset-y-0 left-2/3 w-px bg-white/40" />
                      <span class="absolute inset-x-0 top-1/3 h-px bg-white/40" />
                      <span class="absolute inset-x-0 top-2/3 h-px bg-white/40" />
                    </div>
                    <CropHandles cursor={!dragging()} />
                  </div>
                </div>
              )}
            </Show>
          </div>

          <footer class="flex shrink-0 justify-center px-3 pt-2 pb-5">
            <div class="flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl bg-white/6 p-1">
              <div class="flex items-center gap-0.5" role="radiogroup" aria-label={t("Shape")}>
                <For each={SHAPES}>
                  {(shape) => (
                    <Tooltip>
                      <TooltipTrigger
                        as="button"
                        type="button"
                        role="radio"
                        aria-checked={edit()?.shape === shape.id}
                        disabled={!edit()}
                        class={cx(
                          "flex h-12 min-w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl px-1.5 text-xxs press transition-colors focus-ring",
                          edit()?.shape === shape.id ? "bg-white/16 text-white" : "text-white/60 hover:bg-white/6 hover:text-white",
                        )}
                        onClick={() => update((current, base) => withShape(current, shape.id, base))}
                      >
                        <ShapeGlyph id={shape.id} ratio={shape.ratio} />
                        <span class="leading-none">{shape.ratio ? shape.label : t(shape.label)}</span>
                      </TooltipTrigger>
                      <TooltipContent>{t(shape.hint)}</TooltipContent>
                    </Tooltip>
                  )}
                </For>
              </div>
              <span class="mx-1 h-8 w-px shrink-0 bg-white/12" />
              <ToolButton label={t("Rotate left")} icon="rotate-left" onClick={() => update((current, base) => turnEdit(current, base, false))} />
              <ToolButton label={t("Rotate right")} icon="rotate-right" onClick={() => update((current, base) => turnEdit(current, base, true))} />
              <ToolButton label={t("Flip horizontally")} icon="flip-horizontal" onClick={() => update((current, base) => flipEdit(current, base, "x"))} />
              <ToolButton label={t("Flip vertically")} icon="flip-vertical" onClick={() => update((current, base) => flipEdit(current, base, "y"))} />
            </div>
          </footer>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function ToolButton(props: { label: string; icon: string; onClick(): void }) {
  return (
    <Tooltip>
      <TooltipTrigger as="button" type="button" aria-label={props.label} class={cx(toolButton, "shrink-0")} onClick={() => props.onClick()}>
        <Icon name={props.icon} class="size-6" />
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

function ShapeGlyph(props: { id: ShapeId; ratio?: number }) {
  return (
    <span class="grid size-[18px] place-items-center">
      <Show when={props.ratio} fallback={<Icon name={props.id === "free" ? "crop" : "image"} class="size-[22px]" />}>
        {(ratio) => (
          <span
            class="rounded-[3px] border-[1.5px] border-current"
            style={{ width: `${ratio() >= 1 ? 18 : 18 * ratio()}px`, height: `${ratio() >= 1 ? 18 / ratio() : 18}px` }}
          />
        )}
      </Show>
    </span>
  );
}

const CORNERS = [
  { handle: "nw", hit: "-left-3.5 -top-3.5", mark: "left-[11px] top-[11px] border-l-[3px] border-t-[3px] rounded-tl-[2px]" },
  { handle: "ne", hit: "-right-3.5 -top-3.5", mark: "right-[11px] top-[11px] border-r-[3px] border-t-[3px] rounded-tr-[2px]" },
  { handle: "sw", hit: "-left-3.5 -bottom-3.5", mark: "left-[11px] bottom-[11px] border-l-[3px] border-b-[3px] rounded-bl-[2px]" },
  { handle: "se", hit: "-right-3.5 -bottom-3.5", mark: "right-[11px] bottom-[11px] border-r-[3px] border-b-[3px] rounded-br-[2px]" },
] as const;

const EDGES = [
  { handle: "n", hit: "inset-x-3.5 -top-2 h-4", mark: "left-1/2 top-[5px] h-[3px] w-5 -translate-x-1/2" },
  { handle: "s", hit: "inset-x-3.5 -bottom-2 h-4", mark: "left-1/2 bottom-[5px] h-[3px] w-5 -translate-x-1/2" },
  { handle: "w", hit: "inset-y-3.5 -left-2 w-4", mark: "top-1/2 left-[5px] w-[3px] h-5 -translate-y-1/2" },
  { handle: "e", hit: "inset-y-3.5 -right-2 w-4", mark: "top-1/2 right-[5px] w-[3px] h-5 -translate-y-1/2" },
] as const;

/** Marks sit just outside the crop's line, like Photos' and Figma's, so they never hide its edge pixels. */
function CropHandles(props: { cursor: boolean }) {
  return (
    <>
      <For each={EDGES}>
        {(edge) => (
          <span data-handle={edge.handle} class={cx("absolute", edge.hit)} style={{ cursor: props.cursor ? CURSORS[edge.handle] : undefined }}>
            <span class={cx("pointer-events-none absolute rounded-full bg-white shadow-[0_0_2px_rgb(0_0_0/0.5)]", edge.mark)} />
          </span>
        )}
      </For>
      <For each={CORNERS}>
        {(corner) => (
          <span data-handle={corner.handle} class={cx("absolute size-7", corner.hit)} style={{ cursor: props.cursor ? CURSORS[corner.handle] : undefined }}>
            <span class={cx("pointer-events-none absolute size-5 border-white drop-shadow-[0_0_1px_rgb(0_0_0/0.6)]", corner.mark)} />
          </span>
        )}
      </For>
    </>
  );
}
