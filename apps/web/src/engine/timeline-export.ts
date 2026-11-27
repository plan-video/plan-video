/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  AssetId,
  Audio,
  Cache,
  Computed,
  FrameRate,
  Geometry,
  Group,
  Hidden,
  IsMask,
  Library,
  MediaCrop,
  Muted,
  Name,
  Paint,
  PaintType,
  ScaleMode,
  ScaleModeType,
  Volume,
  Workarea,
  WorldTransform,
  getEntityChildren,
  getIntrinsicPaint,
  getSourceWindow,
  invert2D,
  isGroupLike,
  multiply2D,
} from "@plan.video/runtime";

import { clampClip, premiereFraming, type ScaleFit, type Timeline, type TimelineClip, type TimelineMedia } from "@/lib/timeline-xml";

import type { Asset } from "@plan.video/assets";
import type { Entity, World } from "koota";

export type TimelineExport = {
  timeline: Timeline;
  /** Each file to copy into `media/`, under the name the XML gives it. */
  files: { name: string; asset: Asset }[];
  /** Text, captions, shapes or effects were left out: only media clips carry over. */
  leftOut: boolean;
};

const FITS: Record<number, ScaleFit> = {
  [ScaleModeType.COVER]: "cover",
  [ScaleModeType.FILL]: "fill",
  [ScaleModeType.FIT]: "fit",
  [ScaleModeType.NONE]: "none",
};

// eslint-disable-next-line no-control-regex -- file names can hold control characters
const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim() || "media";

/** The entity whose AssetId draws `entity`: itself, or its first visible video or image fill. */
function visualSource(entity: Entity): { source: Entity; paint: PaintType } | null {
  const intrinsic = getIntrinsicPaint(entity);
  if ((intrinsic === PaintType.VIDEO || intrinsic === PaintType.IMAGE) && entity.get(AssetId)?.value) {
    return { source: entity, paint: intrinsic };
  }
  for (const fill of entity.get(Cache)?.fills ?? []) {
    const paint = fill.get(Paint)?.value;
    if (fill.has(Hidden) || !fill.get(AssetId)?.value) continue;
    if (paint === PaintType.VIDEO || paint === PaintType.IMAGE) return { source: fill, paint };
  }
  return null;
}

const matrixOf = (entity: Entity) => {
  const m = entity.get(WorldTransform);
  return m ? { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f } : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
};

/** The scene's media clips as a timeline other editors can open, at the playhead's framing. */
export function collectTimeline(world: World, scene: Entity, name: string): TimelineExport {
  const library = world.get(Library);
  const fps = world.get(FrameRate)?.value ?? 30;
  const sceneComputed = scene.get(Computed);
  const width = sceneComputed?.width || 1920;
  const height = sceneComputed?.height || 1080;
  const sceneEnd = sceneComputed?.end ?? 0;
  const workarea = scene.get(Workarea);
  const from = workarea ? Math.max(0, Math.min(sceneEnd, workarea.start)) : 0;
  const to = workarea ? Math.max(from, Math.min(sceneEnd, workarea.end || sceneEnd)) : sceneEnd;
  const toScene = invert2D(matrixOf(scene));

  const media = new Map<string, TimelineMedia>();
  const files: TimelineExport["files"] = [];
  const taken = new Set<string>();
  const clips: TimelineClip[] = [];
  let leftOut = false;

  const mediaFor = (asset: Asset, kind: TimelineMedia["kind"]): TimelineMedia => {
    const existing = media.get(asset.id);
    if (existing) return existing;
    const base = safeName(asset.path.split("/").pop() ?? asset.id);
    const dot = base.lastIndexOf(".");
    let file = base;
    for (let n = 2; taken.has(file.toLowerCase()); n++) file = dot > 0 ? `${base.slice(0, dot)} ${n}${base.slice(dot)}` : `${base} ${n}`;
    taken.add(file.toLowerCase());
    files.push({ name: file, asset });
    const entry: TimelineMedia = {
      id: String(media.size + 1),
      file,
      kind,
      seconds: asset.type === "VIDEO" || asset.type === "AUDIO" ? asset.duration : 0,
      width: asset.type === "VIDEO" || asset.type === "IMAGE" ? asset.width : undefined,
      height: asset.type === "VIDEO" || asset.type === "IMAGE" ? asset.height : undefined,
      frameRate: asset.type === "VIDEO" ? asset.frameRate : undefined,
      channels: asset.type === "AUDIO" ? asset.channels || 2 : asset.type === "VIDEO" ? asset.channels ?? 0 : 0,
    };
    media.set(asset.id, entry);
    return entry;
  };

  const timing = (entity: Entity) => {
    const computed = entity.get(Computed);
    const start = computed?.start ?? 0;
    const end = computed?.end ?? 0;
    const window = getSourceWindow(entity);
    const length = end - start;
    return { start, end, in: window.in, speed: length > 0 ? (window.out - window.in) / length : 1 };
  };

  const gain = (entity: Entity) => {
    const db = entity.get(Volume)?.value ?? 0;
    return db === -Infinity ? 0 : 10 ** (db / 20);
  };

  const walk = (entity: Entity, window: { start: number; end: number }) => {
    if (entity.has(IsMask)) return;
    const computed = entity.get(Computed);

    if (isGroupLike(entity)) {
      if (entity.has(Hidden)) return;
      const inner = entity === scene
        ? window
        : { start: Math.max(window.start, computed?.start ?? 0), end: Math.min(window.end, computed?.end ?? 0) };
      for (const child of getEntityChildren(world, entity)) walk(child, inner);
      return;
    }

    const asset = (id: string | undefined) => (id ? library?.get(id) : undefined);

    if (entity.has(Audio)) {
      const sound = asset(entity.get(AssetId)?.value);
      if (sound && (sound.type === "AUDIO" || sound.type === "VIDEO")) {
        const clip = clampClip({
          ...timing(entity),
          media: mediaFor(sound, "audio").id,
          name: entity.get(Name)?.value || sound.path.split("/").pop() || "Audio",
          visual: false,
          audio: true,
          audible: !entity.has(Muted) && !entity.has(Hidden),
          gain: gain(entity),
          opacity: 1,
        }, window);
        if (clip) clips.push(clip);
      }
    } else if (!entity.has(Hidden) && entity.has(Geometry)) {
      const drawn = visualSource(entity);
      const picture = drawn && asset(drawn.source.get(AssetId)?.value);
      if (drawn && picture && (picture.type === "VIDEO" || picture.type === "IMAGE")) {
        const entry = mediaFor(picture, picture.type === "VIDEO" ? "video" : "image");
        const crop = drawn.source.get(MediaCrop);
        const clip = clampClip({
          ...timing(entity),
          ...(picture.type === "IMAGE" ? { in: 0, speed: 1 } : {}),
          media: entry.id,
          name: entity.get(Name)?.value || entry.file,
          visual: true,
          audio: picture.type === "VIDEO" && entry.channels > 0,
          audible: !entity.has(Muted),
          gain: gain(entity),
          opacity: computed?.opacity ?? 1,
          framing: premiereFraming({
            sequence: { width, height },
            source: { width: picture.width, height: picture.height },
            box: { width: computed?.width || picture.width, height: computed?.height || picture.height },
            matrix: multiply2D(toScene, matrixOf(entity)),
            fit: FITS[drawn.source.get(ScaleMode)?.value ?? ScaleModeType.COVER] ?? "cover",
            crop: crop ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height } : undefined,
          }),
        }, window);
        if (clip) {
          clips.push(clip);
          if (picture.type === "IMAGE") entry.seconds = Math.max(entry.seconds, (clip.end - clip.start) / fps);
        }
      } else if (!entity.has(Group)) {
        leftOut = true;
      }
    }

    if ((entity.get(Cache)?.effects.length ?? 0) > 0 || (entity.get(Cache)?.grades.length ?? 0) > 0) leftOut = true;
    for (const child of getEntityChildren(world, entity)) {
      if (child.has(Geometry) || child.has(Group)) walk(child, window);
    }
  };

  walk(scene, { start: from, end: to });

  return {
    timeline: {
      name,
      width,
      height,
      fps,
      clips: clips.map((clip) => ({ ...clip, start: clip.start - from, end: clip.end - from })),
      media: [...media.values()],
    },
    files,
    leftOut,
  };
}
