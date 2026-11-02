/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { msg, t } from "./i18n";

export type Rect = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };

export type ShapeId = "free" | "original" | "1:1" | "4:5" | "2:3" | "9:16" | "16:9" | "1.91:1";

export const SHAPES: { id: ShapeId; label: string; hint: string; ratio?: number }[] = [
  { id: "free", label: msg({ message: "Free", context: "a crop of any shape, not a price" }), hint: msg("Any shape") },
  { id: "original", label: msg("Original"), hint: msg("The picture's own shape") },
  { id: "1:1", label: "1:1", hint: msg("Square, fits every feed"), ratio: 1 },
  { id: "4:5", label: "4:5", hint: msg("The tallest an Instagram or Facebook post can be"), ratio: 4 / 5 },
  { id: "2:3", label: "2:3", hint: msg("Pinterest pins"), ratio: 2 / 3 },
  { id: "9:16", label: "9:16", hint: msg("Stories and TikTok"), ratio: 9 / 16 },
  { id: "16:9", label: "16:9", hint: msg("X and LinkedIn"), ratio: 16 / 9 },
  { id: "1.91:1", label: "1.91:1", hint: msg("The widest an Instagram post can be"), ratio: 1.91 },
];

/** `crop` is in the picture's pixels as it shows after turning and flipping. */
export type PictureEdit = { crop: Rect; turns: 0 | 1 | 2 | 3; flipX: boolean; flipY: boolean; shape: ShapeId };

/** Safari won't draw a canvas past 4096 × 4096, and no network shows more. */
export const MAX_PIXELS = 4096 * 4096;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const turnedSize = (natural: Size, turns: number): Size =>
  turns % 2 ? { width: natural.height, height: natural.width } : { width: natural.width, height: natural.height };

export function shapeRatio(shape: ShapeId, size: Size): number | null {
  if (shape === "free") return null;
  if (shape === "original") return size.width / size.height;
  return SHAPES.find((entry) => entry.id === shape)!.ratio!;
}

/** The biggest crop of `ratio` that fits, centred on `around` and moved back inside if it spills. */
export function fitCrop(ratio: number | null, size: Size, around?: { x: number; y: number }): Rect {
  const width = ratio ? Math.min(size.width, size.height * ratio) : size.width;
  const height = ratio ? width / ratio : size.height;
  const centre = around ?? { x: size.width / 2, y: size.height / 2 };
  return {
    x: clamp(centre.x - width / 2, 0, size.width - width),
    y: clamp(centre.y - height / 2, 0, size.height - height),
    width,
    height,
  };
}

const centreOf = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

export function startEdit(natural: Size, shape: ShapeId = "free"): PictureEdit {
  return { crop: fitCrop(shapeRatio(shape, natural), natural), turns: 0, flipX: false, flipY: false, shape };
}

export function withShape(edit: PictureEdit, shape: ShapeId, natural: Size): PictureEdit {
  const size = turnedSize(natural, edit.turns);
  const ratio = shapeRatio(shape, size);
  return { ...edit, shape, crop: ratio ? fitCrop(ratio, size, centreOf(edit.crop)) : edit.crop };
}

/** A quarter turn keeps the same part of the picture in the crop, and a flip stays a flip as people see it. */
export function turnEdit(edit: PictureEdit, natural: Size, clockwise: boolean): PictureEdit {
  const size = turnedSize(natural, edit.turns);
  const { x, y, width, height } = edit.crop;
  const crop = clockwise
    ? { x: size.height - y - height, y: x, width: height, height: width }
    : { x: y, y: size.width - x - width, width: height, height: width };
  const turns = ((edit.turns + (clockwise ? 1 : 3)) % 4) as PictureEdit["turns"];
  const turned = { ...edit, turns, crop, flipX: edit.flipY, flipY: edit.flipX };
  const ratio = edit.shape === "free" || edit.shape === "original" ? null : shapeRatio(edit.shape, size);
  return ratio ? { ...turned, crop: fitCrop(ratio, turnedSize(natural, turns), centreOf(crop)) } : turned;
}

export function flipEdit(edit: PictureEdit, natural: Size, axis: "x" | "y"): PictureEdit {
  const size = turnedSize(natural, edit.turns);
  const { crop } = edit;
  return axis === "x"
    ? { ...edit, flipX: !edit.flipX, crop: { ...crop, x: size.width - crop.x - crop.width } }
    : { ...edit, flipY: !edit.flipY, crop: { ...crop, y: size.height - crop.y - crop.height } };
}

export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Where the crop goes when `handle` is dragged by (dx, dy): always inside, at least `min` across, and in `ratio` when one is set. */
export function dragCrop(start: Rect, handle: Handle, dx: number, dy: number, size: Size, ratio: number | null, min: number): Rect {
  if (handle === "move") {
    return { ...start, x: clamp(start.x + dx, 0, size.width - start.width), y: clamp(start.y + dy, 0, size.height - start.height) };
  }
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const right = start.x + start.width;
  const bottom = start.y + start.height;

  if (!ratio) {
    const left = west ? clamp(start.x + dx, 0, right - min) : start.x;
    const top = north ? clamp(start.y + dy, 0, bottom - min) : start.y;
    const across = east ? clamp(right + dx, left + min, size.width) - left : right - left;
    const down = south ? clamp(bottom + dy, top + min, size.height) - top : bottom - top;
    return { x: left, y: top, width: across, height: down };
  }

  let width = start.width + (east ? dx : west ? -dx : 0);
  const height = start.height + (south ? dy : north ? -dy : 0);
  // A corner follows whichever side the pointer pulls further, so the pointer stays on the edge.
  if ((west || east) && (north || south)) width = Math.max(width, height * ratio);
  else if (north || south) width = height * ratio;

  const anchorX = west ? right : east ? start.x : start.x + start.width / 2;
  const anchorY = north ? bottom : south ? start.y : start.y + start.height / 2;
  const roomX = west ? anchorX : east ? size.width - anchorX : 2 * Math.min(anchorX, size.width - anchorX);
  const roomY = north ? anchorY : south ? size.height - anchorY : 2 * Math.min(anchorY, size.height - anchorY);
  const widest = Math.min(roomX, roomY * ratio);
  width = clamp(width, Math.min(widest, Math.max(min, min * ratio)), widest);
  const tall = width / ratio;
  return {
    x: west ? anchorX - width : east ? anchorX : anchorX - width / 2,
    y: north ? anchorY - tall : south ? anchorY : anchorY - tall / 2,
    width,
    height: tall,
  };
}

/** Whole pixels, never past the picture's edge. */
export function pixelCrop(crop: Rect, size: Size): Rect {
  const x = clamp(Math.round(crop.x), 0, size.width - 1);
  const y = clamp(Math.round(crop.y), 0, size.height - 1);
  return { x, y, width: clamp(Math.round(crop.width), 1, size.width - x), height: clamp(Math.round(crop.height), 1, size.height - y) };
}

export function outputSize(crop: Rect, scale = 1): Size {
  const fit = Math.min(1, Math.sqrt(MAX_PIXELS / (crop.width * crop.height))) * scale;
  const round = fit < 1 ? Math.floor : Math.round;
  return { width: Math.max(1, round(crop.width * fit)), height: Math.max(1, round(crop.height * fit)) };
}

export function isUntouched(edit: PictureEdit, natural: Size): boolean {
  const crop = pixelCrop(edit.crop, natural);
  return !edit.turns && !edit.flipX && !edit.flipY && crop.x === 0 && crop.y === 0 && crop.width === natural.width && crop.height === natural.height;
}

/** A picture past Instagram's range is cut from the middle when it goes out, so the editor opens on the nearest shape it takes. */
export function suggestedShape(natural: Size, ranges: readonly { min: number; max: number }[]): ShapeId | undefined {
  const aspect = natural.width / natural.height;
  for (const range of ranges) {
    if (aspect < range.min) return "4:5";
    if (aspect > range.max) return "1.91:1";
  }
  return undefined;
}

type Encode = (scale: number, type: "image/png" | "image/jpeg", quality?: number) => Promise<Blob>;

/**
 * A PNG stays a PNG where it can, as it may be see-through; anything over `maxBytes` steps down to a smaller JPEG.
 * A cutout only ever shrinks: as a JPEG its background would be back, in white.
 */
export async function encodeWithin(encode: Encode, png: boolean, maxBytes: number, cutout = false): Promise<Blob> {
  for (const scale of [1, 0.75, 0.5]) {
    const tries: [("image/png" | "image/jpeg"), number?][] = cutout
      ? [["image/png"]]
      : png
        ? [["image/png"], ["image/jpeg", 0.92]]
        : [["image/jpeg", 0.92], ["image/jpeg", 0.85], ["image/jpeg", 0.75]];
    for (const [type, quality] of tries) {
      const blob = await encode(scale, type, quality);
      if (blob.size <= maxBytes) return blob;
    }
  }
  throw new Error(t("The picture is too big to save. Crop it smaller and try again."));
}

/** Browsers turn a JPG upright from its EXIF here, as `readMedia` does, so sizes agree. */
export async function loadPicture(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode().catch(() => {
    throw new Error(t("The picture could not be read."));
  });
  return image;
}

export async function renderPicture(image: HTMLImageElement, edit: PictureEdit, source: File, maxBytes: number, cutout = false): Promise<File> {
  const natural = { width: image.naturalWidth, height: image.naturalHeight };
  const size = turnedSize(natural, edit.turns);
  const crop = pixelCrop(edit.crop, size);
  const png = source.type === "image/png" || /\.png$/i.test(source.name);

  const encode: Encode = (scale, type, quality) => {
    const out = outputSize(crop, scale);
    const canvas = document.createElement("canvas");
    canvas.width = out.width;
    canvas.height = out.height;
    const context = canvas.getContext("2d");
    if (!context) return Promise.reject(new Error(t("The picture could not be read.")));
    if (type === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, out.width, out.height);
    }
    context.imageSmoothingQuality = "high";
    context.scale(out.width / crop.width, out.height / crop.height);
    context.translate(size.width / 2 - crop.x, size.height / 2 - crop.y);
    context.scale(edit.flipX ? -1 : 1, edit.flipY ? -1 : 1);
    context.rotate((edit.turns * Math.PI) / 2);
    context.drawImage(image, -natural.width / 2, -natural.height / 2, natural.width, natural.height);
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t("The picture could not be read.")))), type, quality),
    );
  };

  const blob = await encodeWithin(encode, png, maxBytes, cutout);
  const base = source.name.replace(/\.[^.]+$/, "") || "picture";
  const extension = blob.type === "image/png" ? ".png" : ".jpg";
  return new File([blob], `${base}${extension}`, { type: blob.type, lastModified: Date.now() });
}
