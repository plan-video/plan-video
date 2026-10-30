/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A new project made from clips in one go: the clips go into its library, and
// the post built from them becomes its composition before the editor opens it.

import { AssetLibrary } from "@plan.video/assets";

import { importFiles } from "@/engine/asset-actions";
import { generateProjectName } from "@/lib/db";
import { t } from "@/lib/i18n";
import { POST_CAMERA, buildPost, postSource, type PostClip, type PostNode } from "@/lib/post-builder";

import { writeBrowserComposition, type SavedNode } from "./composition";
import { createProjectFS } from "./fs";
import { createProject, ensureProjectsRoot, isDesktop } from "./host";

import type { CaptionPreset } from "@plan.video/jsx";
import type { ProjectInfo } from "@desktop/main-channels";

export type PostOptions = {
  layoutId: string;
  captions: CaptionPreset | null;
};

const CLIPS_FOLDER = "clips";

function toSaved(entry: PostNode, next: () => string): SavedNode {
  return {
    tag: entry.tag,
    props: entry.props,
    source: next(),
    children: entry.children.map((child) => toSaved(child, next)),
  };
}

/**
 * Creates a project holding `files` as a post. Clips are imported one at a
 * time so the post keeps the order they were given in; a file that is not a
 * video is left out. Null when there is no projects folder to put it in.
 */
export async function createPostProject(files: ReadonlyArray<File>, options: PostOptions): Promise<ProjectInfo | null> {
  if (!(await ensureProjectsRoot())) return null;

  const name = generateProjectName();
  const project = await createProject(name);

  const library = new AssetLibrary(createProjectFS(project.dir));
  const clips: PostClip[] = [];
  try {
    await library.load();
    for (const file of files) {
      const [asset] = await importFiles(library, [file], CLIPS_FOLDER);
      if (asset?.type !== "VIDEO") continue;
      clips.push({ src: asset.path, width: asset.width, height: asset.height, duration: asset.duration });
    }
  } finally {
    await library.dispose();
  }
  if (!clips.length) throw new Error(t("None of the files could be read as video."));

  const scene = buildPost({ name, clips, layoutId: options.layoutId, captions: options.captions });

  if (isDesktop()) {
    await library.fs.write(project.entry, new Blob([postSource(scene)], { type: "text/plain" }));
  } else {
    let stamp = 0;
    await writeBrowserComposition(project.dir, {
      version: 1,
      camera: [...POST_CAMERA],
      children: [toSaved(scene, () => `index.tsx:s${++stamp}`)],
    });
  }
  return project;
}
