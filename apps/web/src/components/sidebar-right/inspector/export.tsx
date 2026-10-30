/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, children, createMemo, createResource } from "solid-js";
import DownloadIcon from "lucide-solid/icons/download";
import RotateCcwIcon from "lucide-solid/icons/rotate-ccw";
import { canEncodeVideo } from "mediabunny";
import { computeOutputSize } from "@plan.video/encoder";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ControlRow } from "@/components/ui/control-group";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorSeparator,
} from "@/components/ui/floating-inspector";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch, SwitchControl, SwitchInput, SwitchThumb } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { SliderInput } from "@/components/ui/slider-input";
import { formatBytes, formatDuration } from "@/utils/formatters";
import { settled } from "@/utils/signal";
import { useTrait, useWorld } from "@plan.video/koota-solid";
import { Computed, FrameRate, Source } from "@plan.video/runtime";
import { useDerived } from "@/engine/hooks";
import { useProjectConfig } from "@/engine/project-config";
import { useExport } from "@/context/export";
import { t } from "@/lib/i18n";
import {
  DEFAULT_EXPORT_TEMPLATE_ID,
  TEMPLATE_BY_ID,
  RESOLUTION_OPTIONS,
  VIDEO_CODEC_OPTIONS,
  VIDEO_FORMAT_OPTIONS,
  FRAME_RATE_OPTIONS,
  AUDIO_CODEC_OPTIONS,
  SAMPLE_RATE_OPTIONS,
} from "./export-templates";

import type { Entity } from "koota";
import type { JSX } from "solid-js";
import type { VideoCodec, AudioCodec } from "mediabunny";
import type { ContainerFormat, ExportConfig as ProjectExportConfig } from "@/engine/project-config";
import type { ExportConfig } from "./export-templates";

type ResolutionOption = {
  resolution: number;
  width: number;
  height: number;
  native: boolean;
};

function resolutionTag(option: ResolutionOption): string {
  return option.native ? t("Original") : `${option.resolution}p`;
}

function resolutionLabel(option: ResolutionOption | null | undefined): string {
  if (!option) return "";
  return `${option.width}×${option.height} · ${resolutionTag(option)}`;
}

/** Every field, so it replaces what was there. */
function templateSettings(id: string): ProjectExportConfig | null {
  const template = TEMPLATE_BY_ID.get(id);
  if (!template) return null;
  return {
    template: id,
    format: template.format,
    video: template.video && { ...template.video },
    audio: template.audio && { ...template.audio },
  };
}

export function defaultExportSettings(): ProjectExportConfig {
  return templateSettings(DEFAULT_EXPORT_TEMPLATE_ID)!;
}

// Read and written through the project config (package.json `planvideo.export.<scene id>`), so every
// place that shows the settings reads the same accessor and never disagrees.
function useSceneExport(entity: () => Entity) {
  const world = useWorld();
  const config = useProjectConfig();
  const { exportScene, exporting } = useExport();

  const source = useTrait(() => entity(), Source);
  const settings = createMemo(() => {
    source();
    return config()?.exportOf(entity()) ?? undefined;
  });
  const effective = createMemo(() => settings() ?? defaultExportSettings());
  const frameRate = useTrait(world, FrameRate);
  const duration = useDerived(() => entity().get(Computed)?.duration ?? 0);
  const durationInSeconds = createMemo(() => duration() / (frameRate()?.value ?? 30));
  const sceneWidth = useDerived(() => entity().get(Computed)?.width || 1920);
  const sceneHeight = useDerived(() => entity().get(Computed)?.height || 1080);

  const resolutionOptions = createMemo<ResolutionOption[]>(() => {
    const w = sceneWidth();
    const h = sceneHeight();
    // A resolution names the output's shorter side (for a vertical scene, its width), so a portrait scene still offers 720p–4K.
    const shortSide = Math.min(w, h);
    return [...new Set([...RESOLUTION_OPTIONS, shortSide])].sort((a, b) => a - b).map((resolution) => ({
      resolution,
      ...computeOutputSize(w, h, resolution),
      native: resolution === shortSide,
    }));
  });

  const selectedResolution = createMemo(() => {
    const resolution = effective().video?.resolution ?? 1080;
    const match = resolutionOptions().find((option) => option.resolution === resolution);
    if (match) return match;
    const w = sceneWidth();
    const h = sceneHeight();
    return { resolution, ...computeOutputSize(w, h, resolution), native: resolution === Math.min(w, h) };
  });

  const [encodable] = createResource(
    () => {
      const current = effective();
      const size = selectedResolution();
      if (!current || !size) return undefined;
      if (current.format === "ogg" || current.video?.enabled === false) return undefined;
      return {
        codec: current.video?.codec ?? ("avc" as const),
        bitrate: current.video?.bitrate ?? 10e6,
        width: size.width,
        height: size.height,
      };
    },
    ({ codec, bitrate, width, height }) => canEncodeVideo(codec, { width, height, bitrate }),
  );

  // Audio-only exports always encode
  const exportSupported = createMemo(() => {
    const current = effective();
    if (!current || current.format === "ogg" || current.video?.enabled === false) return true;
    return settled(encodable) !== false;
  });

  const write = (value: ProjectExportConfig | null) => {
    void config()?.setExport(entity(), value);
  };

  const applyTemplate = (id: string) => {
    const next = templateSettings(id);
    if (next) write(next);
  };

  const patchSettings = (patch: ExportConfig) => {
    const current = effective();
    if (!current) return;
    write({
      ...current,
      ...patch,
      video: patch.video ? { ...current.video, ...patch.video } : current.video,
      audio: patch.audio ? { ...current.audio, ...patch.audio } : current.audio,
    });
  };

  // `template` is the panel's own label, no part of how the file is made.
  const runExport = () => {
    const current = effective();
    if (!current) return;
    void exportScene(entity(), {
      format: current.format,
      video: current.video,
      audio: current.audio,
    });
  };

  const estimatedFileSize = createMemo(() => {
    const size = selectedResolution();
    return estimateFileSize(effective(), durationInSeconds(), size ? size.width * size.height : undefined);
  });

  return {
    settings,
    effective,
    resolutionOptions,
    selectedResolution,
    exportSupported,
    exporting,
    durationInSeconds,
    estimatedFileSize,
    applyTemplate,
    patchSettings,
    reset: () => write(null),
    runExport,
  };
}

type SceneExport = ReturnType<typeof useSceneExport>;

function RunExportButton(props: { scene: SceneExport; onClick?: () => void }) {
  const run = () => {
    props.onClick?.();
    props.scene.runExport();
  };

  return (
    <Tooltip disabled={props.scene.exportSupported()}>
      <TooltipTrigger as="div" class="w-full">
        <Button variant="secondary" class="w-full gap-1.5" onClick={run} disabled={props.scene.exporting() || !props.scene.exportSupported()}>
          <DownloadIcon class="size-3.5" stroke-width={2} />
          {t("Export")}
        </Button>
      </TooltipTrigger>
      <TooltipContent class="max-w-64">
        {t("This browser cannot encode {codec} at {width}×{height}. Choose a lower resolution, a lower bitrate, or another codec.", {
          codec: (props.scene.effective().video?.codec ?? "avc").toUpperCase(),
          width: props.scene.selectedResolution()?.width,
          height: props.scene.selectedResolution()?.height,
        })}
      </TooltipContent>
    </Tooltip>
  );
}

export function ExportSettingsDialog(props: { scene: Entity; anchorRef: HTMLElement | undefined; onClose: () => void }) {
  const scene = useSceneExport(() => props.scene);

  return (
    <ExportInspector
      settings={scene.effective()}
      resolutionOptions={scene.resolutionOptions()}
      selectedResolution={scene.selectedResolution()}
      anchorRef={props.anchorRef}
      onClose={props.onClose}
      onSelectTemplate={scene.applyTemplate}
      onPatch={scene.patchSettings}
      onReset={scene.settings() ? scene.reset : undefined}
      footer={
        <div class="flex flex-col gap-2">
          <div class="flex justify-between items-center h-5 px-2">
            <span class="text-base text-muted-foreground">
              {t("Duration {duration}", { duration: formatDuration(scene.durationInSeconds()) })}
            </span>
            <span class="text-base text-muted-foreground">
              {t("File size {size}", { size: formatBytes(scene.estimatedFileSize()) })}
            </span>
          </div>
          <RunExportButton scene={scene} onClick={props.onClose} />
        </div>
      }
    />
  );
}

type ExportInspectorProps = {
  settings: ProjectExportConfig;
  resolutionOptions: ResolutionOption[];
  selectedResolution: ResolutionOption | null;
  anchorRef: HTMLElement | undefined;
  onClose: () => void;
  onSelectTemplate: (id: string) => void;
  onPatch: (patch: ExportConfig) => void;
  onReset?: () => void;
  footer?: JSX.Element;
};

function ExportInspector(props: ExportInspectorProps) {
  const config = () => props.settings;
  const templateId = () => props.settings.template ?? "";

  const write = props.onPatch;
  // Resolved once: a JSX prop is built anew on every read.
  const footer = children(() => props.footer);

  return (
    <FloatingInspector open anchorRef={props.anchorRef} width={272}>
      <FloatingInspectorHeader class="items-center justify-between px-2">
        <Select
          value={templateId()}
          options={Array.from(TEMPLATE_BY_ID.keys())}
          onChange={(value) => value && props.onSelectTemplate(value)}
          itemComponent={(itemProps) => {
            const template = TEMPLATE_BY_ID.get(itemProps.item.rawValue);
            return <SelectItem item={itemProps.item}>{template?.name}</SelectItem>;
          }}
        >
          <SelectTrigger>
            <SelectValue>
              {TEMPLATE_BY_ID.get(templateId())?.name ?? t("Custom")}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent />
          </SelectPortal>
        </Select>
        <div class="flex items-center">
          <Show when={props.onReset}>
            {(reset) => (
              <Tooltip>
                <TooltipTrigger
                  as={Button}
                  size="icon"
                  variant="ghost"
                  class="text-muted-foreground"
                  onClick={() => reset()()}
                >
                  <RotateCcwIcon class="size-3.5" stroke-width={2} />
                </TooltipTrigger>
                <TooltipContent>{t("Reset to default")}</TooltipContent>
              </Tooltip>
            )}
          </Show>
          <Tooltip>
            <TooltipTrigger
              as={Button}
              size="icon"
              variant="ghost"
              class="text-muted-foreground"
              onClick={() => props.onClose()}
            >
              <Icon name="close-remove" />
            </TooltipTrigger>
            <TooltipContent>{t("Close")}</TooltipContent>
          </Tooltip>
        </div>
      </FloatingInspectorHeader>
      <FloatingInspectorSeparator />
      <FloatingInspectorContent class="p-4">
        <div class="flex flex-col gap-2">
          <ControlRow label={t("Video")}>
            <Switch
              checked={config().video?.enabled != false}
              onChange={(checked) => write({ video: { enabled: checked } })}
            >
              <SwitchInput />
              <SwitchControl variant="compact">
                <SwitchThumb variant="compact" />
              </SwitchControl>
            </Switch>
          </ControlRow>
          <div
            class="flex flex-col gap-2 transition-opacity"
            classList={{
              "opacity-50": config().video?.enabled == false,
              "pointer-events-none": config().video?.enabled == false,
            }}
          >
            <ControlRow label={t("Resolution")}>
              <Select<ResolutionOption>
                value={props.selectedResolution ?? undefined}
                options={props.resolutionOptions}
                optionValue="resolution"
                optionTextValue={resolutionLabel}
                onChange={(value) => value && write({ video: { resolution: value.resolution } })}
                itemComponent={(itemProps) => {
                  const option = itemProps.item.rawValue;
                  return (
                    <SelectItem item={itemProps.item}>
                      <div class="flex min-w-0 flex-1 items-center">
                        <span>{option.width}×{option.height}</span>
                        <span class="ml-auto pl-3 text-xxs text-muted-foreground group-[[data-highlighted]]:text-[inherit]">
                          {resolutionTag(option)}
                        </span>
                      </div>
                    </SelectItem>
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue<ResolutionOption>>
                    <Show when={props.selectedResolution}>
                      {(selected) => (
                        <>
                          <span>{selected().width}×{selected().height}</span>
                          <span class="ml-auto text-xxs text-muted-foreground">
                            {resolutionTag(selected())}
                          </span>
                        </>
                      )}
                    </Show>
                  </SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label={t("Bitrate")}>
              <SliderInput
                value={(config().video?.bitrate ?? 10e6) / 1e6}
                onChange={(value) => write({ video: { bitrate: value * 1e6 } })}
                min={0.1}
                max={120}
                step={1}
              />
            </ControlRow>
            <ControlRow label={t("Codec")}>
              <Select
                value={config().video?.codec ?? "avc"}
                options={[...VIDEO_CODEC_OPTIONS]}
                onChange={(value) => value && write({ video: { codec: value } })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue.toUpperCase()}</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{(config().video?.codec ?? "avc").toUpperCase()}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label={t("Format")}>
              <Select
                value={config().format ?? "mp4"}
                options={[...VIDEO_FORMAT_OPTIONS]}
                onChange={(value) => value && write({ format: value })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue.toUpperCase()}</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{(config().format ?? "mp4").toUpperCase()}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label={t("Frame rate")}>
              <Select
                value={config().video?.fps ?? 30}
                options={[...FRAME_RATE_OPTIONS]}
                onChange={(value) => value && write({ video: { fps: value } })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue} FPS</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{config().video?.fps ?? 30} FPS</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
          </div>
        </div>

        <Separator class="my-3" />

        <div class="flex flex-col gap-2">
          <ControlRow label={t("Audio")}>
            <Switch
              checked={config().audio?.enabled != false}
              onChange={(checked) => write({ audio: { enabled: checked } })}
            >
              <SwitchInput />
              <SwitchControl variant="compact">
                <SwitchThumb variant="compact" />
              </SwitchControl>
            </Switch>
          </ControlRow>
          <div
            class="flex flex-col gap-2 transition-opacity"
            classList={{
              "opacity-50": config().audio?.enabled == false,
              "pointer-events-none": config().audio?.enabled == false,
            }}
          >
            <ControlRow label={t("Codec")}>
              <Select
                value={config().audio?.codec ?? "aac"}
                options={[...AUDIO_CODEC_OPTIONS]}
                onChange={(value) => value && write({ audio: { codec: value } })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue.toUpperCase()}</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{(config().audio?.codec ?? "aac").toUpperCase()}</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
            <ControlRow label={t("Sample rate")}>
              <Select
                value={config().audio?.sampleRate ?? 48000}
                options={[...SAMPLE_RATE_OPTIONS]}
                onChange={(value) => value && write({ audio: { sampleRate: value } })}
                itemComponent={(itemProps) => (
                  <SelectItem item={itemProps.item}>{itemProps.item.rawValue / 1000} kHz</SelectItem>
                )}
              >
                <SelectTrigger>
                  <SelectValue>{(config().audio?.sampleRate ?? 48000) / 1000} kHz</SelectValue>
                </SelectTrigger>
                <SelectPortal>
                  <SelectContent />
                </SelectPortal>
              </Select>
            </ControlRow>
          </div>
        </div>
      </FloatingInspectorContent>
      <Show when={footer()}>
        <FloatingInspectorSeparator />
        <div class="p-2">{footer()}</div>
      </Show>
    </FloatingInspector>
  );
}

const DEFAULT_ESTIMATE_VIDEO_BITRATE = 10e6;
const DEFAULT_ESTIMATE_AUDIO_BITRATE = 128e3;
const DEFAULT_ESTIMATE_RESOLUTION = 1080;
const DEFAULT_ESTIMATE_PIXELS = 1920 * 1080;
const DEFAULT_ESTIMATE_FRAME_RATE = 30;

const VIDEO_CODEC_SIZE_FACTORS: Partial<Record<VideoCodec, number>> = {
  avc: 1,
  hevc: 0.72,
  vp9: 0.82,
  av1: 0.65,
  vp8: 1.15,
};

const AUDIO_CODEC_SIZE_FACTORS: Partial<Record<AudioCodec, number>> = {
  aac: 1,
  opus: 0.78,
};

const CONTAINER_SIZE_FACTORS: Record<ContainerFormat, number> = {
  mp4: 1,
  webm: 0.96,
  ogg: 0.93,
  mov: 1.03,
};

function estimateFileSize(config?: ExportConfig, duration?: number, outputPixels?: number) {
  if (!duration || duration <= 0) return 0;

  const format = config?.format ?? "mp4";
  const videoEnabled = format === "ogg" ? false : config?.video?.enabled !== false;
  const audioEnabled = format === "ogg" ? true : config?.audio?.enabled !== false;

  const videoBitrate = config?.video?.bitrate ?? DEFAULT_ESTIMATE_VIDEO_BITRATE;
  const audioBitrate = config?.audio?.bitrate ?? DEFAULT_ESTIMATE_AUDIO_BITRATE;

  const resolution = Math.max(config?.video?.resolution ?? DEFAULT_ESTIMATE_RESOLUTION, 1);
  const fps = Math.max(config?.video?.fps ?? DEFAULT_ESTIMATE_FRAME_RATE, 1);

  const videoCodec = config?.video?.codec ?? "avc";
  const audioCodec = config?.audio?.codec ?? (format === "webm" || format === "ogg" ? "opus" : "aac");

  const videoCodecFactor = VIDEO_CODEC_SIZE_FACTORS[videoCodec] ?? 1;
  const audioCodecFactor = AUDIO_CODEC_SIZE_FACTORS[audioCodec] ?? 1;
  const containerFactor = CONTAINER_SIZE_FACTORS[format];

  // Scaled by pixel count when the output size is known (for 16:9 the two agree); the height-only
  // fallback stays for callers with nothing but the config.
  const resolutionFactor = outputPixels
    ? Math.pow(outputPixels / DEFAULT_ESTIMATE_PIXELS, 0.54)
    : Math.pow(resolution / DEFAULT_ESTIMATE_RESOLUTION, 1.08);
  const frameRateFactor = fps / DEFAULT_ESTIMATE_FRAME_RATE;

  const effectiveVideoBitrate =
    videoBitrate * resolutionFactor * frameRateFactor * videoCodecFactor * containerFactor;
  const effectiveAudioBitrate = audioBitrate * audioCodecFactor * containerFactor;

  const totalBitrate =
    (videoEnabled ? effectiveVideoBitrate : 0) + (audioEnabled ? effectiveAudioBitrate : 0);

  return (duration * totalBitrate) / 8;
}
