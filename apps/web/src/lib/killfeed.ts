/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A Valorant killfeed entry for gameplay edits, drawn the way the Valorant
// Killfeed Generator draws it (github.com/mr-velosofy/FastAPI_KillfeedGenerator):
// same geometry, colors and pictures, in Riot Sans. One picture feeds both
// the builder's preview and the element put on the scene, so what the panel
// shows is what lands on the video.

import fontUrl from "@/assets/fonts/RiotSans-Bold.woff2?url";

import { killfeedAgent, killfeedUi, killfeedWeapon } from "./killfeed-assets";
import { fitName, shareRoom, type FittedName } from "./killfeed-fit";
import { USUAL_NAME } from "./killfeed-feed";

export type KillfeedPlayer = {
  name: string;
  /** Agent name, as in assets/killfeed/agents. */
  agent: string;
};

export type KillfeedSpec = {
  killer: KillfeedPlayer;
  victim: KillfeedPlayer;
  /** Weapon id (`weapons/Ares.png`); empty draws none. */
  weapon: string;
  /** The killer's streak this round; 3 and up draws the numeral. */
  kills: number;
  headshot: boolean;
  wallbang: boolean;
  /** The killer took themself out: they are on both sides. */
  suicide: boolean;
  /** The kill went against your team, so the sides swap colors. */
  enemyKill: boolean;
  /** The entry is yours: yellow, with a border and a pointer. */
  highlight: boolean;
};

export const DEFAULT_KILLFEED: KillfeedSpec = {
  killer: { name: "Astra", agent: "Astra" },
  victim: { name: "Astra", agent: "Astra" },
  weapon: "weapons/Vandal.png",
  kills: 1,
  headshot: false,
  wallbang: false,
  suicide: false,
  enemyKill: false,
  highlight: true,
};

/** The default kill with names of a usual length: the narrowest a placed entry is. */
export const USUAL_KILLFEED: KillfeedSpec = {
  ...DEFAULT_KILLFEED,
  killer: { ...DEFAULT_KILLFEED.killer, name: USUAL_NAME },
  victim: { ...DEFAULT_KILLFEED.victim, name: USUAL_NAME },
};

export const KILLFEED_FONT = "Riot Sans";
/** How long a new entry stays up. */
export const KILLFEED_SECONDS = 5;
export const KILLFEED_MAX_KILLS = 10;
/** The height every entry is drawn at, in picture pixels. */
export const KILLFEED_HEIGHT = 128;

/** Riot Sans at 61px has the cap height and advance the generator's DIN at 66px has. */
const FONT_SIZE = 61;
const PORTRAIT = { width: 256, height: 128 };
const WEAPON_HEIGHT = 90;
const BADGE = 72;
/** The skull sits inside its own padding, so it draws a little larger than the wallbang. */
const HEADSHOT = 84;
const BADGE_GAP = 10;
const PADDING = 40;
const TEXT_PADDING = 70;
const EDGE_GAP = Math.floor(TEXT_PADDING / 4);
const EDGE_WIDTH = 120;
/** How far the colored silhouette sits out from behind a portrait. */
const OUTLINE = 10;
/** The middle arrow: the killer's side ends in a point this deep. */
const NOTCH = 35;
const BORDER = 6;
/** The yellow border's top and bottom lines stop this short of the arrow. */
const BORDER_EARLY = 128;
const TRIANGLE = 64;
const NUMERAL = { size: 96, x: 12, y: 30 };

type Rgb = readonly [number, number, number];

const TEAL: Rgb = [87, 222, 196];
const RED: Rgb = [240, 91, 88];
const YELLOW: Rgb = [231, 237, 131];
const SUICIDE: Rgb = [178, 237, 219];
const ENEMY_SUICIDE: Rgb = [253, 147, 149];

const rgba = ([r, g, b]: Rgb, alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

let fontLoad: Promise<void> | undefined;

export function loadKillfeedFont(): Promise<void> {
  fontLoad ??= new FontFace(KILLFEED_FONT, `url(${fontUrl})`, { weight: "700" })
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

type Side = { name: string; portrait: HTMLImageElement; outline: Rgb; edge: Rgb; background: Rgb };

/** Which colors go where, and where the "yours" marks go, per kind of kill. */
function sides(spec: KillfeedSpec) {
  const me = spec.highlight;
  if (spec.suicide) {
    const killer = spec.enemyKill ? RED : TEAL;
    const suicide = spec.enemyKill ? ENEMY_SUICIDE : SUICIDE;
    return {
      left: { background: killer, edge: me ? YELLOW : killer, outline: me ? YELLOW : killer },
      right: { background: suicide, edge: me ? YELLOW : suicide, outline: me ? YELLOW : suicide },
      mark: { left: me, right: me },
      numeral: "Rev_Numeral",
    };
  }
  if (spec.enemyKill) {
    return {
      left: { background: RED, edge: RED, outline: RED },
      right: { background: TEAL, edge: me ? YELLOW : TEAL, outline: me ? YELLOW : TEAL },
      mark: { left: false, right: me },
      numeral: "Rev_Numeral",
    };
  }
  return {
    left: { background: TEAL, edge: me ? YELLOW : TEAL, outline: me ? YELLOW : TEAL },
    right: { background: RED, edge: RED, outline: RED },
    mark: { left: me, right: false },
    numeral: "Numeral",
  };
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement("canvas");
  element.width = Math.max(1, Math.ceil(width));
  element.height = Math.max(1, Math.ceil(height));
  return [element, element.getContext("2d")!];
}

/** The picture's silhouette in `color`, optionally mirrored, `scale` times its size. */
function silhouette(image: CanvasImageSource, width: number, height: number, color: Rgb | null, mirror: boolean, scale: number) {
  const [element, ctx] = canvas(width * scale, height * scale);
  ctx.imageSmoothingQuality = "high";
  ctx.scale(scale, scale);
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, 0, 0, width, height);
  if (color) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = rgba(color);
    ctx.fillRect(0, 0, element.width, element.height);
  }
  return element;
}

function polygon(ctx: CanvasRenderingContext2D, points: [number, number][]) {
  ctx.beginPath();
  points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/**
 * The yellow "yours" border on one end: a bar down the edge and lines along
 * the top and bottom that fade out before the middle arrow.
 */
function border(ctx: CanvasRenderingContext2D, edge: number, length: number, direction: 1 | -1) {
  const H = KILLFEED_HEIGHT;
  ctx.fillStyle = rgba(YELLOW);
  ctx.fillRect(direction === 1 ? edge : edge - BORDER, 0, BORDER, H);

  const from = edge + direction * BORDER;
  const to = from + direction * length;
  const fade = ctx.createLinearGradient(from, 0, to, 0);
  fade.addColorStop(0, rgba(YELLOW));
  fade.addColorStop(0.5, rgba(YELLOW));
  fade.addColorStop(1, rgba(YELLOW, 0));
  ctx.fillStyle = fade;
  const left = Math.min(from, to);
  ctx.fillRect(left, 0, length, BORDER);
  ctx.fillRect(left, H - BORDER, length, BORDER);
}

/**
 * Draws the entry `scale` times its natural size, which is `KILLFEED_HEIGHT`
 * tall and as wide as the names make it, or `width` wide (at the natural
 * size) with the streak's numeral and the pointers inside it: the room to
 * spare goes either side of the weapon, and names too long for it get
 * smaller, then cut short.
 */
export async function renderKillfeed(spec: KillfeedSpec, scale = 1, width?: number): Promise<HTMLCanvasElement> {
  const killerAgent = killfeedAgent(spec.killer.agent) ?? killfeedAgent(DEFAULT_KILLFEED.killer.agent)!;
  const victimPlayer = spec.suicide ? spec.killer : spec.victim;
  const victimAgent = killfeedAgent(victimPlayer.agent) ?? killfeedAgent(DEFAULT_KILLFEED.victim.agent)!;
  const weapon = spec.weapon ? killfeedWeapon(spec.weapon) : undefined;
  const numeral = spec.kills >= 3 ? Math.min(KILLFEED_MAX_KILLS, spec.kills) : null;
  const layout = sides(spec);

  const [, killerPortrait, victimPortrait, weaponImage, wallbang, headshot, triangle, numeralImage] = await Promise.all([
    loadKillfeedFont().catch(() => undefined),
    loadImage(killerAgent.portrait),
    loadImage(victimAgent.portrait),
    weapon ? loadImage(weapon.url) : null,
    spec.wallbang ? loadImage(killfeedUi("wallbang")) : null,
    spec.headshot ? loadImage(killfeedUi("headshot")) : null,
    layout.mark.left || layout.mark.right ? loadImage(killfeedUi("MeBorderTriangle")) : null,
    numeral ? loadImage(killfeedUi(`${layout.numeral}_${numeral}`)) : null,
  ]);

  const [, measure] = canvas(1, 1);
  const font = (size: number) => `700 ${size}px "${KILLFEED_FONT}"`;
  let killerName = fitName(measure, font, spec.killer.name, FONT_SIZE, Infinity);
  let victimName = fitName(measure, font, victimPlayer.name, FONT_SIZE, Infinity);

  const H = KILLFEED_HEIGHT;
  const weaponWidth = weaponImage ? Math.floor((weaponImage.naturalWidth * WEAPON_HEIGHT) / weaponImage.naturalHeight) : 0;
  const badges = [wallbang, headshot].filter((badge): badge is HTMLImageElement => !!badge);
  const badgeSize = (badge: HTMLImageElement) => (badge === headshot ? HEADSHOT : BADGE);
  const badgesWidth = badges.length ? PADDING + badges.reduce((sum, badge) => sum + badgeSize(badge) + BADGE_GAP, 0) : 0;

  // A standalone yellow pointer sits outside the entry; the team's own kill
  // drops it when the numeral takes that spot.
  const leftTriangle = layout.mark.left && !(numeral && !spec.suicide && !spec.enemyKill);
  const rightTriangle = layout.mark.right;
  const numeralWidth = numeral ? NUMERAL.size : 0;
  const offset = numeralWidth + (leftTriangle ? TRIANGLE : 0);
  const outside = offset + (rightTriangle ? TRIANGLE : 0);

  // Everything in the bar but the names.
  const frame = 2 * (PORTRAIT.width + EDGE_GAP + TEXT_PADDING) + weaponWidth + badgesWidth + PADDING;
  let spare = 0;
  if (width !== undefined) {
    const room = width - outside - frame;
    if (killerName.width + victimName.width > room) {
      const [killerRoom, victimRoom] = shareRoom(Math.max(0, room), killerName.width, victimName.width);
      killerName = fitName(measure, font, spec.killer.name, FONT_SIZE, killerRoom);
      victimName = fitName(measure, font, victimPlayer.name, FONT_SIZE, victimRoom);
    }
    spare = Math.max(0, room - killerName.width - victimName.width);
  }
  const killerWidth = killerName.width;
  const victimWidth = victimName.width;

  // The killer's half of the room to spare goes before the weapon, the victim's before their portrait.
  const leftTextX = PORTRAIT.width + EDGE_GAP;
  const weaponLeft = Math.floor(leftTextX + killerWidth + TEXT_PADDING + spare / 2);
  const weaponEnd = weaponLeft + weaponWidth + badgesWidth;
  const mx = weaponEnd + PADDING;
  const rightTextX = mx + TEXT_PADDING;
  const natural = Math.floor(rightTextX + victimWidth + EDGE_GAP + PORTRAIT.width);
  const barWidth = width !== undefined ? Math.max(natural, Math.round(width - outside)) : natural;
  const [element, ctx] = canvas((offset + barWidth + (rightTriangle ? TRIANGLE : 0)) * scale, H * scale);
  ctx.imageSmoothingQuality = "high";
  ctx.scale(scale, scale);

  ctx.save();
  ctx.translate(offset, 0);

  // Killer's side: fades in from nothing to its color at the arrow.
  ctx.save();
  polygon(ctx, [[0, 0], [mx - 20, 0], [mx, H / 2], [mx - 20, H], [0, H]]);
  ctx.clip();
  const killerFade = ctx.createLinearGradient(0, 0, mx, 0);
  killerFade.addColorStop(0, rgba(layout.left.background, 0));
  killerFade.addColorStop(1, rgba(layout.left.background));
  ctx.fillStyle = killerFade;
  ctx.fillRect(0, 0, mx + 1, H);
  ctx.restore();

  // Victim's side: cut around the arrow, fading out toward the far end.
  ctx.save();
  polygon(ctx, [[mx - NOTCH, 0], [barWidth, 0], [barWidth, H], [mx - NOTCH, H], [mx, H / 2]]);
  ctx.clip();
  ctx.clearRect(mx - NOTCH, 0, barWidth - mx + NOTCH, H);
  const reach = barWidth - mx;
  const victimFade = ctx.createLinearGradient(mx - NOTCH, 0, barWidth, 0);
  victimFade.addColorStop(0, rgba(layout.right.background, Math.max(0, 1 - NOTCH / reach)));
  victimFade.addColorStop(NOTCH / (reach + NOTCH), rgba(layout.right.background));
  victimFade.addColorStop(1, rgba(layout.right.background, 0));
  ctx.fillStyle = victimFade;
  ctx.fillRect(mx - NOTCH, 0, reach + NOTCH, H);
  ctx.restore();

  ctx.fillStyle = rgba(layout.left.edge);
  ctx.fillRect(0, 0, EDGE_WIDTH, H);
  ctx.fillStyle = rgba(layout.right.edge);
  ctx.fillRect(barWidth - EDGE_WIDTH, 0, EDGE_WIDTH, H);

  const killer: Side = { name: killerName.text, portrait: killerPortrait, ...layout.left };
  const victim: Side = { name: victimName.text, portrait: victimPortrait, ...layout.right };
  const portrait = (side: Side, color: Rgb | null, mirror: boolean, x: number) =>
    ctx.drawImage(silhouette(side.portrait, PORTRAIT.width, PORTRAIT.height, color, mirror, scale), x, 0, PORTRAIT.width, PORTRAIT.height);
  portrait(killer, killer.outline, false, OUTLINE);
  portrait(killer, null, false, 0);
  portrait(victim, victim.outline, true, barWidth - PORTRAIT.width - OUTLINE);
  portrait(victim, null, true, barWidth - PORTRAIT.width);

  if (weaponImage && weapon) {
    const picture = silhouette(weaponImage, weaponWidth, WEAPON_HEIGHT, null, weapon.group === "weapons", scale);
    ctx.drawImage(picture, weaponLeft, Math.floor((H - WEAPON_HEIGHT) / 2), weaponWidth, WEAPON_HEIGHT);
  }

  let badgeX = weaponLeft + weaponWidth + (badges.length ? PADDING : 0);
  for (const badge of badges) {
    const size = badgeSize(badge);
    ctx.drawImage(badge, badgeX, Math.floor((H - size) / 2), size, size);
    badgeX += size + BADGE_GAP;
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "alphabetic";
  const name = (fitted: FittedName, x: number) => {
    ctx.font = font(fitted.size);
    const reference = ctx.measureText("Xy");
    const baseline = Math.round(H / 2 + (reference.actualBoundingBoxAscent - reference.actualBoundingBoxDescent) / 2);
    ctx.fillText(fitted.text, x, baseline);
  };
  name(killerName, leftTextX);
  name(victimName, rightTextX);

  if (layout.mark.left) border(ctx, 0, Math.max(1, mx - BORDER - BORDER_EARLY), 1);
  if (layout.mark.right) border(ctx, barWidth, Math.max(1, barWidth - mx - BORDER - BORDER_EARLY), -1);
  ctx.restore();

  if (triangle) {
    const top = Math.floor((H - TRIANGLE) / 2);
    const pointer = (mirror: boolean, x: number) =>
      ctx.drawImage(silhouette(triangle, TRIANGLE, TRIANGLE, YELLOW, mirror, scale), x, top, TRIANGLE, TRIANGLE);
    if (leftTriangle) pointer(false, numeralWidth);
    if (rightTriangle) pointer(true, offset + barWidth);
  }
  if (numeralImage) ctx.drawImage(numeralImage, NUMERAL.x, NUMERAL.y, NUMERAL.size, NUMERAL.size);

  return element;
}

/** A file name for the entry's picture. */
export function killfeedFileName(spec: KillfeedSpec): string {
  const clean = (text: string) => text.replace(/[\\/:*?"<>|]+/g, "").trim() || "Player";
  const victim = spec.suicide ? "self" : clean(spec.victim.name);
  return `${clean(spec.killer.name)} vs ${victim}.png`;
}
