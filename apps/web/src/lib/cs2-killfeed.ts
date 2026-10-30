/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A Counter-Strike 2 death notice, drawn the way the CS2 KillFeed Generator
// draws it (github.com/StrikerProd09/killfeed-generator): the same bar, type,
// colors and pictures. One picture feeds both the builder's preview and the
// element put on the scene.

import fontUrl from "@/assets/fonts/StratumNo2-Bold.otf?url";

import { CS2_EXTRAS, cs2Weapon } from "./cs2-killfeed-assets";
import { fitName, shareRoom, type FittedName } from "./killfeed-fit";
import { USUAL_NAME } from "./killfeed-feed";

export type Cs2Side = "ct" | "t";

export type Cs2KillfeedSpec = {
  killer: string;
  victim: string;
  /** Weapon id, as in assets/killfeed-cs2/weapons. */
  weapon: string;
  /** The killer's side. CT is blue then gold, which is the generator's default. */
  side: Cs2Side;
  /** Extra ids, drawn in the generator's order. Fly sits before the weapon. */
  extras: string[];
};

export const DEFAULT_CS2_KILLFEED: Cs2KillfeedSpec = {
  killer: "Player1",
  victim: "Player2",
  weapon: "ak47",
  side: "ct",
  extras: [],
};

/** The default notice with names of a usual length: the narrowest a placed notice is. */
export const USUAL_CS2_KILLFEED: Cs2KillfeedSpec = { ...DEFAULT_CS2_KILLFEED, killer: USUAL_NAME, victim: USUAL_NAME };

export const CS2_KILLFEED_FONT = "Stratum No2";
/** The bar's height in picture pixels: icon, padding and the border. */
export const CS2_KILLFEED_HEIGHT = 46;
/** How tall a placed entry is at unit 1, matching the picture. */
export const CS2_ENTRY_HEIGHT = CS2_KILLFEED_HEIGHT;
/** Where the first in-game entry sits, near the top of a 1080 frame. */
export const CS2_TOP = 72;

const FONT_SIZE = 22;
const ICON = 30;
const PAD_X = 14;
const PAD_Y = 6;
const GAP = 10;
const BORDER = 2;
const RADIUS = 6;

const CT = "#a2aed5";
const T = "#f6d180";
const BACKGROUND = "rgba(12, 12, 12, 0.7)";
const BORDER_COLOR = "rgb(181, 72, 57)";

let fontLoad: Promise<void> | undefined;

export function loadCs2KillfeedFont(): Promise<void> {
  fontLoad ??= new FontFace(CS2_KILLFEED_FONT, `url(${fontUrl})`, { weight: "700" })
    .load()
    .then((face) => {
      document.fonts.add(face);
    })
    .catch((error: unknown) => {
      fontLoad = undefined;
      throw error;
    });
  return fontLoad;
}

const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let loading = images.get(url);
  if (!loading) {
    loading = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${url}`));
      image.src = url;
    });
    loading.catch(() => images.delete(url));
    images.set(url, loading);
  }
  return loading;
}

type TextPart = { kind: "text"; text: string; color: string; width: number };
type IconPart = { kind: "icon"; image: HTMLImageElement; width: number };
type Part = TextPart | IconPart;

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.max(0, radius));
}

/**
 * Draws the notice `scale` times its natural size, which is
 * `CS2_KILLFEED_HEIGHT` tall and as wide as the names and icons make it, or
 * `fixedWidth` wide (at the natural size), its names fitted into it.
 */
export async function renderCs2Killfeed(spec: Cs2KillfeedSpec, scale = 1, fixedWidth?: number): Promise<HTMLCanvasElement> {
  const weapon = cs2Weapon(spec.weapon) ?? cs2Weapon(DEFAULT_CS2_KILLFEED.weapon)!;
  const selected = new Set(spec.extras);
  const prefix = CS2_EXTRAS.filter((extra) => extra.place === "prefix" && selected.has(extra.id));
  const suffix = CS2_EXTRAS.filter((extra) => extra.place === "suffix" && selected.has(extra.id));

  const [weaponImage, prefixImages, suffixImages] = await Promise.all([
    loadImage(weapon.url),
    Promise.all(prefix.map((extra) => loadImage(extra.url))),
    Promise.all(suffix.map((extra) => loadImage(extra.url))),
    loadCs2KillfeedFont().catch(() => undefined),
  ]);

  const s = scale;
  const fontSize = FONT_SIZE * s;
  const iconH = ICON * s;
  const padX = PAD_X * s;
  const padY = PAD_Y * s;
  const gap = GAP * s;
  const border = BORDER * s;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `700 ${fontSize}px "${CS2_KILLFEED_FONT}"`;
  const font = (size: number) => `700 ${size}px "${CS2_KILLFEED_FONT}"`;
  const textWidth = (text: string) => Math.ceil(measure.measureText(text).width);
  const iconWidth = (image: HTMLImageElement) => (image.naturalWidth * iconH) / image.naturalHeight;

  const killerColor = spec.side === "ct" ? CT : T;
  const victimColor = spec.side === "ct" ? T : CT;
  const icon = (image: HTMLImageElement): IconPart => ({ kind: "icon", image, width: iconWidth(image) });
  const parts: Part[] = [
    { kind: "text", text: spec.killer, color: killerColor, width: textWidth(spec.killer) },
    ...prefixImages.map(icon),
    icon(weaponImage),
    ...suffixImages.map(icon),
    { kind: "text", text: spec.victim, color: victimColor, width: textWidth(spec.victim) },
  ];

  // In a set width the names give way when too long, and the room to
  // spare goes either side of what's between them.
  const killerPart = parts[0] as TextPart;
  const victimPart = parts[parts.length - 1] as TextPart;
  const names: FittedName[] = [
    { text: killerPart.text, size: fontSize, width: killerPart.width },
    { text: victimPart.text, size: fontSize, width: victimPart.width },
  ];
  const frame = parts.reduce((sum, part) => sum + part.width, 0) - killerPart.width - victimPart.width + gap * Math.max(0, parts.length - 1) + padX * 2 + border * 2;
  let spare = 0;
  if (fixedWidth !== undefined) {
    const room = fixedWidth * s - frame;
    if (killerPart.width + victimPart.width > room) {
      const [killerRoom, victimRoom] = shareRoom(Math.max(0, room), killerPart.width, victimPart.width);
      names[0] = fitName(measure, font, killerPart.text, fontSize, killerRoom);
      names[1] = fitName(measure, font, victimPart.text, fontSize, victimRoom);
      measure.font = font(fontSize);
      Object.assign(killerPart, { text: names[0].text, width: names[0].width });
      Object.assign(victimPart, { text: names[1].text, width: names[1].width });
    }
    spare = Math.max(0, room - killerPart.width - victimPart.width);
  }
  const contentWidth = parts.reduce((sum, part) => sum + part.width, 0) + gap * Math.max(0, parts.length - 1);
  const width = Math.ceil(Math.max(contentWidth + padX * 2 + border * 2, fixedWidth !== undefined ? fixedWidth * s : 0));
  const height = Math.ceil(iconH + padY * 2 + border * 2);

  const element = document.createElement("canvas");
  element.width = Math.max(1, width);
  element.height = Math.max(1, height);
  const ctx = element.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";

  rounded(ctx, 0, 0, width, height, RADIUS * s);
  ctx.fillStyle = BACKGROUND;
  ctx.fill();

  rounded(ctx, border / 2, border / 2, width - border, height - border, RADIUS * s - border / 2);
  ctx.lineWidth = border;
  ctx.strokeStyle = BORDER_COLOR;
  ctx.stroke();

  ctx.font = measure.font;
  ctx.textBaseline = "alphabetic";
  const reference = ctx.measureText("Hg");
  const ascent = reference.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = reference.actualBoundingBoxDescent || fontSize * 0.2;
  const contentTop = border + padY;
  const baseline = contentTop + iconH / 2 + (ascent - descent) / 2;

  ctx.shadowOffsetX = 0.7 * s;
  ctx.shadowOffsetY = 0.7 * s;
  ctx.shadowBlur = 3.5 * s;
  ctx.shadowColor = "rgba(0, 0, 0, 0.56)";

  let x = border + padX;
  for (const [index, part] of parts.entries()) {
    // The victim's name, and half the room to spare, go after everything else.
    if (index === parts.length - 1) x += spare / 2;
    if (part.kind === "text") {
      const size = names[index === 0 ? 0 : 1]!.size;
      ctx.font = font(size);
      ctx.fillStyle = part.color;
      ctx.fillText(part.text, x, baseline + ((ascent - descent) * (size / fontSize - 1)) / 2);
    } else {
      ctx.drawImage(part.image, x, contentTop, part.width, iconH);
    }
    x += part.width + gap;
    if (index === 0) x += spare / 2;
  }

  return element;
}

/** A file name for the notice's picture. */
export function cs2KillfeedFileName(spec: Cs2KillfeedSpec): string {
  const clean = (text: string) => text.replace(/[\\/:*?"<>|]+/g, "").trim() || "Player";
  return `${clean(spec.killer)} vs ${clean(spec.victim)}.png`;
}
