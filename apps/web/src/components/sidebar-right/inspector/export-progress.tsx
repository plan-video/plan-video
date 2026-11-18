/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal, onCleanup, onMount } from "solid-js";
import { Show, Portal } from "solid-js/web";
import { toast } from "somoto";
import CalendarClockIcon from "lucide-solid/icons/calendar-clock";
import PlayIcon from "lucide-solid/icons/play";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/utils/formatters";
import { t } from "@/lib/i18n";
import { NOT_POSTABLE } from "@/lib/social-media";
import type { JSX } from "solid-js";
import type { EncoderConfig } from "@plan.video/encoder";

export type ExportConfig = Omit<
  EncoderConfig,
  "target" | "scene" | "onProgress" | "realizeScene" | "comment"
>;

type ExportProgressProps = {
  open: boolean;
  progress: number;
  remaining?: { minutes: number; seconds: number };
  config?: ExportConfig;
  width: number;
  height: number;
  duration: number;
  onCancel: () => void;
};

export function ExportProgress(props: ExportProgressProps) {
  const cfg = () => props.config;

  const videoEnabled = () => cfg()?.format !== "ogg" && cfg()?.format !== "wav" && cfg()?.video?.enabled !== false;
  const summary = () =>
    [
      videoEnabled() && `${props.width}×${props.height}`,
      videoEnabled() && `${cfg()?.video?.fps ?? 30} FPS`,
      (cfg()?.format ?? "mp4").toUpperCase(),
      formatDuration(props.duration),
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <Show when={props.open}>
      <ExportWindow label={t("Exporting the video")}>
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h4 class="text-[13px] leading-5 font-medium text-foreground">{t("Exporting the video")}</h4>
                <p class="mt-0.5 truncate text-xs leading-4 text-muted-foreground tabular-nums">{summary()}</p>
              </div>
              <Button variant="secondary" class="shrink-0" onClick={props.onCancel}>
                {t("Cancel")}
              </Button>
            </div>

            <div class="mt-4 h-1 w-full overflow-hidden rounded-full bg-foreground/10">
              <div class="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${props.progress}%` }} />
            </div>

            <div class="mt-2 flex justify-between text-xs leading-4 text-muted-foreground tabular-nums">
              <span>{props.progress}%</span>
              <Show when={props.remaining}>
                {(r) => <span>{t("{minutes}min {seconds}s", { minutes: r().minutes, seconds: r().seconds })}</span>}
              </Show>
            </div>
      </ExportWindow>
    </Show>
  );
}

function ExportWindow(props: { label: string; onDismiss?: () => void; children: JSX.Element }) {
  return (
    <Portal>
      <div class="fixed inset-0 z-50 bg-overlay-strong" />
      <div class="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={(event) => event.target === event.currentTarget && props.onDismiss?.()}>
        <div
          role="dialog"
          aria-label={props.label}
          class="w-full max-w-[360px] rounded-xl border border-border bg-background p-4 shadow-[0_12px_24px_rgba(0,0,0,0.24)]"
        >
          {props.children}
        </div>
      </div>
    </Portal>
  );
}

type ExportSavedProps = {
  handle: FileSystemFileHandle;
  video: boolean;
  postable: boolean;
  onSchedule: (file: File) => Promise<void>;
  onClose: () => void;
};

export function ExportSaved(props: ExportSavedProps) {
  const [url, setUrl] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  // The handle reads the file as it is on disk now; a moved or changed file throws here.
  const withFile = async (work: (file: File) => unknown) => {
    setBusy(true);
    try {
      await work(await props.handle.getFile());
    } catch (error) {
      toast.error(t("Couldn't open the saved video"), { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const play = () => withFile((file) => setUrl(URL.createObjectURL(file)));

  const onKey = (event: KeyboardEvent) => event.key === "Escape" && props.onClose();
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => {
    window.removeEventListener("keydown", onKey);
    const current = url();
    if (current) URL.revokeObjectURL(current);
  });

  return (
    <ExportWindow label={t("Video saved")} onDismiss={props.onClose}>
      <h4 class="text-[13px] leading-5 font-medium text-foreground">{t("Video saved")}</h4>
      <p class="mt-0.5 truncate text-xs leading-4 text-muted-foreground">{props.handle.name}</p>

      <Show when={url()}>
        {(src) => <video src={src()} controls autoplay playsinline class="mt-3 max-h-[50vh] w-full rounded-lg bg-black" />}
      </Show>
      <Show when={props.video && !props.postable}>
        <p class="mt-3 text-xs leading-4 text-muted-foreground">{t(NOT_POSTABLE)}</p>
      </Show>

      <div class="mt-4 flex items-center gap-2">
        <Show when={props.video && !url()}>
          <Button variant="ghost" class="gap-1.5 pl-2" onClick={play} disabled={busy()}>
            <PlayIcon class="size-3.5" stroke-width={2} />
            {t("Play")}
          </Button>
        </Show>
        <div class="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={props.onClose}>
            {t("Done")}
          </Button>
          <Show when={props.postable}>
            <Button class="gap-1.5 pl-2" onClick={() => withFile(props.onSchedule)} disabled={busy()}>
              <CalendarClockIcon class="size-3.5" stroke-width={2} />
              {t("Schedule this video")}
            </Button>
          </Show>
        </div>
      </div>
    </ExportWindow>
  );
}
