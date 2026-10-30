/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { canEncodeVideo } from "mediabunny";
import { computeOutputSize } from "@plan.video/encoder";
import { Computed, FrameRate, Workarea } from "@plan.video/runtime";
import { isAbsoluteSource } from "@plan.video/assets";
import { DapiError } from "@plan.video/dapi";

import { renderOverlay, renderScene } from "@/context/render";
import { ElectronWritableFileHandle } from "@/lib/electron-file-writable";
import { ProjectConfig as ProjectConfigTrait } from "@/engine/traits";
import { sceneConfigKey } from "@/engine/project-config";
import { getDefaultExportTemplate, VIDEO_FORMAT_OPTIONS } from "@/components/sidebar-right/inspector/export-templates";
import { mainBridge } from "@/lib/ipc";
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { requireScene } from "../lib/scene";

import type { AudioCodec, OutputFormat, VideoCodec } from "mediabunny";
import type { ExportSettings } from "@plan.video/dapi";
import type { ContainerFormat, ExportConfig } from "@/engine/project-config";
import type { ToolHandler } from "../handler";

// A given path's extension wins (ffmpeg's rule: the file must be what its name says), then the config, then mp4.
// So a bad config format only fails an export that would actually use it.
function resolveFormat(path: string | undefined, config: ExportConfig): ContainerFormat {
  const supported = VIDEO_FORMAT_OPTIONS.map((format) => `.${format}`).join(", ");
  if (path !== undefined) {
    if (!isAbsoluteSource(path)) {
      throw new DapiError("invalid-input", `The output path must be absolute (got "${path}").`);
    }
    const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
    if (!extension || !VIDEO_FORMAT_OPTIONS.includes(extension as ContainerFormat)) {
      throw new DapiError("invalid-input", `The output path must end in a container extension: ${supported}.`);
    }
    return extension as ContainerFormat;
  }
  const format = config.format ?? "mp4";
  if (!VIDEO_FORMAT_OPTIONS.includes(format)) {
    throw new DapiError(
      "invalid-input",
      `The export entry names an unknown format "${format}" — use one of ${supported.replaceAll(".", "")}.`,
    );
  }
  return format;
}

// Imported on demand: the muxers are not part of the main bundle.
async function outputFormat(format: ContainerFormat): Promise<OutputFormat> {
  const { MovOutputFormat, Mp4OutputFormat, OggOutputFormat, WebMOutputFormat } = await import("mediabunny");
  switch (format) {
    case "webm":
      return new WebMOutputFormat();
    case "ogg":
      return new OggOutputFormat();
    case "mov":
      return new MovOutputFormat();
    default:
      return new Mp4OutputFormat();
  }
}

const FALLBACK_VIDEO: Record<ContainerFormat, VideoCodec> = { mp4: "avc", mov: "avc", webm: "vp9", ogg: "vp9" };
const FALLBACK_AUDIO: Record<ContainerFormat, AudioCodec> = { mp4: "aac", mov: "aac", webm: "opus", ogg: "opus" };

// An entry written for MP4 names AAC, which WebM and Ogg can't hold, so codecs the container can't contain
// are swapped for its own (Opus, VP9); the echoed config carries the swap.
async function reconcileCodecs(settings: ExportConfig, format: ContainerFormat): Promise<ExportConfig> {
  const container = await outputFormat(format);
  const video = settings.video?.codec;
  const audio = settings.audio?.codec;
  const videoCodec = video && !container.getSupportedVideoCodecs().includes(video) ? FALLBACK_VIDEO[format] : video;
  const audioCodec = audio && !container.getSupportedAudioCodecs().includes(audio) ? FALLBACK_AUDIO[format] : audio;
  return {
    ...settings,
    ...(videoCodec !== video ? { video: { ...settings.video, codec: videoCodec } } : {}),
    ...(audioCodec !== audio ? { audio: { ...settings.audio, codec: audioCodec } } : {}),
  };
}

export const exportScene: ToolHandler<"export"> = async ({ id, path }, ctx) => {
  const { world, project, engine } = ctx.requireSession();
  const scene = requireScene(world, id, "export");

  // Uses the same `planvideo.export.<id>` entry the export panel writes, so a tool export matches the in-app one.
  const base = world.get(ProjectConfigTrait)?.exportOf(scene) ?? getDefaultExportTemplate();
  const format = resolveFormat(path, { format: base.format, video: base.video, audio: base.audio });
  const settings = await reconcileCodecs({ format, video: base.video, audio: base.audio }, format);
  const key = sceneConfigKey(scene) ?? id;
  const target = path ?? `${project.dir()}/exports/${key.replace(/[^\w.-]+/g, "-")}.${format}`;

  // Fail before the render machinery spins up (same precheck the UI export runs).
  const videoEnabled = format !== "ogg" && settings.video?.enabled !== false;
  const computed = scene.get(Computed);
  const { width, height } = computeOutputSize(
    computed?.width || 1920,
    computed?.height || 1080,
    settings.video?.resolution ?? 1080,
  );
  if (videoEnabled) {
    const codec = settings.video?.codec ?? "avc";
    const encodable = await canEncodeVideo(codec, { width, height, bitrate: settings.video?.bitrate ?? 10e6 });
    if (!encodable) {
      throw new DapiError(
        "unsupported",
        `Cannot encode ${codec.toUpperCase()} at ${width}×${height}. ` +
        "Set a lower resolution, a lower bitrate, or another codec in the scene's export entry.",
      );
    }
  }

  const workarea = scene.get(Workarea);
  const frames = workarea ? workarea.end - workarea.start : computed?.duration ?? 0;
  const duration = frames / (world.get(FrameRate)?.value || 30);

  // renderScene owns the one render slot, so refuse a second export rather than interleave. No await between
  // this check and renderScene claiming the overlay, so two racing requests can't both pass.
  if (renderOverlay()) {
    throw new DapiError("busy", "An export is already running — wait for it to finish, or cancel it in the app.");
  }

  const handle = new ElectronWritableFileHandle(target);
  try {
    const result = await renderScene(engine, {
      scene,
      target: handle,
      config: { ...settings, format },
      dir: project.dir(),
      source: "agent"
    }
    );
    if (result.type === "canceled") {
      throw new DapiError("canceled", "Export canceled in the app");
    }
    if (result.type === "error") {
      throw result.error;
    }
  } catch (error) {
    await handle.dispose().catch(() => { });
    throw error;
  }

  const stat = await mainBridge.call(MAIN_CHANNELS.PROJECTS_FS_STAT, { dir: project.dir(), source: target });

  const config: ExportSettings = { format, video: settings.video, audio: settings.audio };
  return {
    path: target,
    width: videoEnabled ? width : 0,
    height: videoEnabled ? height : 0,
    duration,
    size: stat?.size ?? 0,
    config,
  };
};
