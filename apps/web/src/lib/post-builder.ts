/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  CROP_LABELS,
  LAYOUT_HEIGHT,
  LAYOUT_WIDTH,
  coverRect,
  defaultCrop,
  getStreamLayout,
  toPixels,
  type Box,
  type Crops,
  type Slot,
} from "./stream-layouts";
import { t } from "./i18n";

import type { CaptionPreset, TextLookName } from "@plan.video/jsx";

export const HOOK_SECONDS = 3.2;
export const HOOK_SIZE = 88;
/** Under the feed's own buttons at the top. */
export const HOOK_Y = 340 / 1920;

export type PostClip = {
  /** What `src` names. */
  src: string;
  width: number;
  height: number;
  /** Seconds of it that play. */
  duration: number;
  /** Where in the file playing starts. */
  sourceIn?: number;
};

export type PostCaptions = {
  preset: CaptionPreset;
  /** The face, colour and outlines, over the preset's motion. */
  look?: TextLookName;
  /** The preset's colour slots, such as a highlight. */
  colors?: string[];
  /** Px on the 1080-wide frame, in place of the preset's own. */
  fontSize?: number;
  /** The words' colour, in place of the look's. */
  fill?: string;
  /** Most words on screen at once. */
  words?: number;
  /** The captions' middle as a share of the frame's height; the layout's own place when left out. */
  y?: number;
};

export type PostHook = {
  text: string;
  seconds: number;
  /** Px on the 1080-wide frame. */
  size?: number;
  /** The hook's middle as a share of the frame's height. */
  y?: number;
};

export type PostSpec = {
  name: string;
  clips: PostClip[];
  layoutId: string;
  /** Null for no captions. */
  captions: PostCaptions | null;
  /** A transcript file for the captions, so nothing is transcribed again. Its times are the scene's. */
  captionsSrc?: string;
  /** Crops found for the source, as fractions of it, in place of the layout's own. */
  crops?: Crops;
  /** A line shown big over the first seconds, to stop the scroll. */
  hook?: PostHook | null;
};

export type PostNode = {
  tag: string;
  props: Record<string, unknown>;
  /** A `<text>`'s words. */
  text?: string;
  children: PostNode[];
};

/** Frames a portrait scene at the origin (see docs/reference/jsx/stage.md). */
export const POST_CAMERA = [0.25, 0, 0, 0.25, 235, 70] as const;

const node = (tag: string, props: Record<string, unknown>, children: PostNode[] = []): PostNode => ({ tag, props, children });

/** Scaled so the crop's visible part fills the slot exactly, with a mask keeping only the slot. */
function slotVideo(clip: PostClip, slot: Slot, crop: Box, start: number, muted: boolean, name: string): PostNode {
  const { box } = slot;
  const shown = coverRect(crop, box.width / box.height);
  const scale = box.width / shown.width;
  const x = Math.round(box.x - shown.x * scale);
  const y = Math.round(box.y - shown.y * scale);

  const mask = {
    mask: true,
    x: Math.round(box.x - x),
    y: Math.round(box.y - y),
    width: Math.round(box.width),
    height: Math.round(box.height),
    ...(slot.radius ? { cornerRadius: slot.radius } : {}),
  };

  return node(
    "video",
    {
      name,
      src: clip.src,
      x,
      y,
      width: Math.round(clip.width * scale),
      height: Math.round(clip.height * scale),
      objectFit: "fill",
      start,
      end: start + clip.duration,
      ...(clip.sourceIn ? { sourceIn: clip.sourceIn } : {}),
      ...(muted ? { muted: true } : {}),
    },
    [
      node("rect", mask),
      ...(slot.blur ? [node("effect", { type: "blur", value: slot.blur })] : []),
    ],
  );
}

/** How far the gameplay crop may move off its middle to keep a found facecam out of it, as a share of the source. */
const MOST_GAMEPLAY_SHIFT = 0.1;
/** A camera's picture reaches past the person found in it, by up to this share of the source. */
const CAMERA_EDGE = 0.04;

/** The gameplay crop moved sideways off the facecam, so the camera doesn't show again at the game's edge. */
function clearOfFacecam(gameplay: Box, facecam: Box): Box {
  const camLeft = facecam.x - CAMERA_EDGE;
  const camRight = facecam.x + facecam.width + CAMERA_EDGE;
  if (gameplay.x >= camRight || gameplay.x + gameplay.width <= camLeft) return gameplay;
  const left = facecam.x + facecam.width / 2 < gameplay.x + gameplay.width / 2;
  const wanted = left ? camRight : camLeft - gameplay.width;
  const x = Math.min(1 - gameplay.width, Math.max(0, Math.min(gameplay.x + MOST_GAMEPLAY_SHIFT, Math.max(gameplay.x - MOST_GAMEPLAY_SHIFT, wanted))));
  return { ...gameplay, x };
}

/** A clip's slots and crops in source pixels, as the post draws them. */
export function postLayout(layoutId: string, clip: { width: number; height: number }, found: Crops = {}): { slots: Slot[]; crops: Crops } {
  return layoutFor(layoutId, clip, found);
}

function layoutFor(layoutId: string, clip: { width: number; height: number }, found: Crops = {}): { slots: Slot[]; crops: Crops } {
  const layout = getStreamLayout(layoutId);
  const fractions: Crops = {};
  for (const spec of layout.crops) fractions[spec.id] = found[spec.id] ?? defaultCrop(spec, clip.width / clip.height);
  if (found.facecam && fractions.gameplay && !found.gameplay) fractions.gameplay = clearOfFacecam(fractions.gameplay, found.facecam);
  const crops = toPixels(fractions, clip.width, clip.height);
  return { slots: layout.slots(crops).filter((slot) => crops[slot.crop]), crops };
}

/** Slots are listed back to front, and so are the sequences made of them. */
export function buildPost(spec: PostSpec): PostNode {
  const layout = getStreamLayout(spec.layoutId);
  const perClip = spec.clips.map((clip) => layoutFor(spec.layoutId, clip, spec.crops));
  const slotCount = Math.max(0, ...perClip.map((entry) => entry.slots.length));

  const tracks: PostNode[] = [];
  for (let s = 0; s < slotCount; s++) {
    const videos: PostNode[] = [];
    let start = 0;
    let label = "";
    spec.clips.forEach((clip, i) => {
      const { slots, crops } = perClip[i]!;
      const slot = slots[s];
      if (slot) {
        // The main gameplay slot keeps the sound, as applying a layout does.
        const main = Math.max(0, slots.findIndex((entry) => entry.crop === "gameplay" && !entry.blur));
        label ||= slot.blur ? t("Background") : t(CROP_LABELS[slot.crop]);
        videos.push(slotVideo(clip, slot, crops[slot.crop]!, start, s !== main, `${label} ${i + 1}`));
      }
      start += clip.duration;
    });
    if (videos.length) tracks.push(node("sequence", { name: label || t(layout.label) }, videos));
  }

  const children = [...tracks];
  const length = spec.clips.reduce((sum, clip) => sum + clip.duration, 0);
  const captions = spec.captions;
  if (captions) {
    const placed = captions.y !== undefined ? captions.y * LAYOUT_HEIGHT : perClip[0] ? captionsAt(perClip[0].slots) : null;
    children.push(
      node("captions", {
        preset: captions.preset,
        ...(captions.look ? { look: captions.look } : {}),
        ...(captions.colors?.length ? { colors: captions.colors } : {}),
        ...(captions.fontSize ? { fontSize: Math.round(captions.fontSize) } : {}),
        ...(captions.fill ? { fill: captions.fill } : {}),
        ...(captions.words ? { words: Math.round(captions.words) } : {}),
        ...(spec.captionsSrc ? { src: spec.captionsSrc } : {}),
        ...(placed !== null ? { verticalAlign: "center", offsetY: Math.round(placed - LAYOUT_HEIGHT / 2) } : {}),
      }),
    );
  }
  const hook = spec.hook;
  if (hook?.text.trim() && length > 1) children.push(hookText({ ...hook, text: hook.text.trim(), seconds: Math.min(hook.seconds, length) }));

  return node(
    "scene",
    { name: spec.name, width: LAYOUT_WIDTH, height: LAYOUT_HEIGHT, fill: "#000000", active: true },
    children,
  );
}

/** Where the captions' middle goes on a layout, as a share of the frame's height. */
export function captionsPlace(slots: Slot[]): number {
  return (captionsAt(slots) ?? LAYOUT_HEIGHT / 2) / LAYOUT_HEIGHT;
}

/** Where the captions' middle goes: on the seam under a facecam band, just under a game band, or low on a full frame. */
function captionsAt(slots: Slot[]): number | null {
  const game = slots.find((slot) => slot.crop === "gameplay" && !slot.blur);
  if (!game) return null;
  const { y, height } = game.box;
  if (height >= LAYOUT_HEIGHT - 40) return Math.round(LAYOUT_HEIGHT * 0.72);
  const camAbove = slots.some((slot) => slot.crop === "facecam" && !slot.float && Math.abs(slot.box.y + slot.box.height - y) < 2);
  if (camAbove) return y;
  const under = y + height + 150;
  return under < LAYOUT_HEIGHT - 300 ? under : Math.round(LAYOUT_HEIGHT * 0.72);
}

/** The hook in the captions' gaming face, its box wide enough for two lines. */
function hookText(hook: PostHook): PostNode {
  const size = Math.round(hook.size ?? HOOK_SIZE);
  const height = Math.round(size * 3.9);
  const middle = (hook.y ?? HOOK_Y) * LAYOUT_HEIGHT;
  return {
    tag: "text",
    props: {
      name: t("Hook"),
      x: 70,
      y: Math.round(middle - height / 2),
      width: LAYOUT_WIDTH - 140,
      height,
      start: 0,
      end: Math.round(hook.seconds * 1000) / 1000,
      fontFamily: "Luckiest Guy",
      fontWeight: 400,
      fontSize: size,
      textCase: "upper",
      textAlign: "center",
      textBaseline: "middle",
      leading: 1.05,
      color: "#FFFFFF",
    },
    text: hook.text,
    children: [
      node("stroke", { color: "#000000", width: Math.round(size * 0.18), join: "round" }),
      node("shadow", { color: "#000000", opacity: 0.8, blur: Math.round(size * 0.3) }),
      node("animation", { type: "pop", duration: 0.3 }),
      node("animation", { type: "fade", phase: "out", duration: 0.3 }),
    ],
  };
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

function jsxProp(key: string, value: unknown): string {
  if (!IDENTIFIER.test(key)) throw new Error(`Not a prop name: ${key}`);
  if (value === true) return key;
  if (typeof value === "string") return `${key}=${JSON.stringify(value)}`;
  return `${key}={${JSON.stringify(value)}}`;
}

function jsxNode(entry: PostNode, indent: string): string {
  const props = Object.entries(entry.props).map(([key, value]) => jsxProp(key, value)).join(" ");
  const open = props ? `<${entry.tag} ${props}` : `<${entry.tag}`;
  if (!entry.children.length && entry.text === undefined) return `${indent}${open} />`;
  const words = entry.text === undefined ? [] : [`${indent}  {${JSON.stringify(entry.text)}}`];
  const inner = [...words, ...entry.children.map((child) => jsxNode(child, `${indent}  `))].join("\n");
  return `${indent}${open}>\n${inner}\n${indent}</${entry.tag}>`;
}

export function postSource(scene: PostNode): string {
  return `export default function Project() {
  return (
    <stage background="#161616" camera={${JSON.stringify(POST_CAMERA)}}>
${jsxNode(scene, "      ")}
    </stage>
  );
}
`;
}
