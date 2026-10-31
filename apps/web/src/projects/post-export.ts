/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Rendered without the editor: nothing is drawn on screen and nothing is written
// into the project's folder.

import { createEncoder } from "@plan.video/encoder";
import { mount } from "@plan.video/reconciler";
import { isUrlSource } from "@plan.video/assets";
import {
  AssetId,
  Computed,
  FrameRate,
  Hidden,
  Root,
  createRuntimeWorld,
  getActiveEntity,
  getEntityChildren,
  isCaption,
  resolveTranscript,
  store,
} from "@plan.video/runtime";

import { createCapture } from "@/engine/capture";
import { attachLibrary } from "@/engine/library";
import { getDefaultExportTemplate } from "@/components/sidebar-right/inspector/export-templates";
import { t } from "@/lib/i18n";
import { attachAi } from "@/utils/gen-ai";
import { version } from "../../package.json";

import { compileProject } from "./host";

import type { AssetLibrary } from "@plan.video/assets";
import type { Entity, World } from "koota";

import type { Capture } from "@/engine/capture";
import type { ProjectInfo } from "@/projects/types";

export type PostExportOptions = {
  onProgress?(percent: number): void;
  signal?: AbortSignal;
};

export type PostExport = {
  file: File;
  credits: string[];
  words: string;
};

const canceled = () => new DOMException("The export was canceled", "AbortError");

// Default export settings (H.264 + AAC, 1080p), not the scene's own: those are for the
// editor's saved file and may name a container a platform turns away.
export async function exportProjectVideo(project: ProjectInfo, options: PostExportOptions = {}): Promise<PostExport> {
  const { signal, onProgress } = options;
  const dir = project.dir;
  const world = createRuntimeWorld(project.id || project.name);
  const library = attachLibrary(world, dir);
  attachAi(world, library);

  let mounted: { dispose(): void } | undefined;
  let capture: Capture | undefined;
  try {
    const [result] = await Promise.all([compileProject(dir), library.load()]);
    if (!result.ok) throw new Error(result.error);
    if (signal?.aborted) throw canceled();

    mounted = mount(result.code, world);
    const root = world.get(Root);
    const scene = getActiveEntity(world) ?? (root ? getEntityChildren(world, root)[0] : undefined);
    if (!scene) throw new Error(t("The project is empty. Add a clip to it in the editor, and it exports from there."));

    const template = getDefaultExportTemplate();
    capture = await createCapture(world, scene, { frameRate: template.video?.fps, mode: "offline-video" });
    if (signal?.aborted) throw canceled();

    const encoder = await createEncoder(capture.world, {
      format: "mp4",
      video: template.video,
      audio: template.audio,
      comment: `Made with Plan Video v${version}`,
      onProgress: (progress) => onProgress?.(Math.round((progress.progress / progress.total) * 100)),
    });
    signal?.addEventListener("abort", () => encoder.cancel(), { once: true });

    const rendered = await encoder.render();
    if (rendered.type === "canceled") throw canceled();
    if (rendered.type === "error") throw rendered.error;
    if (!rendered.data) throw new Error(t("The export came out empty"));

    const name = `${(project.displayName || project.name).replace(/[\\/:*?"<>|]+/g, "-").trim() || "video"}.mp4`;
    const file = new File([rendered.data], name, { type: "video/mp4", lastModified: Date.now() });
    // The capture's copy of the scene is the one its assets were bound in.
    return {
      file,
      credits: sceneCredits(capture.world, library, capture.node),
      words: await sceneWords(capture.world, library, capture.node),
    };
  } finally {
    capture?.dispose();
    mounted?.dispose();
    void library.dispose();
    world.destroy();
  }
}

function sceneCredits(world: World, library: AssetLibrary, scene: Entity): string[] {
  const credits = new Set<string>();
  const visit = (entity: Entity) => {
    const id = entity.get(AssetId)?.value;
    const credit = id ? library.get(id)?.credit : undefined;
    if (credit) credits.add(credit);
    for (const child of getEntityChildren(world, entity)) visit(child);
  };
  visit(scene);
  return [...credits];
}

async function sceneWords(world: World, library: AssetLibrary, scene: Entity): Promise<string> {
  const captions: Entity[] = [];
  const visit = (entity: Entity) => {
    if (entity.has(Hidden)) return;
    if (isCaption(entity)) captions.push(entity);
    for (const child of getEntityChildren(world, entity)) visit(child);
  };
  visit(scene);
  if (!captions.length) return "";

  const fps = world.get(FrameRate)?.value ?? 30;
  const computed = store(world, Computed);
  const shown: { frame: number; text: string }[] = [];
  for (const caption of captions) {
    const id = caption.get(AssetId)?.value;
    const asset = id ? library.get(id) : undefined;
    if (!asset || asset.type !== "TRANSCRIPT" || isUrlSource(asset.source)) continue;
    const transcript = await resolveTranscript(asset).catch(() => []);
    const origin = computed.origin[caption.id()] ?? 0;
    const from = computed.start[caption.id()] ?? 0;
    const to = computed.end[caption.id()] ?? Infinity;
    for (const segment of transcript) {
      for (const word of segment.words) {
        const frame = origin + word.start * fps;
        if (frame >= from && frame <= to && word.text.trim()) shown.push({ frame, text: word.text.trim() });
      }
    }
  }
  return shown
    .sort((a, b) => a.frame - b.frame)
    .map((word) => word.text)
    .join(" ");
}
