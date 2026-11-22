/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { toast } from "somoto";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { CropFrame, GUTTER, ShapeGlyph, tile } from "@/components/publish/picture-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cx } from "@/lib/cva";
import { t } from "@/lib/i18n";
import { pixelCrop } from "@/lib/picture-edit";
import { formatDuration } from "@/lib/social";
import { MEDIA_LIMITS, isPostableVideo, videoFrames } from "@/lib/social-media";
import {
  VIDEO_SHAPES,
  VideoEditCancelled,
  isUntouchedVideo,
  renderVideo,
  startVideoEdit,
  trimTo,
  videoOutputSize,
  withVideoShape,
  type VideoEdit,
} from "@/lib/video-edit";

const STRIP_FRAMES = 10;

/** Tenths, so a trim reads as exact as it is. */
const clock = (seconds: number) => {
  const tenths = Math.max(0, Math.round(seconds * 10));
  return `${formatDuration(Math.floor(tenths / 10))}.${tenths % 10}`;
};

/** Trim, crop to a shape networks take, or take the sound out, without opening the editor. */
export function VideoEditor(props: {
  /** The video as it was before any edit here, so an earlier trim can be widened again. */
  file: File;
  edit?: VideoEdit | null;
  /** `edit` is null when the video is back to how it was. */
  onSave(file: File, edit: VideoEdit | null): Promise<void> | void;
  onClose(): void;
}) {
  const url = URL.createObjectURL(props.file);
  onCleanup(() => URL.revokeObjectURL(url));

  const [meta, setMeta] = createSignal<{ width: number; height: number; duration: number } | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [chosen, setEdit] = createSignal<VideoEdit | null>(null);
  const edit = createMemo(() => {
    const info = meta();
    return info ? (chosen() ?? props.edit ?? startVideoEdit(info, info.duration)) : null;
  });
  const [stage, setStage] = createSignal({ width: 0, height: 0 });
  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [frames, setFrames] = createSignal<{ time: number; src: string }[]>([]);
  const [progress, setProgress] = createSignal<number | null>(null);
  let video: HTMLVideoElement | undefined;
  let stageEl: HTMLDivElement | undefined;
  let content: HTMLDivElement | undefined;
  let job: AbortController | undefined;
  let frame = 0;

  onMount(() => {
    if (!stageEl) return;
    const observer = new ResizeObserver(([entry]) => entry && setStage({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(stageEl);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    job?.abort();
  });

  const loaded = () => {
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!video.videoWidth || !duration) {
      setFailed(true);
      return;
    }
    setMeta({ width: video.videoWidth, height: video.videoHeight, duration });
    video.currentTime = edit()!.start;
    setTime(edit()!.start);
    void videoFrames({ url, duration }, STRIP_FRAMES).then(setFrames, () => {});
  };

  const scale = createMemo(() => {
    const info = meta();
    if (!info) return 0;
    return Math.max(0, Math.min((stage().width - GUTTER * 2) / info.width, (stage().height - GUTTER * 2) / info.height));
  });
  const out = () => {
    const current = edit();
    const info = meta();
    return current && info ? videoOutputSize(pixelCrop(current.crop, info)) : null;
  };
  const changed = () => {
    const current = edit();
    const info = meta();
    return !!current && !!info && !isUntouchedVideo(current, info, info.duration);
  };
  /** Networks won't take the file as it is, so saving makes an MP4 even with nothing changed. */
  const mustRender = !isPostableVideo(props.file) || props.file.size > MEDIA_LIMITS.videoMaxBytes;
  const update = (next: (current: VideoEdit, info: { width: number; height: number; duration: number }) => VideoEdit) => {
    const current = edit();
    const info = meta();
    if (current && info) setEdit(next(current, info));
  };

  // Only runs while playing, so a paused video costs nothing.
  const follow = () => {
    const current = edit();
    if (!video || !current) return;
    if (video.currentTime >= current.end) video.currentTime = current.start;
    setTime(video.currentTime);
    frame = requestAnimationFrame(follow);
  };

  const pause = () => video?.pause();
  const togglePlay = () => {
    const current = edit();
    if (!video || !current) return;
    if (!video.paused) return pause();
    if (video.currentTime < current.start || video.currentTime >= current.end - 0.05) video.currentTime = current.start;
    void video.play().catch(() => {});
  };

  const seekTo = (seconds: number) => {
    if (!video) return;
    video.currentTime = seconds;
    setTime(seconds);
  };

  const saving = () => progress() !== null;

  const save = async () => {
    const current = edit();
    const info = meta();
    if (!current || !info || saving()) return;
    if (!changed() && !mustRender) {
      if (props.edit) await props.onSave(props.file, null);
      props.onClose();
      return;
    }
    pause();
    const run = (job = new AbortController());
    setProgress(0);
    try {
      const file = await renderVideo(props.file, current, info, { signal: run.signal, onProgress: (done) => setProgress(done) });
      if (run.signal.aborted) return;
      await props.onSave(file, current);
      props.onClose();
    } catch (error) {
      if (error instanceof VideoEditCancelled || run.signal.aborted) return;
      console.error("[video-edit]", error);
      toast.error(t("Couldn't save the video"), { description: (error as Error).message });
    } finally {
      if (job === run) setProgress(null);
    }
  };

  const stopSaving = () => {
    job?.abort();
    setProgress(null);
  };

  const close = () => {
    stopSaving();
    props.onClose();
  };

  const px = (value: number) => `${value * scale()}px`;

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
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
            const target = event.target as HTMLElement;
            if (target.closest("button, [role=slider]")) return;
            if (event.key === " ") {
              event.preventDefault();
              togglePlay();
            } else if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
        >
          <header class="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
            <div class="flex min-w-0 flex-1 items-baseline gap-2.5">
              <DialogTitle class="truncate text-sm font-medium text-white">{t("Edit video")}</DialogTitle>
              <Show when={out()}>
                {(size) => (
                  <span class="shrink-0 text-xs text-white/50 tabular-nums max-sm:hidden">
                    {size().width} × {size().height} · {formatDuration(edit()!.end - edit()!.start)}
                  </span>
                )}
              </Show>
            </div>
            <Button
              variant="ghost"
              class="text-white hover:bg-white/10 hover:text-white"
              disabled={!changed() || saving()}
              onClick={() =>
                update((_, info) => ({ start: 0, end: info.duration, crop: { x: 0, y: 0, width: info.width, height: info.height }, shape: "original", muted: false }))
              }
            >
              {t("Reset")}
            </Button>
            <Button variant="ghost" class="text-white hover:bg-white/10 hover:text-white" onClick={() => (saving() ? stopSaving() : close())}>
              {t("Cancel")}
            </Button>
            <Button class="min-w-16 gap-1 tabular-nums" disabled={!meta() || saving()} onClick={() => void save()}>
              <Show when={saving()} fallback={t("Save")}>
                <Icon name="spinner-loader" class="-ml-1 size-5 animate-spin" />
                {`${Math.round((progress() ?? 0) * 100)}%`}
              </Show>
            </Button>
          </header>

          <div ref={stageEl} class="relative min-h-0 flex-1 touch-none select-none">
            <Show when={!meta()}>
              <div class="absolute inset-0 grid place-items-center text-sm text-white/60">
                <Show when={failed()} fallback={<Icon name="spinner-loader" class="size-6 animate-spin" />}>
                  {t("The video could not be read.")}
                </Show>
              </div>
            </Show>
            <div
              class="absolute"
              classList={{ invisible: !meta() || !scale() }}
              style={{
                left: `${(stage().width - (meta()?.width ?? 0) * scale()) / 2}px`,
                top: `${(stage().height - (meta()?.height ?? 0) * scale()) / 2}px`,
                width: px(meta()?.width ?? 0),
                height: px(meta()?.height ?? 0),
              }}
            >
              <div class="absolute inset-0 overflow-hidden">
                <video
                  ref={video}
                  src={url}
                  class="absolute inset-0 size-full"
                  playsinline
                  preload="auto"
                  muted={edit()?.muted ?? false}
                  onLoadedMetadata={loaded}
                  onError={() => setFailed(true)}
                  onPlay={() => {
                    setPlaying(true);
                    frame = requestAnimationFrame(follow);
                  }}
                  onPause={() => {
                    setPlaying(false);
                    cancelAnimationFrame(frame);
                  }}
                />
                <Show when={edit()}>
                  {(current) => (
                    <div
                      class="pointer-events-none absolute shadow-[0_0_0_100vmax_rgb(0_0_0/0.6)]"
                      style={{ left: px(current().crop.x), top: px(current().crop.y), width: px(current().crop.width), height: px(current().crop.height) }}
                    />
                  )}
                </Show>
              </div>
              <Show when={edit() && meta()}>
                <CropFrame
                  crop={edit()!.crop}
                  size={meta()!}
                  scale={scale()}
                  ratio={edit()!.crop.width / edit()!.crop.height}
                  onCrop={(crop) => update((current) => ({ ...current, crop }))}
                />
              </Show>
            </div>
          </div>

          <footer class="flex shrink-0 flex-col items-center gap-3 px-3 pt-3 pb-5">
            <div class="flex w-full max-w-3xl items-start gap-2">
              <button
                type="button"
                aria-label={playing() ? t("Pause") : t("Play")}
                disabled={!meta()}
                class="grid size-12 shrink-0 place-items-center rounded-lg bg-white/6 text-white transition-colors hover:bg-white/12 focus-ring"
                onClick={togglePlay}
              >
                <Icon name={playing() ? "pause" : "play"} class={cx("size-6", !playing() && "translate-x-px")} />
              </button>
              <Show when={edit() && meta()} fallback={<span class="h-12 flex-1 animate-pulse rounded-lg bg-white/6" />}>
                <TrimBar
                  frames={frames()}
                  duration={meta()!.duration}
                  start={edit()!.start}
                  end={edit()!.end}
                  time={time()}
                  onTrim={(end, seconds) => {
                    pause();
                    update((current, info) => trimTo(current, end, seconds, info.duration));
                    seekTo(edit()![end]);
                  }}
                  onSeek={(seconds) => {
                    pause();
                    seekTo(Math.min(Math.max(seconds, edit()!.start), edit()!.end));
                  }}
                />
              </Show>
            </div>
            <div class="flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl bg-white/6 p-1">
              <div class="flex items-center gap-0.5" role="radiogroup" aria-label={t("Shape")}>
                <For each={VIDEO_SHAPES}>
                  {(shape) => (
                    <Tooltip>
                      <TooltipTrigger
                        as="button"
                        type="button"
                        role="radio"
                        aria-checked={edit()?.shape === shape.id}
                        disabled={!edit()}
                        class={tile(edit()?.shape === shape.id)}
                        onClick={() => update((current, info) => withVideoShape(current, shape.id, info))}
                      >
                        <ShapeGlyph id={shape.id === "original" ? "original" : "1:1"} ratio={shape.ratio} />
                        <span class="leading-none">{shape.ratio ? shape.label : t(shape.label)}</span>
                      </TooltipTrigger>
                      <TooltipContent>{t(shape.hint)}</TooltipContent>
                    </Tooltip>
                  )}
                </For>
              </div>
              <span class="mx-1 h-8 w-px shrink-0 bg-white/12" />
              <Tooltip>
                <TooltipTrigger
                  as="button"
                  type="button"
                  aria-pressed={edit()?.muted ?? false}
                  disabled={!edit()}
                  class={tile(edit()?.muted ?? false)}
                  onClick={() => update((current) => ({ ...current, muted: !current.muted }))}
                >
                  <span class="grid size-[18px] place-items-center">
                    <Icon name={edit()?.muted ? "volume-off" : "volume"} class="size-[22px]" />
                  </span>
                  <span class="leading-none">{t("Mute")}</span>
                </TooltipTrigger>
                <TooltipContent>{edit()?.muted ? t("Bring the sound back") : t("Post it without sound")}</TooltipContent>
              </Tooltip>
            </div>
          </footer>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

type TrimEnd = "start" | "end";

/** A filmstrip with a handle at each end of the part that's kept; dragging anywhere else moves the playhead. */
function TrimBar(props: {
  frames: { time: number; src: string }[];
  duration: number;
  start: number;
  end: number;
  time: number;
  onTrim(end: TrimEnd, seconds: number): void;
  onSeek(seconds: number): void;
}) {
  let bar: HTMLDivElement | undefined;
  let drag: { id: number; what: TrimEnd | "seek" } | null = null;
  const at = (seconds: number) => `${(seconds / props.duration) * 100}%`;
  const timeAt = (event: PointerEvent) => {
    const box = bar!.getBoundingClientRect();
    return (Math.min(Math.max(event.clientX - box.left, 0), box.width) / box.width) * props.duration;
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    const seconds = timeAt(event);
    if (drag.what === "seek") props.onSeek(seconds);
    else props.onTrim(drag.what, seconds);
  };
  const begin = (event: PointerEvent) => {
    if (event.button !== 0 || !bar) return;
    event.preventDefault();
    const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-trim]");
    bar.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, what: (handle?.dataset.trim as TrimEnd | undefined) ?? "seek" };
    handle?.focus({ preventScroll: true });
    move(event);
  };
  const end = (event: PointerEvent) => {
    if (drag?.id === event.pointerId) drag = null;
  };
  const nudge = (which: TrimEnd) => (event: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    props.onTrim(which, props[which] + step * (event.shiftKey ? 1 : 0.1));
  };

  return (
    <div class="flex min-w-0 flex-1 flex-col gap-1.5">
      <div
        ref={bar}
        class="relative h-12 touch-none cursor-pointer select-none"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div class="absolute inset-0 flex overflow-hidden rounded-lg bg-white/6">
          <For each={props.frames}>{(still) => <img src={still.src} alt="" draggable={false} class="h-full min-w-0 flex-1 object-cover" />}</For>
        </div>
        <span class="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-black/65" style={{ width: at(props.start) }} />
        <span class="pointer-events-none absolute inset-y-0 right-0 rounded-r-lg bg-black/65" style={{ width: `calc(100% - ${at(props.end)})` }} />
        <span
          class="pointer-events-none absolute inset-y-0 rounded-lg border-y-[3px] border-white"
          style={{ left: at(props.start), width: `calc(${at(props.end)} - ${at(props.start)})` }}
        />
        <span class="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_2px_rgb(0_0_0/0.6)]" style={{ left: at(props.time) }} />
        <For each={["start", "end"] as const}>
          {(which) => (
            <span
              data-trim={which}
              role="slider"
              tabIndex={0}
              aria-label={which === "start" ? t("Start") : t("End")}
              aria-valuemin={0}
              aria-valuemax={Math.round(props.duration * 10) / 10}
              aria-valuenow={Math.round(props[which] * 10) / 10}
              aria-valuetext={clock(props[which])}
              class="absolute inset-y-0 grid w-4 cursor-ew-resize place-items-center bg-white outline-none focus-visible:ring-2 focus-visible:ring-primary"
              classList={{ "rounded-l-lg": which === "start", "-translate-x-full rounded-r-lg": which === "end" }}
              style={{ left: at(props[which]) }}
              onKeyDown={nudge(which)}
            >
              <span class="pointer-events-none h-4 w-0.5 rounded-full bg-black/50" />
            </span>
          )}
        </For>
      </div>
      <div class="flex justify-between text-xs text-white/50 tabular-nums">
        <span>{clock(props.start)}</span>
        <span class="text-white">{clock(props.end - props.start)}</span>
        <span>{clock(props.end)}</span>
      </div>
    </div>
  );
}
