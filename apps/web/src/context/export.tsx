/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createContext, createSignal, useContext, onCleanup, onMount } from "solid-js";
import { toast } from "somoto";
import { canEncodeVideo } from "mediabunny";
import { useWorld } from "@plan.video/koota-solid";
import { computeOutputSize } from "@plan.video/encoder";
import { Computed, Library, getActiveEntity } from "@plan.video/runtime";
import { assert, downloadObject, handOver, isInputTarget, pickSaveFile, saveZip } from "@/utils";
import { t } from "@/lib/i18n";
import { useEngineContext } from "@/engine";
import { useProject } from "@/context/project";
import { useSchedulePost } from "@/components/editor/schedule-post-button";
import { ExportProgress, ExportSaved, type ExportConfig } from "@/components/sidebar-right/inspector/export-progress";
import { renderScene, renderOverlay, cancelRender } from "@/context/render";
import { postableExport } from "@/lib/social-media";
import { sceneCredits, sceneWords } from "@/projects/post-export";
import { collectTimeline } from "@/engine/timeline-export";
import { buildPremiereXml } from "@/lib/timeline-xml";
import {
  MIME_TYPES,
  getDefaultExportTemplate,
} from "@/components/sidebar-right/inspector/export-templates";

import type { Entity } from "koota";
import type { JSX, Accessor } from "solid-js";

type ExportContextValue = {
  exportScene: (scene: Entity, config: ExportConfig) => Promise<void>;
  exportCurrentFrame: () => Promise<void>;
  exportTimeline: (scene: Entity) => Promise<void>;
  exporting: Accessor<boolean>;
};

type SavedExport = { handle: FileSystemFileHandle; scene: Entity; video: boolean; postable: boolean };

const ExportContext = createContext<ExportContextValue>();

export function ExportProvider(props: { children: JSX.Element }) {
  const engine = useEngineContext();
  const world = useWorld();
  const project = useProject();

  const schedulePost = useSchedulePost();
  const exporting = () => !!renderOverlay();
  const [saved, setSaved] = createSignal<SavedExport | null>(null);

  const scheduleSaved = async (file: File) => {
    const current = saved();
    if (!current) return;
    const library = world.get(Library);
    const scene = current.scene.isAlive() ? current.scene : null;
    const credits = library && scene ? sceneCredits(world, library, scene) : [];
    const words = library && scene ? await sceneWords(world, library, scene).catch(() => "") : "";
    setSaved(null);
    schedulePost({ made: { file, credits, words } });
  };

  const exportScene: ExportContextValue["exportScene"] = async (scene, config) => {
    if (!scene?.isAlive()) return;

    const format = config.format ?? "mp4";
    const mimeType = format === "wav" ? "audio/wav" : MIME_TYPES[format];

    // Fail before the save picker: the encoder would only find out after a file was picked.
    const videoEnabled = format !== "ogg" && format !== "wav" && config.video?.enabled !== false;
    if (videoEnabled) {
      const computed = scene.get(Computed);
      const codec = config.video?.codec ?? "avc";
      const { width, height } = computeOutputSize(
        computed?.width || 1920,
        computed?.height || 1080,
        config.video?.resolution ?? 1080,
      );
      const encodable = await canEncodeVideo(codec, {
        width,
        height,
        bitrate: config.video?.bitrate ?? 10e6,
      });
      if (!encodable) {
        toast.error(t("Export not supported"), {
          description: t(
            "This browser cannot encode {codec} at {width}×{height}. Choose a lower resolution, a lower bitrate, or another codec.",
            { codec: codec.toUpperCase(), width, height },
          ),
        });
        return;
      }
    }

    const name = project.name().replace(/\s+/g, "-").toLowerCase();

    let target: FileSystemFileHandle | null;
    try {
      target = await pickSaveFile(`${name}.${format}`, [
        {
          description: format,
          accept: {
            [mimeType]: [`.${format}`],
          } as Record<`${string}/${string}`, `.${string}`[]>,
        },
      ]);
    } catch (e) {
      toast.error(t("Failed to start export"), {
        description: (e as Error).message,
      });
      return;
    }
    if (!target) return;

    try {
      const result = await renderScene(engine, { scene, target, config, source: "ui" });

      if (result.type === "error") {
        console.error("Export failed:", result.error);
        toast.error(t("Export failed"), {
          description: result.error.message,
        });
      } else if (result.type === "success") {
        await handOver(target);
        setSaved({ handle: target, scene, video: videoEnabled, postable: postableExport(config) });
      }
    } catch (e) {
      console.error("Export failed:", e);
      toast.error(t("Export failed"), {
        description: (e as Error).message,
      });
    }
  };

  const exportCurrentFrame: ExportContextValue["exportCurrentFrame"] = async () => {
    const blob = await engine.snapshot();

    if (!blob) {
      toast.error(t("Failed to capture frame"));
      return;
    }

    const projectName = project.name().replace(/\s+/g, "-").toLowerCase();
    await downloadObject(blob, `${projectName}-frame.png`);
  };

  const exportTimeline: ExportContextValue["exportTimeline"] = async (scene) => {
    if (!scene?.isAlive()) return;
    const title = project.name().replace(/[\\/:*?"<>|]+/g, "-").trim() || "video";
    const { timeline, files, leftOut } = collectTimeline(world, scene, title);
    if (timeline.clips.length === 0) {
      toast(t("No clips to hand over"), { description: t("Only video, audio and picture clips go into the timeline.") });
      return;
    }

    const xmlName = `${title}.xml`;
    let parent: FileSystemDirectoryHandle | null = null;
    if ("showDirectoryPicker" in window) {
      try {
        parent = await window.showDirectoryPicker({ id: "timeline-export", mode: "readwrite", startIn: "documents" });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        toast.error(t("Failed to start export"), { description: (e as Error).message });
        return;
      }
    }

    const id = toast.loading(t("Saving the timeline and its media…"));
    try {
      let folderName = title;
      if (parent) {
        for (let n = 2; await parent.getDirectoryHandle(folderName).then(() => true, () => false); n++) folderName = `${title} ${n}`;
        const folder = await parent.getDirectoryHandle(folderName, { create: true });
        const media = await folder.getDirectoryHandle("media", { create: true });
        for (const { name, asset } of files) {
          const source = await asset.handle.getFile();
          const writable = await (await media.getFileHandle(name, { create: true })).createWritable();
          await source.stream().pipeTo(writable);
        }
        const writable = await (await folder.getFileHandle(xmlName, { create: true })).createWritable();
        await writable.write(buildPremiereXml(timeline));
        await writable.close();
      } else {
        folderName = `${title}.zip`;
        const media = await Promise.all(
          files.map(async ({ name, asset }) => ({ name: `${title}/media/${name}`, input: await asset.handle.getFile() })),
        );
        await saveZip(folderName, [...media, { name: `${title}/${xmlName}`, input: buildPremiereXml(timeline) }]);
      }
      toast.success(t("Timeline saved in {folder}", { folder: folderName }), {
        id,
        description: leftOut
          ? t("Import {file} in Premiere Pro or DaVinci Resolve. Text, captions and effects stay in plan.video.", { file: xmlName })
          : t("Import {file} in Premiere Pro or DaVinci Resolve.", { file: xmlName }),
      });
    } catch (e) {
      console.error("Timeline export failed:", e);
      toast.error(t("Export failed"), { id, description: (e as Error).message });
    }
  };

  const exportActiveScene = () => {
    const scene = getActiveEntity(world);
    if (scene === null) {
      return toast(t("No active scene to export"));
    }
    void exportScene(scene, getDefaultExportTemplate());
  };

  // Bound here, not in the engine's shortcut table: export is this provider's command.
  const handleShortcut = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "e") return;
    if (isInputTarget(event)) return;

    event.preventDefault();
    if (event.shiftKey) void exportCurrentFrame();
    else exportActiveScene();
  };

  onMount(() => window.addEventListener("keydown", handleShortcut));
  onCleanup(() => window.removeEventListener("keydown", handleShortcut));

  return (
    <ExportContext.Provider value={{ exportScene, exportCurrentFrame, exportTimeline, exporting }}>
      {props.children}
      <ExportProgress
        open={!!renderOverlay()}
        progress={renderOverlay()?.progress ?? 0}
        remaining={renderOverlay()?.remaining}
        config={renderOverlay()?.config as ExportConfig | undefined}
        width={renderOverlay()?.width ?? 0}
        height={renderOverlay()?.height ?? 0}
        duration={renderOverlay()?.duration ?? 0}
        onCancel={cancelRender}
      />
      <Show when={saved()} keyed>
        {(current) => (
          <ExportSaved
            handle={current.handle}
            video={current.video}
            postable={current.postable}
            onSchedule={scheduleSaved}
            onClose={() => setSaved(null)}
          />
        )}
      </Show>
    </ExportContext.Provider>
  );
}

export function useExport() {
  const ctx = useContext(ExportContext);
  assert(ctx, "useExport must be used within ExportProvider");
  return ctx;
}
