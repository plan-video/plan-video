/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, Portal } from "solid-js/web";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/utils/formatters";
import { t } from "@/lib/i18n";
import type { EncoderConfig } from "@plan.video/encoder";

/** The settings this overlay reads: the encoder's, less how it is driven. */
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

/**
 * While a video is written: one card in the editor's own make, with what is
 * being written on a single line rather than a table of every setting.
 */
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
      <Portal>
        <div class="fixed inset-0 z-50 bg-overlay-strong" />
        <div class="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div
            role="dialog"
            aria-label={t("Exporting the video")}
            class="w-full max-w-[360px] rounded-xl border border-border bg-background p-4 shadow-[0_12px_24px_rgba(0,0,0,0.24)]"
          >
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
          </div>
        </div>
      </Portal>
    </Show>
  );
}
