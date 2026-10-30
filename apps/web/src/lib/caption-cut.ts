/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { isUrlSource, type Asset, type Transcript } from "@plan.video/assets";
import {
  AssetId,
  Caption,
  Computed,
  FrameRate,
  Library,
  getSceneAncestor,
  resolveTranscript,
  store,
} from "@plan.video/runtime";

import { cutSceneRanges, type FrameRange } from "@/engine/cut-ranges";
import { getEditHistory } from "@/engine/history";
import { clearCaptionWordSelection } from "@/engine/timeline/caption-word-selection";
import { cutTranscript, mergeRanges, type TimeRange } from "@/lib/caption-edit";
import { captionWritesSettled, saveCaptionTranscript } from "@/lib/caption-transcript";

import type { Entity, World } from "koota";

/** About two frames. */
const MIN_CUT_SECONDS = 0.07;

export interface CutResult {
  count: number;
  /** In seconds. */
  seconds: number;
}

let cutting = false;

/** `ranges` are in `caption`'s transcript seconds. Null when another cut is running or the caption can't be cut by. */
export async function cutByCaption(world: World, caption: Entity, ranges: ReadonlyArray<TimeRange>): Promise<CutResult | null> {
  if (cutting) return null;
  cutting = true;
  try {
    return await cut(world, caption, ranges);
  } finally {
    cutting = false;
  }
}

async function cut(world: World, caption: Entity, ranges: ReadonlyArray<TimeRange>): Promise<CutResult | null> {
  const scene = caption.isAlive() ? getSceneAncestor(caption) : null;
  const library = world.get(Library);
  if (!scene || !library) return null;

  const fps = world.get(FrameRate)?.value ?? 30;
  const computed = store(world, Computed);
  const origin = computed.origin[caption.id()] ?? 0;
  const shown: FrameRange = [computed.start[caption.id()] ?? 0, computed.end[caption.id()] ?? 0];

  // Only where the caption is on: a stretch it doesn't show is not one anybody picked.
  const frames = mergeRanges(
    ranges
      .filter(([from, to]) => to - from >= MIN_CUT_SECONDS)
      .map(([from, to]): TimeRange => [
        Math.max(shown[0], Math.round(origin + from * fps)),
        Math.min(shown[1], Math.round(origin + to * fps)),
      ]),
  );
  if (frames.length === 0) return { count: 0, seconds: 0 };

  // Every caption in the scene hears the same audio, so all follow. Each file once, against the first caption's origin.
  const files = new Map<string, { asset: Asset; origin: number; transcript?: Transcript }>();
  for (const entity of world.query(Caption)) {
    if (getSceneAncestor(entity) !== scene) continue;
    const asset = library.get(entity.get(AssetId)?.value ?? "");
    if (!asset || asset.type !== "TRANSCRIPT" || isUrlSource(asset.source) || files.has(asset.id)) continue;
    files.set(asset.id, { asset, origin: computed.origin[entity.id()] ?? 0 });
  }

  await Promise.all(
    [...files.values()].map(async (file) => {
      await captionWritesSettled(file.asset.id);
      file.transcript = await resolveTranscript(file.asset).catch(() => undefined);
    }),
  );
  if (!caption.isAlive() || !scene.isAlive()) return null;

  // Synchronous from here to the end of the edits: one step of the history.
  cutSceneRanges(world, scene, frames);
  const writes: { asset: Asset; transcript: Transcript }[] = [];
  for (const { asset, origin: fileOrigin, transcript } of files.values()) {
    if (!transcript) continue;
    // A transcript has nothing before its own start, so a cut reaching back past it only takes what it has.
    const own = frames.map(([from, to]): TimeRange => [Math.max(0, (from - fileOrigin) / fps), (to - fileOrigin) / fps]);
    const next = cutTranscript(transcript, own);
    if (next === transcript) continue;
    getEditHistory(world).recordTranscript(asset.id, transcript, next);
    writes.push({ asset, transcript: next });
  }
  // Word numbers point at different words now.
  clearCaptionWordSelection();

  await Promise.all(writes.map(({ asset, transcript }) => saveCaptionTranscript(world, library, asset, transcript, "timeline")));

  const total = frames.reduce((sum, [from, to]) => sum + (to - from), 0);
  return { count: frames.length, seconds: total / fps };
}
