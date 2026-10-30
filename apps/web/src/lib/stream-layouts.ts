/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** A slot shows its crop cover-fit, so a crop shaped unlike its slot loses its edges. */

import { msg } from "@/lib/i18n";

export type Box ={ x: number; y: number; width: number; height: number };

export type CropId = "facecam" | "facecam2" | "gameplay" | "ui";

export type Crops = Partial<Record<CropId, Box>>;

export const LAYOUT_WIDTH = 1080;
export const LAYOUT_HEIGHT = 1920;

export type CropSpec = {
  id: CropId;
  /** Width / height of the crop a layout starts with. */
  aspect: number;
  /** As fractions of the source. */
  cx: number;
  cy: number;
  height: number;
};

export type Slot = {
  crop: CropId;
  box: Box;
  radius?: number;
  blur?: number;
  /** Sits over the others at a size of its own, so a crop's shape reshapes it. */
  float?: boolean;
};

export type StreamLayout = {
  id: string;
  label: string;
  crops: CropSpec[];
  /** Crops are in source pixels. */
  slots: (crops: Crops) => Slot[];
};

export const CROP_LABELS: Record<CropId, string> = {
  facecam: msg("Facecam"),
  facecam2: msg("Facecam 2"),
  gameplay: msg("Gameplay"),
  ui: msg("Game UI"),
};

/** Its aspect is in output pixels. */
export type CropShape = "freeform" | "fullscreen" | "wide" | "classic" | "square" | "circle";

export const CROP_SHAPES: { id: CropShape; label: string; aspect: number | null }[] = [
  { id: "freeform", label: msg("Freeform"), aspect: null },
  { id: "fullscreen", label: msg("Fullscreen"), aspect: 9 / 16 },
  { id: "wide", label: msg("Rectangle 16:9"), aspect: 16 / 9 },
  { id: "classic", label: msg("Rectangle 4:3"), aspect: 4 / 3 },
  { id: "square", label: msg("Square"), aspect: 1 },
  { id: "circle", label: msg("Circle"), aspect: 1 },
];

export type CropStyle = {
  shape: CropShape;
  /** 0–100% of half the slot's shorter side. Null keeps the layout's own. */
  rounding: number | null;
};

export type CropStyles = Partial<Record<CropId, CropStyle>>;

export const CROP_COLORS: Record<CropId, string> = {
  facecam: "#008CFF",
  facecam2: "#9B6BFF",
  gameplay: "#2BC47D",
  ui: "#F5A524",
};

const W = LAYOUT_WIDTH;
const H = LAYOUT_HEIGHT;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Kept between `min` and `max`. A deleted crop wants none. */
function band(crop: Box | undefined, width: number, min: number, max: number): number {
  if (!crop) return 0;
  if (crop.width <= 0) return min;
  return Math.round(clamp((width * crop.height) / crop.width, min, max));
}

const full = (crop: CropId): Slot => ({ crop, box: { x: 0, y: 0, width: W, height: H } });

const gameplay = (aspect: number): CropSpec => ({ id: "gameplay", aspect, cx: 0.5, cy: 0.5, height: 1 });
const facecam = (aspect: number, cx = 0.16, cy = 0.22, height = 0.32): CropSpec => ({ id: "facecam", aspect, cx, cy, height });

function blurredBand(crops: Crops): { slots: Slot[]; top: number } {
  const height = band(crops.gameplay, W, 600, 1400);
  const top = Math.round(920 - height / 2);
  return {
    slots: [
      { crop: "gameplay", box: { x: -80, y: -80, width: W + 160, height: H + 160 }, blur: 48 },
      { crop: "gameplay", box: { x: 0, y: top, width: W, height } },
    ],
    top,
  };
}

export const STREAM_LAYOUTS: StreamLayout[] = [
  {
    id: "small-facecam",
    label: msg("Small facecam"),
    crops: [gameplay(0.93), facecam(4 / 3, 0.16, 0.22, 0.3)],
    slots: (crops) => {
      const { slots, top } = blurredBand(crops);
      const width = 540;
      const height = band(crops.facecam, width, 240, 600);
      return [
        ...slots,
        { crop: "facecam", box: { x: (W - width) / 2, y: Math.max(80, top - 90), width, height }, radius: 28, float: true },
      ];
    },
  },
  {
    id: "circle-facecam",
    label: msg("Circle facecam"),
    crops: [gameplay(0.93), facecam(1)],
    slots: (crops) => {
      const { slots, top } = blurredBand(crops);
      return [
        ...slots,
        { crop: "facecam", box: { x: 280, y: Math.max(80, top - 220), width: 520, height: 520 }, radius: 260, float: true },
      ];
    },
  },
  {
    id: "game-ui",
    label: msg("Game UI"),
    crops: [facecam(1.5), { id: "ui", aspect: 5.4, cx: 0.5, cy: 0.06, height: 0.09 }, gameplay(1.06)],
    slots: (crops) => {
      const top = band(crops.facecam, W, 400, 900);
      const strip = band(crops.ui, W, 120, 420);
      return [
        { crop: "facecam", box: { x: 0, y: 0, width: W, height: top } },
        { crop: "ui", box: { x: 0, y: top, width: W, height: strip } },
        { crop: "gameplay", box: { x: 0, y: top + strip, width: W, height: H - top - strip } },
      ];
    },
  },
  {
    id: "split",
    label: msg("Split"),
    crops: [facecam(1.5), gameplay(0.9)],
    slots: (crops) => {
      const top = band(crops.facecam, W, 400, 1200);
      return [
        { crop: "facecam", box: { x: 0, y: 0, width: W, height: top } },
        { crop: "gameplay", box: { x: 0, y: top, width: W, height: H - top } },
      ];
    },
  },
  {
    id: "blurred",
    label: msg("Blurred"),
    crops: [gameplay(16 / 9)],
    slots: (crops) => {
      const height = band(crops.gameplay, W, 400, 1600);
      return [
        { crop: "gameplay", box: { x: -80, y: -80, width: W + 160, height: H + 160 }, blur: 48 },
        { crop: "gameplay", box: { x: 0, y: Math.round((H - height) / 2), width: W, height } },
      ];
    },
  },
  {
    id: "fullscreen",
    label: msg("Fullscreen"),
    crops: [gameplay(9 / 16)],
    slots: () => [full("gameplay")],
  },
  {
    id: "basecam",
    label: msg("Basecam"),
    crops: [gameplay(0.9), facecam(1.5, 0.16, 0.78)],
    slots: (crops) => {
      const bottom = band(crops.facecam, W, 400, 1200);
      return [
        { crop: "gameplay", box: { x: 0, y: 0, width: W, height: H - bottom } },
        { crop: "facecam", box: { x: 0, y: H - bottom, width: W, height: bottom } },
      ];
    },
  },
  {
    id: "mosaic",
    label: msg("Mosaic"),
    crops: [
      facecam(1.25),
      { id: "ui", aspect: 1.25, cx: 0.88, cy: 0.14, height: 0.26 },
      gameplay(0.73),
    ],
    slots: (crops) => {
      const top = Math.max(band(crops.facecam, W / 2, 300, 900), band(crops.ui, W / 2, 300, 900));
      return [
        { crop: "facecam", box: { x: 0, y: 0, width: W / 2, height: top } },
        { crop: "ui", box: { x: W / 2, y: 0, width: W / 2, height: top } },
        { crop: "gameplay", box: { x: 0, y: top, width: W, height: H - top } },
      ];
    },
  },
  {
    id: "dual-facecam",
    label: msg("Dual facecam"),
    crops: [
      gameplay(9 / 16),
      facecam(1, 0.12, 0.25, 0.3),
      { id: "facecam2", aspect: 1, cx: 0.88, cy: 0.25, height: 0.3 },
    ],
    slots: () => [
      full("gameplay"),
      { crop: "facecam", box: { x: 60, y: 100, width: 440, height: 440 }, radius: 220, float: true },
      { crop: "facecam2", box: { x: 580, y: 100, width: 440, height: 440 }, radius: 220, float: true },
    ],
  },
  {
    id: "duo-split",
    label: msg("Duo split"),
    crops: [
      facecam(0.9, 0.12, 0.25, 0.35),
      { id: "facecam2", aspect: 0.9, cx: 0.88, cy: 0.25, height: 0.35 },
      gameplay(0.9),
    ],
    slots: (crops) => {
      // With one facecam deleted, the other takes the whole width.
      const half = crops.facecam && crops.facecam2 ? W / 2 : W;
      const top = Math.max(band(crops.facecam, half, 300, 900), band(crops.facecam2, half, 300, 900));
      return [
        { crop: "facecam", box: { x: 0, y: 0, width: half, height: top } },
        { crop: "facecam2", box: { x: W - half, y: 0, width: half, height: top } },
        { crop: "gameplay", box: { x: 0, y: top, width: W, height: H - top } },
      ];
    },
  },
  {
    id: "half",
    label: msg("Half"),
    crops: [facecam(1.125, 0.16, 0.22, 0.36), gameplay(1.125)],
    slots: (crops) => {
      if (!crops.facecam || !crops.gameplay) return [full("facecam"), full("gameplay")];
      return [
        { crop: "facecam", box: { x: 0, y: 0, width: W, height: H / 2 } },
        { crop: "gameplay", box: { x: 0, y: H / 2, width: W, height: H / 2 } },
      ];
    },
  },
];

export function getStreamLayout(id: string): StreamLayout {
  return STREAM_LAYOUTS.find((layout) => layout.id === id) ?? STREAM_LAYOUTS[0]!;
}

export function slotRounding(slot: Slot): number {
  const half = Math.min(slot.box.width, slot.box.height) / 2;
  return half > 0 ? clamp(((slot.radius ?? 0) / half) * 100, 0, 100) : 0;
}

/** Its own if set, else freeform with the layout's rounding. */
export function cropStyle(styles: CropStyles, id: CropId): CropStyle {
  return styles[id] ?? { shape: "freeform", rounding: null };
}

/** A floating slot takes its crop's shape about its centre. A circle is fully rounded. */
export function styleSlots(slots: Slot[], styles: CropStyles): Slot[] {
  return slots.map((slot) => {
    const style = styles[slot.crop];
    if (slot.blur || !style) return slot;
    const aspect = CROP_SHAPES.find((shape) => shape.id === style.shape)?.aspect;
    const box = slot.float && aspect ? fitSlot(slot.box, aspect) : slot.box;
    const rounding = style.shape === "circle" ? 100 : (style.rounding ?? slotRounding(slot));
    return { ...slot, box, radius: (Math.min(box.width, box.height) / 2) * (rounding / 100) };
  });
}

/** Keeps its area, inside the frame. */
function fitSlot(box: Box, aspect: number): Box {
  let width = Math.sqrt(box.width * box.height * aspect);
  let height = width / aspect;
  const shrink = Math.min(1, W / width, H / height);
  width *= shrink;
  height *= shrink;
  return {
    x: clamp(box.x + box.width / 2 - width / 2, 0, W - width),
    y: clamp(box.y + box.height / 2 - height / 2, 0, H - height),
    width,
    height,
  };
}

/** Keeps its area where it fits, as fractions of a source of `sourceAspect`. */
export function reshapeCrop(crop: Box, aspect: number, sourceAspect: number): Box {
  const ratio = aspect / sourceAspect;
  let height = Math.sqrt((crop.width * crop.height) / ratio);
  let width = height * ratio;
  if (width > 1) {
    width = 1;
    height = width / ratio;
  }
  if (height > 1) {
    height = 1;
    width = height * ratio;
  }
  const cx = crop.x + crop.width / 2;
  const cy = crop.y + crop.height / 2;
  return {
    x: clamp(cx - width / 2, 0, 1 - width),
    y: clamp(cy - height / 2, 0, 1 - height),
    width,
    height,
  };
}

export function defaultCrop(spec: CropSpec, sourceAspect: number): Box {
  let height = spec.height;
  let width = (height * spec.aspect) / sourceAspect;
  if (width > 1) {
    width = 1;
    height = (width * sourceAspect) / spec.aspect;
  }
  return {
    x: clamp(spec.cx - width / 2, 0, 1 - width),
    y: clamp(spec.cy - height / 2, 0, 1 - height),
    width,
    height,
  };
}

/** Trimmed to that aspect around its center. */
export function coverRect(crop: Box, aspect: number): Box {
  if (crop.width <= 0 || crop.height <= 0 || aspect <= 0) return crop;
  if (crop.width / crop.height > aspect) {
    const width = crop.height * aspect;
    return { x: crop.x + (crop.width - width) / 2, y: crop.y, width, height: crop.height };
  }
  const height = crop.width / aspect;
  return { x: crop.x, y: crop.y + (crop.height - height) / 2, width: crop.width, height };
}

export function toPixels(crops: Crops, width: number, height: number): Crops {
  const out: Crops = {};
  for (const [id, box] of Object.entries(crops) as [CropId, Box][]) {
    out[id] = { x: box.x * width, y: box.y * height, width: box.width * width, height: box.height * height };
  }
  return out;
}

/** On a 16:9 source, for the template cards. */
export function thumbnailSlots(layout: StreamLayout): Slot[] {
  const crops: Crops = {};
  for (const spec of layout.crops) crops[spec.id] = defaultCrop(spec, 16 / 9);
  return layout.slots(toPixels(crops, 1920, 1080));
}

type Frame = CanvasImageSource & { width: number; height: number };

/** `crops` are in source pixels counted at `source`, which the decoder's frame may not match. */
export function drawLayout(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  slots: Slot[],
  crops: Crops,
  source: { width: number; height: number },
  scale: number,
): void {
  const fx = frame.width / source.width;
  const fy = frame.height / source.height;

  for (const slot of slots) {
    const crop = crops[slot.crop];
    if (!crop) continue;
    const { box } = slot;
    const shown = coverRect(crop, box.width / box.height);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(box.x * scale, box.y * scale, box.width * scale, box.height * scale, (slot.radius ?? 0) * scale);
    ctx.clip();
    if (slot.blur) ctx.filter = `blur(${slot.blur * scale}px)`;
    ctx.drawImage(
      frame,
      shown.x * fx,
      shown.y * fy,
      shown.width * fx,
      shown.height * fy,
      box.x * scale,
      box.y * scale,
      box.width * scale,
      box.height * scale,
    );
    ctx.restore();
  }
}
