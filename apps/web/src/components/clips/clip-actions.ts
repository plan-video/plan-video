/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A clip becomes an ordinary editor project, which New post, the editor and downloads all use.

import { findProject } from "@/components/publish/project-picker";
import { getDefaultExportTemplate, type ExportConfig } from "@/components/sidebar-right/inspector/export-templates";
import { clipMade, clipPostOptions, type ClipEdit } from "@/lib/clip-studio";
import { frameRateOf } from "@/lib/facecam-find";
import { t } from "@/lib/i18n";
import { fetchStretch, type TwitchVideo } from "@/lib/twitch-clips";
import { projectKey, type ProjectInfo } from "@/projects";
import { createPostProject } from "@/projects/post";
import { exportProjectVideo } from "@/projects/post-export";

export type ClipProject = { project: ProjectInfo; key: string; fps: number | null };

/** Gameplay moves fast: a 60 fps stream keeps its 60 frames a second. */
export function clipExportSettings(fps: number | null): ExportConfig | undefined {
  if (!fps || fps < 45) return undefined;
  const standard = getDefaultExportTemplate();
  return { ...standard, video: { ...standard.video, fps: 60 } };
}

/**
 * The clip's project: the one made before while the clip hasn't changed since, or a new one cut from
 * the full picture. `remember` keeps which project the clip made.
 */
export async function clipProject(
  video: TwitchVideo,
  clip: ClipEdit,
  remember: (made: NonNullable<ClipEdit["project"]>) => void,
  signal?: AbortSignal,
): Promise<ClipProject> {
  const made = clipMade(clip);
  if (clip.project?.made === made) {
    const found = await findProject(clip.project.key);
    if (found) return { project: found, key: clip.project.key, fps: clip.project.fps ?? null };
  }
  const { file, offset } = await fetchStretch(video, clip.start, clip.end, { signal });
  signal?.throwIfAborted();
  const fps = await frameRateOf(file);
  const project = await createPostProject([file], clipPostOptions(clip, offset));
  if (!project) throw new Error(t("Your projects folder couldn't be opened."));
  const key = projectKey(project);
  remember({ key, made, fps });
  return { project, key, fps };
}

/** Renders the clip's project to an MP4 and hands it to the browser to save. */
export async function downloadClip(made: ClipProject, name: string, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<void> {
  const { file } = await exportProjectVideo(made.project, { settings: clipExportSettings(made.fps), onProgress, signal });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "clip"}.mp4`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
