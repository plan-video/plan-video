/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A death notice drawn the way the KillFeed Generator draws Call of Duty,
// PUBG and Rust: one bar, the game's type, colors and pictures. One picture
// feeds both the builder's preview and the element put on the scene.

import { barGame, type BarGame, type BarStyle } from "./bar-killfeed-assets";
import { fitName, shareRoom, type FittedName } from "./killfeed-fit";
import { USUAL_NAME } from "./killfeed-feed";

export type BarSpec = {
  killer: string;
  victim: string;
  weapon: string;
  /** Extra ids, drawn in the game's order, after the weapon. */
  extras: string[];
};

export function defaultBarSpec(game: BarGame): BarSpec {
  return { killer: "Player1", victim: "Player2", weapon: game.defaultWeapon, extras: [] };
}

/** The game's default notice with names of a usual length: the narrowest a placed notice is. */
export function usualBarSpec(game: BarGame): BarSpec {
  return { ...defaultBarSpec(game), killer: USUAL_NAME, victim: USUAL_NAME };
}

const fontLoads = new Map<string, Promise<void>>();

function loadFont(style: BarStyle): Promise<void> {
  let loading = fontLoads.get(style.fontFamily);
  if (!loading) {
    loading = new FontFace(style.fontFamily, `url(${style.fontUrl})`, { weight: String(style.fontWeight) })
      .load()
      .then((face) => {
        document.fonts.add(face);
      })
      .catch((error: unknown) => {
        fontLoads.delete(style.fontFamily);
        throw error;
      });
    fontLoads.set(style.fontFamily, loading);
  }
  return loading;
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
type IconPart = { kind: "icon"; image: HTMLImageElement; width: number; flip: boolean };
type Part = TextPart | IconPart;

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.max(0, radius));
}

/** Draws the notice `scale` times its natural size, or `fixedWidth` wide (at the natural size), its names fitted into it. */
export async function renderBarKillfeed(game: BarGame, spec: BarSpec, scale = 1, fixedWidth?: number): Promise<HTMLCanvasElement> {
  const style = game.style;
  const weapon = game.weapons.find((item) => item.id === spec.weapon) ?? game.weapons.find((item) => item.id === game.defaultWeapon);
  if (!weapon) throw new Error(`No weapon for ${game.id}`);
  const selected = new Set(spec.extras);
  const extras = game.extras.filter((extra) => selected.has(extra.id));

  const [weaponImage, extraImages] = await Promise.all([
    loadImage(weapon.url),
    Promise.all(extras.map((extra) => loadImage(extra.url))),
    loadFont(style).catch(() => undefined),
  ]);

  const s = scale;
  const fontSize = style.fontSize * s;
  const iconH = style.icon * s;
  const padX = style.padX * s;
  const padY = style.padY * s;
  const gap = style.gap * s;
  const border = style.border * s;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `${style.fontWeight} ${fontSize}px "${style.fontFamily}"`;
  const font = (size: number) => `${style.fontWeight} ${size}px "${style.fontFamily}"`;
  const textWidth = (text: string) => Math.ceil(measure.measureText(text).width);
  const iconWidth = (image: HTMLImageElement) => (image.naturalWidth * iconH) / Math.max(1, image.naturalHeight);

  const icon = (image: HTMLImageElement, flip: boolean): IconPart => ({ kind: "icon", image, width: iconWidth(image), flip });
  const parts: Part[] = [
    { kind: "text", text: spec.killer, color: style.killer, width: textWidth(spec.killer) },
    icon(weaponImage, style.flipWeapon),
    ...extraImages.map((image) => icon(image, false)),
    { kind: "text", text: spec.victim, color: style.victim, width: textWidth(spec.victim) },
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

  rounded(ctx, 0, 0, width, height, style.radius * s);
  ctx.fillStyle = style.background;
  ctx.fill();

  if (border > 0) {
    rounded(ctx, border / 2, border / 2, width - border, height - border, style.radius * s - border / 2);
    ctx.lineWidth = border;
    ctx.strokeStyle = style.borderColor;
    ctx.stroke();
  }

  ctx.font = measure.font;
  ctx.textBaseline = "alphabetic";
  const reference = ctx.measureText("Hg");
  const ascent = reference.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = reference.actualBoundingBoxDescent || fontSize * 0.2;
  const contentTop = border + padY;
  const baseline = contentTop + iconH / 2 + (ascent - descent) / 2;

  if (style.shadow > 0) {
    const ratio = style.shadow / 100;
    ctx.shadowOffsetX = 50 * 0.02 * ratio * s;
    ctx.shadowOffsetY = 50 * 0.02 * ratio * s;
    ctx.shadowBlur = 50 * 0.1 * ratio * s;
    ctx.shadowColor = `rgba(0, 0, 0, ${(0.8 * ratio).toFixed(2)})`;
  }

  let x = border + padX;
  for (const [index, part] of parts.entries()) {
    // The victim's name, and half the room to spare, go after everything else.
    if (index === parts.length - 1) x += spare / 2;
    if (part.kind === "text") {
      const size = names[index === 0 ? 0 : 1]!.size;
      ctx.font = font(size);
      ctx.fillStyle = part.color;
      ctx.fillText(part.text, x, baseline + ((ascent - descent) * (size / fontSize - 1)) / 2);
    } else if (part.flip) {
      ctx.save();
      ctx.translate(x + part.width, contentTop);
      ctx.scale(-1, 1);
      ctx.drawImage(part.image, 0, 0, part.width, iconH);
      ctx.restore();
    } else {
      ctx.drawImage(part.image, x, contentTop, part.width, iconH);
    }
    x += part.width + gap;
    if (index === 0) x += spare / 2;
  }

  return element;
}

/** A file name for the notice's picture. */
export function barKillfeedFileName(spec: BarSpec): string {
  const clean = (text: string) => text.replace(/[\\/:*?"<>|]+/g, "").trim() || "Player";
  return `${clean(spec.killer)} vs ${clean(spec.victim)}.png`;
}

export function renderBarKillfeedById(id: string, spec: BarSpec, scale = 1): Promise<HTMLCanvasElement> {
  const game = barGame(id);
  if (!game) return Promise.reject(new Error(`No killfeed ${id}`));
  return renderBarKillfeed(game, spec, scale);
}
