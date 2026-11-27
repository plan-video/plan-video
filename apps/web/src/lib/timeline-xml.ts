/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Final Cut Pro 7 XML ("xmeml"): the timeline format Premiere Pro and DaVinci Resolve both import.

export type TimelineMedia = {
  id: string;
  /** The file's name in the folder's `media/` next to the XML. */
  file: string;
  kind: "video" | "audio" | "image";
  seconds: number;
  width?: number;
  height?: number;
  frameRate?: number;
  channels: number;
};

export type Framing = {
  /** Percent of the source's own pixels. */
  scale: number;
  /** Premiere's Basic Motion centre: the offset from the frame's middle in pixels, over the source's width and height. */
  centerX: number;
  centerY: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** Percent of the source cut from each side. */
  crop: { left: number; right: number; top: number; bottom: number };
};

export type TimelineClip = {
  media: string;
  name: string;
  /** Sequence frames, end exclusive. */
  start: number;
  end: number;
  /** The first source frame shown, in sequence frames. */
  in: number;
  speed: number;
  /** Drawn on screen; off for audio. */
  visual: boolean;
  /** Carries sound. */
  audio: boolean;
  /** Heard; a muted clip keeps its sound, switched off. */
  audible: boolean;
  /** Linear gain, 1 is unchanged. */
  gain: number;
  opacity: number;
  framing?: Framing;
};

export type Timeline = {
  name: string;
  width: number;
  height: number;
  fps: number;
  /** Bottom to top: a later clip is drawn over an earlier one. */
  clips: TimelineClip[];
  media: TimelineMedia[];
};

type Span = { start: number; end: number };

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** The part of a clip inside `window`, its in point moved along at its speed; null when none is. */
export function clampClip<T extends Span & { in: number; speed: number }>(clip: T, window: Span): T | null {
  const start = Math.max(clip.start, window.start);
  const end = Math.min(clip.end, window.end);
  if (end <= start) return null;
  return { ...clip, start, end, in: clip.in + Math.round((start - clip.start) * clip.speed) };
}

/** Video tracks, 0 at the bottom: a clip sits above every earlier clip it overlaps, so the stacking survives. */
export function stackTracks(clips: Span[]): number[] {
  const tracks: number[] = [];
  clips.forEach((clip, i) => {
    let track = 0;
    for (let j = 0; j < i; j++) {
      if (overlaps(clip, clips[j]!)) track = Math.max(track, tracks[j]! + 1);
    }
    tracks.push(track);
  });
  return tracks;
}

/** Audio lanes: the first one free for the whole clip. */
export function packTracks(clips: Span[]): number[] {
  const lanes: Span[][] = [];
  return clips.map((clip) => {
    let lane = lanes.findIndex((taken) => !taken.some((other) => overlaps(clip, other)));
    if (lane === -1) lane = lanes.push([]) - 1;
    lanes[lane]!.push(clip);
    return lane;
  });
}

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

export type ScaleFit = "cover" | "fit" | "fill" | "none";

/**
 * Where the source lands in the sequence, as Premiere's Basic Motion and Crop say it. `matrix` maps
 * the clip's box (0,0 to box size) into sequence pixels; `crop` is the part of the source shown, in
 * fractions, before it is fitted into the box.
 */
export function premiereFraming(input: {
  sequence: { width: number; height: number };
  source: { width: number; height: number };
  box: { width: number; height: number };
  matrix: Matrix;
  fit: ScaleFit;
  crop?: { x: number; y: number; width: number; height: number };
}): Framing {
  const { sequence, source, box, matrix: m, fit } = input;
  const crop = input.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const cx = crop.x * source.width;
  const cy = crop.y * source.height;
  const cw = crop.width * source.width;
  const ch = crop.height * source.height;

  let sw = cw;
  let sh = ch;
  if (fit === "fill") [sw, sh] = [box.width, box.height];
  else if (fit === "fit" || fit === "cover") {
    const k = (fit === "fit" ? Math.min : Math.max)(box.width / cw, box.height / ch);
    [sw, sh] = [cw * k, ch * k];
  }
  const dx = fit === "none" ? 0 : (box.width - sw) / 2;
  const dy = fit === "none" ? 0 : (box.height - sh) / 2;
  const mx = sw / cw;
  const my = sh / ch;

  // The whole source frame's middle, in the box, then in the sequence.
  const px = dx - cx * mx + (source.width * mx) / 2;
  const py = dy - cy * my + (source.height * my) / 2;
  const sx = m.a * px + m.c * py + m.e;
  const sy = m.b * px + m.d * py + m.f;
  const boxScale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));

  // The box clips what overflows it, which in source pixels is a crop.
  const left = cx + (Math.max(dx, 0) - dx) / mx;
  const right = cx + (Math.min(dx + sw, box.width) - dx) / mx;
  const top = cy + (Math.max(dy, 0) - dy) / my;
  const bottom = cy + (Math.min(dy + sh, box.height) - dy) / my;
  const percent = (value: number, of: number) => round(Math.min(100, Math.max(0, (value / of) * 100)));

  return {
    scale: round(((mx + my) / 2) * boxScale * 100),
    centerX: round((sx - sequence.width / 2) / source.width, 6),
    centerY: round((sy - sequence.height / 2) / source.height, 6),
    rotation: round((Math.atan2(m.b, m.a) * 180) / Math.PI),
    crop: {
      left: percent(left, source.width),
      right: percent(source.width - right, source.width),
      top: percent(top, source.height),
      bottom: percent(source.height - bottom, source.height),
    },
  };
}

function round(value: number, places = 4) {
  const k = 10 ** places;
  const rounded = Math.round(value * k) / k;
  return Object.is(rounded, -0) ? 0 : rounded;
}

// --- writing ---

type Node = { tag: string; attrs?: Record<string, string | number>; children?: (Node | null | undefined | false)[]; text?: string | number };

const el = (tag: string, content?: string | number | (Node | null | undefined | false)[], attrs?: Node["attrs"]): Node =>
  Array.isArray(content) ? { tag, attrs, children: content } : { tag, attrs, text: content };

const escape = (value: string | number) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function render(node: Node, depth = 0): string {
  const pad = "\t".repeat(depth);
  const attrs = Object.entries(node.attrs ?? {}).map(([key, value]) => ` ${key}="${escape(value)}"`).join("");
  const children = (node.children ?? []).filter((child): child is Node => !!child);
  if (node.children) {
    if (children.length === 0) return `${pad}<${node.tag}${attrs}/>`;
    return `${pad}<${node.tag}${attrs}>\n${children.map((child) => render(child, depth + 1)).join("\n")}\n${pad}</${node.tag}>`;
  }
  return `${pad}<${node.tag}${attrs}>${node.text === undefined ? "" : escape(node.text)}</${node.tag}>`;
}

const bool = (value: boolean) => (value ? "TRUE" : "FALSE");

/** 29.97 is timebase 30 with the NTSC flag; frame counts stay as they are. */
function rate(fps: number): Node {
  const timebase = Math.max(1, Math.round(fps));
  return el("rate", [el("timebase", timebase), el("ntsc", bool(Math.abs(fps - timebase) > 0.001))]);
}

const param = (id: string, name: string, value: string | number | Node[], range?: [number, number]): Node =>
  el("parameter", [
    el("parameterid", id),
    el("name", name),
    range && el("valuemin", range[0]),
    range && el("valuemax", range[1]),
    el("value", value),
  ], { authoringApp: "PremierePro" });

const effect = (name: string, id: string, category: string, mediatype: "video" | "audio", params: Node[]): Node =>
  el("filter", [el("effect", [el("name", name), el("effectid", id), el("effectcategory", category), el("effecttype", category), el("mediatype", mediatype), ...params])]);

function speedFilter(speed: number, mediatype: "video" | "audio"): Node {
  return effect("Time Remap", "timeremap", "motion", mediatype, [
    param("variablespeed", "variablespeed", 0, [0, 1]),
    param("speed", "speed", round(speed * 100, 2), [-100000, 100000]),
    param("reverse", "reverse", "FALSE"),
    param("frameblending", "frameblending", "FALSE"),
  ]);
}

function videoFilters(clip: TimelineClip): Node[] {
  const filters: Node[] = [];
  const framing = clip.framing;
  if (framing) {
    filters.push(effect("Basic Motion", "basic", "motion", "video", [
      param("scale", "Scale", framing.scale, [0, 1000]),
      param("rotation", "Rotation", framing.rotation, [-8640, 8640]),
      param("center", "Center", [el("horiz", framing.centerX), el("vert", framing.centerY)]),
      param("centerOffset", "Anchor Point", [el("horiz", 0), el("vert", 0)]),
    ]));
    const { left, right, top, bottom } = framing.crop;
    if (left || right || top || bottom) {
      filters.push(effect("Crop", "crop", "motion", "video", [
        param("left", "left", left, [0, 100]),
        param("right", "right", right, [0, 100]),
        param("top", "top", top, [0, 100]),
        param("bottom", "bottom", bottom, [0, 100]),
      ]));
    }
  }
  if (clip.opacity < 1) {
    filters.push(effect("Opacity", "opacity", "motion", "video", [param("opacity", "opacity", round(clip.opacity * 100, 2), [0, 100])]));
  }
  if (clip.speed !== 1) filters.push(speedFilter(clip.speed, "video"));
  return filters;
}

function audioFilters(clip: TimelineClip): Node[] {
  const filters: Node[] = [];
  if (clip.gain !== 1) {
    // 3.98109 is +12 dB, the most Premiere's Level goes up to.
    filters.push(effect("Audio Levels", "audiolevels", "audiolevels", "audio", [param("level", "Level", round(Math.min(clip.gain, 3.98109), 5), [0, 3.98109])]));
  }
  if (clip.speed !== 1) filters.push(speedFilter(clip.speed, "audio"));
  return filters;
}

type Item = {
  id: string;
  clip: TimelineClip;
  media: TimelineMedia;
  type: "video" | "audio";
  /** 1-based, among the tracks of its type. */
  track: number;
  /** For audio: the source channel, 1 or 2. */
  channel?: number;
  stereo?: boolean;
  clipIndex: number;
  group: Item[];
};

function fileNode(media: TimelineMedia, written: Set<string>, fps: number): Node {
  const id = `file-${media.id}`;
  if (written.has(id)) return el("file", [], { id });
  written.add(id);
  const fileFps = media.kind === "video" && media.frameRate ? media.frameRate : fps;
  return el("file", [
    el("name", media.file),
    el("pathurl", `media/${encodeURIComponent(media.file)}`),
    rate(fileFps),
    el("duration", Math.max(1, Math.round(media.seconds * fileFps))),
    el("media", [
      media.kind !== "audio" && el("video", [
        el("samplecharacteristics", [
          rate(fileFps),
          el("width", media.width ?? 0),
          el("height", media.height ?? 0),
          el("anamorphic", "FALSE"),
          el("pixelaspectratio", "square"),
          el("fielddominance", "none"),
        ]),
      ]),
      media.channels > 0 && el("audio", [
        el("samplecharacteristics", [el("depth", 16), el("samplerate", 48000)]),
        el("channelcount", media.channels),
      ]),
    ]),
  ], { id });
}

function itemNode(item: Item, timeline: Timeline, written: Set<string>): Node {
  const { clip, media } = item;
  const still = media.kind === "image";
  const length = Math.max(1, Math.round((clip.end - clip.start) * clip.speed));
  const from = still ? 0 : clip.in;
  const out = from + length;
  const attrs: Record<string, string> = { id: item.id, frameBlend: "FALSE" };
  if (item.type === "audio") attrs.premiereChannelType = item.stereo ? "stereo" : "mono";
  return el("clipitem", [
    el("masterclipid", `masterclip-${media.id}`),
    el("name", clip.name),
    el("enabled", bool(item.type === "video" || clip.audible)),
    el("duration", still ? out : Math.max(out, Math.round(media.seconds * timeline.fps))),
    rate(timeline.fps),
    el("start", clip.start),
    el("end", clip.end),
    el("in", from),
    el("out", out),
    item.type === "video" && el("alphatype", still ? "straight" : "none"),
    item.type === "video" && el("pixelaspectratio", "square"),
    item.type === "video" && el("anamorphic", "FALSE"),
    fileNode(media, written, timeline.fps),
    item.type === "audio" && el("sourcetrack", [el("mediatype", "audio"), el("trackindex", item.channel ?? 1)]),
    ...(item.type === "video" ? videoFilters(clip) : audioFilters(clip)),
    ...(item.group.length > 1
      ? item.group.map((linked) =>
          el("link", [
            el("linkclipref", linked.id),
            el("mediatype", linked.type),
            el("trackindex", linked.track),
            el("clipindex", linked.clipIndex),
            linked.type === "audio" && el("groupindex", 1),
          ]),
        )
      : []),
  ], attrs);
}

/** Media paths are relative (`media/<file>`): the folder can move, and an editor that can't follow asks to relink once. */
export function buildPremiereXml(timeline: Timeline): string {
  const mediaById = new Map(timeline.media.map((media) => [media.id, media]));
  const clips = timeline.clips.filter((clip) => clip.end > clip.start && mediaById.has(clip.media));

  const visual = clips.filter((clip) => clip.visual);
  const videoTracks = stackTracks(visual);

  const sounding = clips.filter((clip) => clip.audio && mediaById.get(clip.media)!.channels > 0);
  const stereo = sounding.filter((clip) => mediaById.get(clip.media)!.channels >= 2);
  const mono = sounding.filter((clip) => mediaById.get(clip.media)!.channels < 2);
  const stereoLanes = packTracks(stereo);
  const monoLanes = packTracks(mono);
  const stereoCount = stereoLanes.length ? Math.max(...stereoLanes) + 1 : 0;

  let nextId = 1;
  const groups = new Map<TimelineClip, Item[]>();
  const items: Item[] = [];
  const add = (clip: TimelineClip, item: Omit<Item, "id" | "clip" | "media" | "clipIndex" | "group">) => {
    const group = groups.get(clip) ?? [];
    groups.set(clip, group);
    const full: Item = { ...item, id: `clipitem-${nextId++}`, clip, media: mediaById.get(clip.media)!, clipIndex: 0, group };
    group.push(full);
    items.push(full);
  };
  visual.forEach((clip, i) => add(clip, { type: "video", track: videoTracks[i]! + 1 }));
  stereo.forEach((clip, i) => {
    add(clip, { type: "audio", track: stereoLanes[i]! * 2 + 1, channel: 1, stereo: true });
    add(clip, { type: "audio", track: stereoLanes[i]! * 2 + 2, channel: 2, stereo: true });
  });
  mono.forEach((clip, i) => add(clip, { type: "audio", track: stereoCount * 2 + monoLanes[i]! + 1, channel: 1 }));

  const tracksOf = (type: "video" | "audio") => {
    const tracks: Item[][] = [];
    for (const item of items) if (item.type === type) (tracks[item.track - 1] ??= []).push(item);
    for (const track of tracks) {
      track?.sort((a, b) => a.clip.start - b.clip.start);
      track?.forEach((item, i) => (item.clipIndex = i + 1));
    }
    return Array.from(tracks, (track) => track ?? []);
  };
  const video = tracksOf("video");
  const audio = tracksOf("audio");

  const written = new Set<string>();
  const duration = clips.reduce((end, clip) => Math.max(end, clip.end), 0);

  const videoTrack = (track: Item[]) =>
    el("track", [...track.map((item) => itemNode(item, timeline, written)), el("enabled", "TRUE"), el("locked", "FALSE")]);
  const audioTrack = (track: Item[], index: number) => {
    const pair = index < stereoCount * 2;
    const attrs: Record<string, string | number> = pair
      ? { premiereTrackType: "Stereo", currentExplodedTrackIndex: index % 2, totalExplodedTrackCount: 2 }
      : { premiereTrackType: "Mono" };
    return el("track", [
      ...track.map((item) => itemNode(item, timeline, written)),
      el("enabled", "TRUE"),
      el("locked", "FALSE"),
      el("outputchannelindex", pair ? (index % 2) + 1 : 1),
    ], attrs);
  };
  const output = (index: number) => el("group", [el("index", index), el("numchannels", 1), el("downmix", 0), el("channel", [el("index", index)])]);

  const sequence = el("sequence", [
    el("duration", duration),
    rate(timeline.fps),
    el("name", timeline.name),
    el("media", [
      el("video", [
        el("format", [
          el("samplecharacteristics", [
            rate(timeline.fps),
            el("width", Math.round(timeline.width)),
            el("height", Math.round(timeline.height)),
            el("anamorphic", "FALSE"),
            el("pixelaspectratio", "square"),
            el("fielddominance", "none"),
          ]),
        ]),
        ...video.map(videoTrack),
      ]),
      el("audio", [
        el("numOutputChannels", 2),
        el("format", [el("samplecharacteristics", [el("depth", 16), el("samplerate", 48000)])]),
        el("outputs", [output(1), output(2)]),
        ...audio.map(audioTrack),
      ]),
    ]),
    el("timecode", [rate(timeline.fps), el("string", "00:00:00:00"), el("frame", 0), el("displayformat", "NDF")]),
  ], { id: "sequence-1" });

  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n${render(el("xmeml", [sequence], { version: 4 }))}\n`;
}
