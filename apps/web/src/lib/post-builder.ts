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

import type { CaptionPreset } from "@plan.video/jsx";

export type PostClip = {
  /** What `src` names. */
  src: string;
  width: number;
  height: number;
  duration: number;
};

export type PostSpec = {
  name: string;
  clips: PostClip[];
  layoutId: string;
  /** Null for no captions. */
  captions: CaptionPreset | null;
};

export type PostNode = {
  tag: string;
  props: Record<string, unknown>;
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
      ...(muted ? { muted: true } : {}),
    },
    [
      node("rect", mask),
      ...(slot.blur ? [node("effect", { type: "blur", value: slot.blur })] : []),
    ],
  );
}

function layoutFor(layoutId: string, clip: PostClip): { slots: Slot[]; crops: Crops } {
  const layout = getStreamLayout(layoutId);
  const fractions: Crops = {};
  for (const spec of layout.crops) fractions[spec.id] = defaultCrop(spec, clip.width / clip.height);
  const crops = toPixels(fractions, clip.width, clip.height);
  return { slots: layout.slots(crops).filter((slot) => crops[slot.crop]), crops };
}

/** Slots are listed back to front, and so are the sequences made of them. */
export function buildPost(spec: PostSpec): PostNode {
  const layout = getStreamLayout(spec.layoutId);
  const perClip = spec.clips.map((clip) => layoutFor(spec.layoutId, clip));
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
  if (spec.captions) children.push(node("captions", { preset: spec.captions }));

  return node(
    "scene",
    { name: spec.name, width: LAYOUT_WIDTH, height: LAYOUT_HEIGHT, fill: "#000000", active: true },
    children,
  );
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
  if (!entry.children.length) return `${indent}${open} />`;
  const inner = entry.children.map((child) => jsxNode(child, `${indent}  `)).join("\n");
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
