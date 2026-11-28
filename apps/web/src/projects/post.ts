/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AssetLibrary } from "@plan.video/assets";

import { importFiles } from "@/engine/asset-actions";
import { generateProjectName } from "@/lib/db";
import { t } from "@/lib/i18n";
import { POST_CAMERA, buildPost, type PostClip, type PostNode } from "@/lib/post-builder";
import type { Crops } from "@/lib/stream-layouts";

import { writeBrowserComposition, type SavedNode } from "./composition";
import { createBrowserProjectFS } from "./browser";
import { createProject, ensureProjectsRoot } from "./host";

import type { Transcript } from "@plan.video/assets";
import type { CaptionPreset, TextLookName } from "@plan.video/jsx";
import type { ProjectInfo } from "./types";

export type PostOptions = {
  layoutId: string;
  captions: CaptionPreset | null;
  captionsLook?: TextLookName;
  /** A line shown big over the first seconds. */
  hook?: string;
  /** Per file: the stretch of it to use, in seconds. */
  trims?: ({ start: number; duration: number } | undefined)[];
  /** What's said, timed on the finished post, so the captions need no transcribing. */
  transcript?: Transcript;
  /** Crops found for the clips, as fractions of the source. */
  crops?: Crops;
};

const CLIPS_FOLDER = "clips";
const CAPTIONS_FOLDER = "captions";

function toSaved(entry: PostNode, next: () => string): SavedNode {
  return {
    tag: entry.tag,
    props: entry.props,
    ...(entry.text !== undefined ? { text: entry.text } : {}),
    source: next(),
    children: entry.children.map((child) => toSaved(child, next)),
  };
}

/** Clips import one at a time to keep their order; non-video files are left out. Null with no projects folder. */
export async function createPostProject(files: ReadonlyArray<File>, options: PostOptions): Promise<ProjectInfo | null> {
  if (!(await ensureProjectsRoot())) return null;

  const name = generateProjectName();
  const project = await createProject(name);

  const library = new AssetLibrary(createBrowserProjectFS(project.dir));
  const clips: PostClip[] = [];
  let captionsSrc: string | undefined;
  try {
    await library.load();
    for (const [index, file] of files.entries()) {
      const [asset] = await importFiles(library, [file], CLIPS_FOLDER);
      if (asset?.type !== "VIDEO") continue;
      const trim = options.trims?.[index];
      const sourceIn = trim ? Math.min(Math.max(0, trim.start), asset.duration) : 0;
      const duration = trim ? Math.min(trim.duration, asset.duration - sourceIn) : asset.duration;
      clips.push({ src: asset.path, width: asset.width, height: asset.height, duration, ...(sourceIn ? { sourceIn } : {}) });
    }
    if (options.transcript?.length && clips.length) {
      const file = new File([JSON.stringify(options.transcript)], `${name}.json`, { type: "application/json" });
      const [asset] = await importFiles(library, [file], CAPTIONS_FOLDER);
      if (asset?.type === "TRANSCRIPT") captionsSrc = asset.path;
    }
  } finally {
    await library.dispose();
  }
  if (!clips.length) throw new Error(t("None of the files could be read as video."));

  const scene = buildPost({ name, clips, layoutId: options.layoutId, captions: options.captions, captionsLook: options.captionsLook, captionsSrc, crops: options.crops, hook: options.hook });

  let stamp = 0;
  await writeBrowserComposition(project.dir, {
    version: 1,
    camera: [...POST_CAMERA],
    children: [toSaved(scene, () => `index.tsx:s${++stamp}`)],
  });
  return project;
}
