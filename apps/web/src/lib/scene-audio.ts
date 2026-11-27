/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AssetId, Audio, Computed, FrameRate, getAsset, getAssetFile, getEntityTree, getParentNode, getSourceWindow,
  Hidden, isPaintEntity, Muted, Paint, PaintType, readSpeedCurve, timelineOffsetAtSource,
} from "@plan.video/runtime";

import { mergeRanges, type TimeRange } from "@/lib/caption-edit";
import { extractSpeechEnvelope } from "@/lib/clip-audio";
import { soundRanges } from "@/lib/speech-timing";

import type { ClipTiming } from "@/lib/transcribe";
import type { Entity, World } from "koota";

export interface SpeechClip extends ClipTiming {
  file: File;
  /** The asset it plays. */
  asset: string;
}

/** The origin is the scene time of media time 0, where the picture seeks the same moment. */
export function speechClips(world: World, scene: Entity): Promise<SpeechClip[]> {
  return sceneClips(world, scene, "heard");
}

/** The video clips that show, muted or not. */
export function pictureClips(world: World, scene: Entity): Promise<SpeechClip[]> {
  return sceneClips(world, scene, "seen");
}

async function sceneClips(world: World, scene: Entity, want: "heard" | "seen"): Promise<SpeechClip[]> {
  const fps = world.get(FrameRate)?.value || 30;
  const clips: SourcedClip[] = [];
  const heard = want === "heard";

  const found = new Set<Entity>();

  for (const entity of getEntityTree(world, scene)) {
    if (entity === scene || entity.has(Hidden) || (heard && entity.has(Muted)) || !entity.has(AssetId)) continue;
    const paint = entity.get(Paint)?.value;
    if (heard ? !entity.has(Audio) && paint !== PaintType.VIDEO : paint !== PaintType.VIDEO) continue;

    const asset = getAsset(world, entity.get(AssetId)!.value);
    if (!asset || (heard ? asset.type !== "AUDIO" && asset.type !== "VIDEO" : asset.type !== "VIDEO")) continue;

    // A video paint is a child of the clip and keeps the 16s length a new entity starts with;
    // the clip on the timeline is what playback hears. Muted or hidden clips aren't heard
    // through their paint either, and each clip is heard once or every word comes back twice.
    const clip = isPaintEntity(entity) ? getParentNode(entity) ?? entity : entity;
    if (found.has(clip) || (heard && clip.has(Muted)) || clip.has(Hidden)) continue;
    found.add(clip);
    const source = getSourceWindow(clip);
    const computed = clip.get(Computed);
    const curve = readSpeedCurve(clip);
    const originFrames = computed?.origin ?? 0;
    clips.push({
      source: `${asset.id}:${JSON.stringify(curve.keys)}`,
      file: await getAssetFile(asset),
      asset: asset.id,
      origin: originFrames / fps,
      rate: computed?.playbackRate || 1,
      trimStart: source.in / fps,
      trimEnd: Math.max(source.in, source.out) / fps,
      at: curve.keys.length > 0
        ? (mediaSeconds: number) => (originFrames + timelineOffsetAtSource(curve, mediaSeconds * fps)) / fps
        : undefined,
    });
  }

  return oncePerMoment(clips).map(({ source: _, ...clip }) => clip);
}

type SourcedClip = SpeechClip & { source: string };

/** A layout's copies show the same video at the same moments; scanning each would find everything twice. */
export function oncePerMoment<T extends ClipTiming & { source: string }>(clips: T[]): T[] {
  const kept: T[] = [];
  for (const clip of clips) {
    const twin = kept.find((other) =>
      other.source === clip.source && other.origin === clip.origin && (other.rate || 1) === (clip.rate || 1)
      && other.trimStart <= clip.trimEnd && clip.trimStart <= other.trimEnd);
    if (!twin) {
      kept.push({ ...clip });
      continue;
    }
    twin.trimStart = Math.min(twin.trimStart, clip.trimStart);
    twin.trimEnd = Math.max(twin.trimEnd, clip.trimEnd);
  }
  return kept;
}

/** In scene seconds. Null when no clip's audio could be read. */
export async function sceneSound(world: World, scene: Entity): Promise<TimeRange[] | null> {
  const clips = await speechClips(world, scene);
  const heard = await Promise.all(clips.map(async (clip) => {
    const audio = await extractSpeechEnvelope(clip.file, clip.trimStart, clip.trimEnd).catch(() => null);
    return audio && clipSound(clip, audio.mediaStart, soundRanges(audio.envelope));
  }));
  const read = heard.filter((ranges) => ranges !== null);
  return read.length > 0 ? mergeRanges(read.flat()) : null;
}

/** `ranges` in seconds from `mediaStart`, as the envelope counts them. */
function clipSound(clip: ClipTiming, mediaStart: number, ranges: ReadonlyArray<TimeRange>): TimeRange[] {
  const scene = (media: number) => (clip.at ? clip.at(media) : clip.origin + media / (clip.rate || 1));
  return ranges.flatMap(([from, to]): TimeRange[] => {
    const media0 = Math.max(clip.trimStart, mediaStart + from);
    const media1 = Math.min(clip.trimEnd, mediaStart + to);
    return media1 > media0 ? [[scene(media0), scene(media1)]] : [];
  });
}
