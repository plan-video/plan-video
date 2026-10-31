/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createSignal } from "solid-js";
import { createEncoder, computeOutputSize } from "@plan.video/encoder";
import { Computed, FrameRate, Workarea } from "@plan.video/runtime";

import { createCapture } from "@/engine/capture";
import { track } from "@/lib/analytics";
import { version } from "../../package.json";

import type { Entity } from "koota";
import type { EncoderConfig, ExportResult } from "@plan.video/encoder";
import type { Capture } from "@/engine/capture";
import type { Engine } from "@/engine";
import type { ExportConfig } from "@/components/sidebar-right/inspector/export-progress";

// The one scene render path, for both the UI export and the agent's export tool.

export type RenderOverlayState = {
  config?: Partial<ExportConfig>;
  width: number;
  height: number;
  duration: number;
  progress: number;
  remaining?: { minutes: number; seconds: number };
};

const PROGRESS_LOG_STEP = 2;

const [overlay, setOverlay] = createSignal<RenderOverlayState | null>(null);
let cancelActive: (() => void) | undefined;

export const renderOverlay = overlay;

export function cancelRender() {
  cancelActive?.();
}

export type RenderSceneOptions = {
  scene: Entity;
  target: NonNullable<EncoderConfig["target"]>;
  config?: Partial<EncoderConfig>;
  source: "ui" | "agent";
};

export async function renderScene(
  engine: Engine,
  { scene, target, config, source }: RenderSceneOptions,
): Promise<ExportResult> {
  const world = engine.world;

  const workarea = scene.get(Workarea);
  const computed = scene.get(Computed);
  const frames = workarea
    ? workarea.end - workarea.start
    : computed?.duration ?? 0;
  const duration = frames / (world.get(FrameRate)?.value || 30);

  // The size the encoder works out itself (the scene's aspect, not 16:9), so the overlay matches.
  const { width, height } = computeOutputSize(
    computed?.width || 1920,
    computed?.height || 1080,
    config?.video?.resolution ?? 1080,
  );

  cancelActive = undefined;
  setOverlay({ config, width, height, duration, progress: 0, remaining: undefined });

  let logged = -1;
  const logProgress = (percent: number) => {
    if (percent - logged < PROGRESS_LOG_STEP && percent < 100) return;
    logged = percent;
    console.info(`[export] ${percent}%`);
  };

  engine.stop();

  const event = {
    source,
    format: config?.format,
    resolution: config?.video?.resolution,
    fps: config?.video?.fps,
    scene_duration_s: Math.round(duration),
  };
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const failed = (error: unknown) =>
    track("export_failed", {
      ...event,
      duration_ms: elapsed(),
      error: (error as Error)?.message?.slice(0, 200) ?? "unknown",
    });
  track("export_started", {
    ...event,
    video_codec: config?.video?.codec,
    audio_codec: config?.audio?.codec,
  });

  let capture: Capture | undefined;
  try {
    capture = await createCapture(world, scene, {
      frameRate: config?.video?.fps,
      mode: config?.video?.enabled === false || config?.format === "ogg" ? "offline-audio" : "offline-video",
    });

    const encoder = await createEncoder(capture.world, {
      ...config,
      target,
      comment: `Made with Plan Video v${version}`,
      onProgress(p) {
        const percent = Math.round((p.progress / p.total) * 100);
        logProgress(percent);
        setOverlay((prev) =>
          prev
            ? {
                ...prev,
                progress: percent,
                remaining: {
                  minutes: p.remaining.getUTCMinutes(),
                  seconds: p.remaining.getUTCSeconds(),
                },
              }
            : prev,
        );
      },
    });

    cancelActive = encoder.cancel;
    const result = await encoder.render();

    if (result.type === "success") {
      track("export_completed", { ...event, duration_ms: elapsed() });
    } else if (result.type === "error") {
      failed(result.error);
    }

    return result;
  } catch (error) {
    failed(error);
    throw error;
  } finally {
    cancelActive = undefined;
    setOverlay(null);
    capture?.dispose();
    engine.start();
  }
}
