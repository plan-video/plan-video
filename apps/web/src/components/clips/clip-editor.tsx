/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useNavigate } from "@solidjs/router";
import { Show, createEffect, createResource, createSignal, on, onCleanup, onMount } from "solid-js";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { PlaneIcon } from "@/components/dashboard/plane-icons";
import { handOffWords } from "@/components/publish/handoff";
import { Button } from "@/components/ui/button";
import { toast } from "somoto";
import { appRoute, projectRoute, useReturnHere } from "@/hooks/use-project-route";
import { track } from "@/lib/analytics";
import { clipWords, clock, trimmed, type ClipEdit } from "@/lib/clip-studio";
import { findStreamLook } from "@/lib/facecam-find";
import { t } from "@/lib/i18n";
import { handPostVideo } from "@/projects/post-export";
import { isInputTarget } from "@/utils";

import { clipExportSettings, clipProject, downloadClip } from "./clip-actions";
import { captionLook, drawClip, hookLook, useFont } from "./clip-canvas";
import { ClipInspector } from "./clip-inspector";
import { clipMedia, clipPeaks } from "./clip-media";
import { TrimBar } from "./trim-bar";

import type { StreamVideo } from "@/lib/stream-clips";

type ClipEditorProps = {
  video: StreamVideo;
  clip: ClipEdit;
  update(change: (clip: ClipEdit) => void): void;
  onBack(): void;
};

type Busy = { kind: "schedule" | "download" | "open"; progress: number | null };

export function ClipEditor(props: ClipEditorProps) {
  const navigate = useNavigate();
  const returnHere = useReturnHere();
  let canvas!: HTMLCanvasElement;
  let player!: HTMLVideoElement;
  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [muted, setMuted] = createSignal(false);
  const [frame, setFrame] = createSignal(0);
  const [ready, setReady] = createSignal(false);
  const [finding, setFinding] = createSignal(false);
  const [busy, setBusy] = createSignal<Busy | null>(null);
  let work: AbortController | null = null;
  onCleanup(() => work?.abort());

  const length = () => props.clip.end - props.clip.start;
  const [media] = createResource(
    () => ({ id: props.clip.id, start: props.clip.range.start, end: props.clip.range.end }),
    () => clipMedia(props.video, props.clip),
  );
  const [peaks] = createResource(
    () => media() && { id: props.clip.id },
    () => clipPeaks(props.video, props.clip),
  );

  const draw = () => {
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(canvas.clientWidth * ratio);
    if (!width) return;
    if (canvas.width !== width) {
      canvas.width = width;
      canvas.height = Math.round((width * 16) / 9);
    }
    drawClip(ctx, props.clip, time(), width, ready() ? player : null);
  };

  createEffect(() => {
    JSON.stringify(props.clip);
    time();
    ready();
    draw();
  });

  onMount(() => {
    useFont(hookLook(), draw);
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    onCleanup(() => observer.disconnect());
  });
  createEffect(() => useFont(captionLook(props.clip), draw));

  const fileTime = (clipTime: number) => (media() ? media()!.at(props.clip.start) + clipTime : 0);

  const seek = (clipTime: number) => {
    const next = Math.min(length(), Math.max(0, clipTime));
    setTime(next);
    if (media()) player.currentTime = fileTime(next);
  };

  let loop = 0;
  const tick = () => {
    if (!playing()) return;
    const now = player.currentTime - fileTime(0);
    if (now >= length()) {
      player.pause();
      seek(0);
      return;
    }
    setTime(Math.max(0, now));
    if (loop % 8 === 0) setFrame((value) => value + 1);
    loop += 1;
    if ("requestVideoFrameCallback" in player) player.requestVideoFrameCallback(tick);
    else requestAnimationFrame(tick);
  };

  const play = () => {
    if (!media()) return;
    if (time() >= length() - 0.05) seek(0);
    player.currentTime = fileTime(time());
    void player.play().catch(() => setPlaying(false));
  };
  const toggle = () => (playing() ? player.pause() : play());

  // A new clip, or one trimmed so the playhead falls outside it, starts again from the top.
  createEffect(
    on(
      () => props.clip.id,
      () => {
        player?.pause();
        setReady(false);
        setTime(0);
      },
    ),
  );
  createEffect(() => {
    if (time() > length()) seek(length());
  });

  createEffect(
    on(media, (loaded) => {
      if (!loaded || props.clip.looked) return;
      void findFacecam(loaded);
    }),
  );

  async function findFacecam(loaded = media()) {
    if (!loaded) return;
    setFinding(true);
    try {
      const look = await findStreamLook(loaded.file, loaded.at(props.clip.start), loaded.at(props.clip.end), { category: props.video.game });
      props.update((clip) => {
        clip.layout = look.layout;
        clip.crops = look.crops;
        clip.looked = true;
      });
    } catch (error) {
      console.warn("[clips] facecam not found", error);
      props.update((clip) => {
        clip.looked = true;
      });
    } finally {
      setFinding(false);
    }
  }

  const trim = (start: number, end: number) => {
    const next = trimmed(props.clip, start, end);
    props.update((clip) => {
      clip.start = next.start;
      clip.end = next.end;
    });
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || isInputTarget(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    const playhead = props.clip.start + time();
    if (event.key === " ") toggle();
    else if (event.key === "ArrowLeft") seek(time() - (event.shiftKey ? 5 : 1));
    else if (event.key === "ArrowRight") seek(time() + (event.shiftKey ? 5 : 1));
    else if (event.key === "[") trim(playhead, props.clip.end);
    else if (event.key === "]") trim(props.clip.start, playhead);
    else return;
    event.preventDefault();
  };
  onMount(() => {
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  const remember = (made: NonNullable<ClipEdit["project"]>) =>
    props.update((clip) => {
      clip.project = made;
    });

  async function run(kind: Busy["kind"], action: (signal: AbortSignal) => Promise<void>) {
    if (busy()) return;
    player.pause();
    work = new AbortController();
    setBusy({ kind, progress: null });
    try {
      await action(work.signal);
    } catch (error) {
      if (!work.signal.aborted) toast.error(t("That clip couldn't be made"), { description: (error as Error).message });
    } finally {
      setBusy(null);
      work = null;
    }
  }

  const schedule = () =>
    run("schedule", async (signal) => {
      const made = await clipProject(props.video, props.clip, remember, signal);
      handOffWords({ key: made.key, caption: props.clip.caption, title: props.clip.title });
      handPostVideo({ key: made.key, settings: clipExportSettings(made.fps) });
      props.update((clip) => {
        clip.scheduled = true;
      });
      track("clip_scheduled");
      navigate(`${appRoute("new-post")}&project=${encodeURIComponent(made.key)}`);
    });

  const download = () =>
    run("download", async (signal) => {
      const made = await clipProject(props.video, props.clip, remember, signal);
      await downloadClip(made, props.clip.title, (progress) => setBusy({ kind: "download", progress }), signal);
      props.update((clip) => {
        clip.downloaded = true;
      });
      track("clip_downloaded");
    });

  const openInEditor = () =>
    run("open", async (signal) => {
      const made = await clipProject(props.video, props.clip, remember, signal);
      track("clip_opened_in_editor");
      navigate(projectRoute(made.key), { state: returnHere() });
    });

  const busyText = () => {
    const now = busy();
    if (!now) return "";
    if (now.kind === "download" && now.progress !== null) return t("Rendering {percent}%", { percent: now.progress });
    return t("Getting the full picture…");
  };

  return (
    <div class="flex min-h-0 min-w-0 flex-1 max-lg:flex-col max-lg:overflow-y-auto">
      <section class="flex min-h-0 min-w-0 flex-1 flex-col max-lg:min-h-[640px]">
        <div class="flex h-11 shrink-0 items-center gap-2 border-b border-(--plane-border-subtle) px-3">
          <button
            type="button"
            aria-label={t("All clips")}
            class="grid size-7 place-items-center rounded-md text-muted-foreground outline-none press hover:bg-accent hover:text-foreground focus-ring lg:hidden"
            onClick={props.onBack}
          >
            <PlaneIcon name="chevron-left" class="size-4" />
          </button>
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{props.clip.title || t("Untitled clip")}</span>
          <Show when={busy()}>
            <span class="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:hidden">
              <Icon name="spinner-loader" class="size-4 animate-spin" />
              {busyText()}
            </span>
            <Button variant="ghost" onClick={() => work?.abort()}>
              {t("Cancel")}
            </Button>
          </Show>
          <Show when={!busy()}>
            <Button variant="ghost" class="gap-1 pl-1 max-md:w-7 max-md:px-0" onClick={openInEditor} aria-label={t("Open in editor")}>
              <Icon name="edit-video" class="size-5" />
              <span class="max-md:sr-only">{t("Open in editor")}</span>
            </Button>
            <Button variant="secondary" class="gap-1 pl-1 max-md:w-7 max-md:px-0" onClick={download} aria-label={t("Download")}>
              <Icon name="download" class="size-5" />
              <span class="max-md:sr-only">{t("Download")}</span>
            </Button>
            <Button class="px-3" onClick={schedule}>
              {t("Schedule")}
            </Button>
          </Show>
        </div>

        <div class="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-(--plane-surface-2) p-4">
          <div class="relative aspect-[9/16] h-full max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-sm">
            <canvas ref={canvas} class="size-full" role="img" aria-label={t("Preview of the clip")} onClick={toggle} />
            <Show when={!media() || media.loading}>
              <span class="pointer-events-none absolute inset-0 grid place-items-center">
                <Show when={!media.error} fallback={<span class="px-4 text-center text-xs text-white/70">{(media.error as Error)?.message || t("The video couldn't be loaded.")}</span>}>
                  <Icon name="spinner-loader" class="size-6 animate-spin text-white/70" />
                </Show>
              </span>
            </Show>
            <Show when={media() && !playing() && ready()}>
              <span class="pointer-events-none absolute inset-0 grid place-items-center">
                <span class="grid size-12 place-items-center rounded-full bg-black/55 text-white">
                  <svg viewBox="0 0 24 24" class="size-5 translate-x-px" fill="currentColor" aria-hidden="true">
                    <path d="M7 6.25 17 12 7 17.75Z" />
                  </svg>
                </span>
              </span>
            </Show>
          </div>
          <video
            ref={player}
            src={media()?.url}
            class="pointer-events-none absolute size-px opacity-0"
            muted={muted()}
            playsinline
            preload="auto"
            onLoadedData={() => {
              setReady(true);
              seek(time());
            }}
            onSeeked={() => {
              setFrame((value) => value + 1);
              draw();
            }}
            onPlay={() => {
              setPlaying(true);
              tick();
            }}
            onPause={() => setPlaying(false)}
          />
        </div>

        <div class="flex shrink-0 flex-col gap-3 border-t border-(--plane-border-subtle) px-4 pt-3 pb-4">
          <div class="flex items-center gap-2">
            <Button variant="secondary" size="icon-square" aria-label={playing() ? t("Pause") : t("Play")} disabled={!ready()} onClick={toggle}>
              <Icon name={playing() ? "pause" : "play"} class="size-4" />
            </Button>
            <Button variant="ghost" size="icon-square" aria-label={muted() ? t("Turn sound on") : t("Turn sound off")} aria-pressed={!muted()} onClick={() => setMuted(!muted())}>
              <Icon name={muted() ? "volume-off" : "volume"} class="size-4" />
            </Button>
            <span class="text-xs tabular-nums text-muted-foreground">
              <span class="text-foreground">{clock(time(), true)}</span> / {clock(length(), true)}
            </span>
            <span class="ml-auto flex items-center gap-1">
              <Button variant="ghost" class="h-7 px-2 text-xs" title={t("Start here ([)")} onClick={() => trim(props.clip.start + time(), props.clip.end)}>
                {t("Start here")}
              </Button>
              <Button variant="ghost" class="h-7 px-2 text-xs" title={t("End here (])")} onClick={() => trim(props.clip.start, props.clip.start + time())}>
                {t("End here")}
              </Button>
            </span>
          </div>
          <TrimBar
            range={props.clip.range}
            start={props.clip.start}
            end={props.clip.end}
            time={time()}
            peaks={peaks()}
            fileStart={media()?.at(props.clip.range.start)}
            words={props.clip.heard ? clipWords(props.clip).map((word) => word.start) : []}
            onTrim={trim}
            onSeek={seek}
          />
        </div>
      </section>

      <aside class="flex w-[340px] shrink-0 flex-col border-l border-(--plane-border-subtle) bg-(--plane-surface-1) max-lg:w-full max-lg:border-t max-lg:border-l-0">
        <ClipInspector
          clip={props.clip}
          update={props.update}
          source={ready() ? player : null}
          frame={frame()}
          finding={finding()}
          onFindFacecam={() => void findFacecam()}
        />
      </aside>
    </div>
  );
}

