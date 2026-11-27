/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reads Valorant's own killfeed out of video frames: where each entry is, whose it is, and who killed whom with what.
// Lengths are in pixels of a 1080-tall frame (`unit` scales them) or, once an entry is cut out, of a 32-tall row.

export type Rgba = { data: ArrayLike<number>; width: number; height: number };

export type FeedRow = {
  top: number;
  bottom: number;
  /** Where the victim's colour starts. */
  notch: number;
  right: number;
  enemyKill: boolean;
  mine: "killer" | "victim" | null;
  /** The white around the notch, small, to tell entries apart. */
  print: Float32Array;
};

/** One entry cut out of the frame, scaled to `ROW` tall. `notch` is in its pixels. */
export type RowPicture = Rgba & { notch: number };

export type KillArt = {
  /** `ROW * 2` wide and `ROW` tall, facing as the killer's does. */
  agents: { name: string; picture: Rgba }[];
  /** `WEAPON` tall, facing as drawn in the feed. */
  weapons: { id: string; picture: Rgba }[];
  /** `BADGE` square. */
  headshot: Rgba;
};

export type ReadKill = {
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
};

/** An entry's height once cut out; the art is drawn to fit it. */
export const ROW = 32;
/** On a 128-tall entry the weapon is 90 and the skull 84 (lib/killfeed.ts). */
export const WEAPON = Math.round((90 * ROW) / 128);
export const BADGE = Math.round((84 * ROW) / 128);

const TEAL = 1;
const RED = 2;
const YELLOW = 3;

function kind(r: number, g: number, b: number): number {
  if (r > 140 && g > 140 && b < Math.min(r, g) - 45 && Math.abs(r - g) < 60) return YELLOW;
  if (g > 120 && b > 100 && g - r > 45 && b - r > 30 && Math.abs(g - b) < 80) return TEAL;
  if (r > 150 && r - g > 70 && r - b > 60) return RED;
  return 0;
}

/** Where a run of the killer's colour meets a run of the victim's on one line. */
type Meeting = { y: number; x: number; enemyKill: boolean };

function meetings(kinds: Uint8Array, width: number, y: number, unit: number): Meeting[] {
  const found: Meeting[] = [];
  const leftRun = Math.max(3, Math.round(6 * unit));
  const rightRun = Math.max(5, Math.round(10 * unit));
  const gap = Math.max(1, Math.round(3 * unit));
  const row = y * width;
  let x = 0;
  while (x < width) {
    const color = kinds[row + x]!;
    let end = x;
    while (end < width && kinds[row + end] === color) end++;
    if ((color === TEAL || color === RED) && end - x >= leftRun) {
      const other = color === TEAL ? RED : TEAL;
      let start = end;
      while (start < width && start - end <= gap && kinds[row + start] !== other) start++;
      // The victim's name can start soon after the notch, so this side only has to be mostly its colour.
      if (start < width && start - end <= gap && start + rightRun <= width) {
        let count = 0;
        for (let at = start; at < start + rightRun; at++) if (kinds[row + at] === other) count++;
        if (count >= rightRun * 0.6) found.push({ y, x: start, enemyKill: color === RED });
      }
    }
    x = end;
  }
  return found;
}

function classify(frame: Rgba): Uint8Array {
  const { data, width, height } = frame;
  const kinds = new Uint8Array(width * height);
  for (let index = 0, at = 0; index < kinds.length; index++, at += 4) kinds[index] = kind(data[at]!, data[at + 1]!, data[at + 2]!);
  return kinds;
}

const PRINT_W = 48;
const PRINT_H = 6;

/** The white of names, weapon and skull: opaque, where the panel behind them lets the scene through. */
function print(frame: Rgba, left: number, right: number, top: number, bottom: number): Float32Array {
  const out = new Float32Array(PRINT_W * PRINT_H);
  const { width } = frame;
  for (let py = 0; py < PRINT_H; py++) {
    for (let px = 0; px < PRINT_W; px++) {
      const x0 = Math.floor(left + ((right - left) * px) / PRINT_W);
      const x1 = Math.max(x0 + 1, Math.floor(left + ((right - left) * (px + 1)) / PRINT_W));
      const y0 = Math.floor(top + ((bottom - top) * py) / PRINT_H);
      const y1 = Math.max(y0 + 1, Math.floor(top + ((bottom - top) * (py + 1)) / PRINT_H));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          sum += whiteness(frame, (y * width + x) * 4);
          count++;
        }
      }
      out[py * PRINT_W + px] = sum / count;
    }
  }
  return out;
}

/** The white of the weapon, skull and victim's name around the notch: enough to follow one entry from frame to frame. */
function printOf(frame: Rgba, notch: number, top: number, bottom: number): Float32Array {
  const tall = bottom - top;
  return print(frame, Math.max(0, notch - 3 * tall), Math.min(frame.width, notch + 3 * tall), top + 0.2 * tall, bottom - 0.2 * tall);
}

/** The entries in a crop of a frame's top right. `unit` is the frame's height over 1080. */
export function readRows(frame: Rgba, unit: number): FeedRow[] {
  const kinds = classify(frame);
  const { width, height } = frame;
  const lines: Meeting[] = [];
  for (let y = 0; y < height; y++) lines.push(...meetings(kinds, width, y, unit));

  // Lines that meet at about the same x, one under the other, are one entry.
  const groups: Meeting[][] = [];
  const near = 12 * unit;
  for (const line of lines) {
    const group = groups.find((lines) => {
      const last = lines[lines.length - 1]!;
      return last.enemyKill === line.enemyKill && line.y - last.y <= Math.max(2, 3 * unit) && line.y !== last.y && Math.abs(line.x - last.x) <= near;
    });
    if (group) group.push(line);
    else groups.push([line]);
  }

  // Glare through the see-through panel can wash out a few lines of one entry and split it in two; two
  // entries together are twice as tall as one, so halves that only add up to one are joined.
  const middle = (lines: Meeting[]) => lines[Math.floor(lines.length / 2)]!.x;
  const joined: Meeting[][] = [];
  for (const group of groups.sort((a, b) => a[0]!.y - b[0]!.y)) {
    const last = joined[joined.length - 1];
    const fits = last && last[0]!.enemyKill === group[0]!.enemyKill && Math.abs(middle(last) - middle(group)) <= near;
    if (fits && group[group.length - 1]!.y + 1 - last[0]!.y <= 40 * unit) last.push(...group);
    else joined.push(group);
  }

  const rows: FeedRow[] = [];
  for (const group of joined) {
    const top = group[0]!.y;
    const bottom = group[group.length - 1]!.y + 1;
    const tall = bottom - top;
    if (tall < 20 * unit || tall > 50 * unit || group.length < tall * 0.6) continue;
    const xs = group.map((line) => line.x).sort((a, b) => a - b);
    const notch = xs[Math.floor(xs.length / 2)]!;
    const enemyKill = group[0]!.enemyKill;
    const victimColor = enemyKill ? TEAL : RED;

    // The victim's picture covers most of the entry's end, so this can fall short; `columnRight` evens it out.
    let right = notch;
    const reach = Math.round(1.2 * tall);
    for (let x = notch; x < width && x - right <= reach; x++) {
      for (let y = top; y < bottom; y++) {
        const at = kinds[y * width + x];
        if (at === victimColor || at === YELLOW) {
          right = x;
          break;
        }
      }
    }

    // Yours has a yellow bar at your end, and yellow lines along its edges that draw in over a second.
    // Yellow in an agent's picture (Neon, Sova's hair) never fills a column top to bottom.
    const edge = Math.max(2, Math.round(3 * unit));
    // The lines are a pixel or two thick; yellow light showing through the gap between entries is thicker.
    const yellowAt = (x: number, y: number) => y >= 0 && y < height && kinds[y * width + x] === YELLOW;
    const lined = (from: number, to: number, y0: number) => {
      let count = 0;
      for (let x = Math.max(0, from); x < Math.min(width, to); x++) {
        for (let y = Math.max(0, y0 - edge); y <= Math.min(height - 1, y0 + edge); y++) {
          if (!yellowAt(x, y)) continue;
          let run = 1;
          while (yellowAt(x, y + run)) run++;
          for (let up = y - 1; yellowAt(x, up); up--) run++;
          if (run <= edge) count++;
          break;
        }
      }
      return count;
    };
    const barred = (from: number, to: number) => {
      let run = 0;
      for (let x = Math.max(0, from); x < Math.min(width, to); x++) {
        let filled = 0;
        for (let y = top; y < bottom; y++) if (kinds[y * width + x] === YELLOW) filled++;
        run = filled >= 0.8 * tall ? run + 1 : 0;
        if (run >= edge) return true;
      }
      return false;
    };
    const from = Math.round(notch - 8 * tall);
    const to = Math.round(notch - tall);
    const killerLined = Math.min(lined(from, notch, top), lined(from, notch, bottom - 1)) >= 1.5 * tall;
    // You are always on your team's colour: your kills are teal on the killer's side, your deaths red.
    const mine = !enemyKill && (killerLined || barred(from, to)) ? "killer"
      : enemyKill && barred(right - Math.round(0.6 * tall), right + Math.round(0.6 * tall)) ? "victim" : null;

    rows.push({ top, bottom, notch, right, enemyKill, mine, print: printOf(frame, notch, top, bottom) });
  }
  return rows.sort((a, b) => a.top - b.top);
}

/** Where the column of entries ends on the right, and how tall an entry is: the same for every entry, though one frame's reading can fall short. */
export type Column = { right: number; tall: number };

export function measureColumn(rows: FeedRow[]): Column | null {
  if (!rows.length) return null;
  const counts = new Map<number, number>();
  for (const row of rows) {
    const key = Math.round(row.right / 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let top: [number, number] = [0, 0];
  for (const entry of counts) if (entry[1] > top[1]) top = entry;
  const right = Math.max(...rows.filter((row) => Math.abs(row.right / 3 - top[0]) <= 1).map((row) => row.right));
  const talls = rows.map((row) => row.bottom - row.top).sort((a, b) => a - b);
  return { right, tall: talls[Math.floor(talls.length * 0.8)]! };
}

export type Track = {
  first: number;
  last: number;
  seen: number;
  /** Where it is now; the stack moves it up. */
  row: FeedRow;
  /** Where it came in. */
  arrived: FeedRow;
  /** Yours as killer or victim; the yellow that shows it can fade in after the entry. */
  mine: FeedRow["mine"];
  /** Cut once it has settled, a few frames in. */
  picture?: RowPicture;
  /** How tall the entry was found in the sighting it was cut from. */
  cutFrom: number;
};

const SETTLED = 3;
/** How alike an entry must look from one frame to the next to be the same one. */
const LIKE = 0.3;
/**
 * Further apart than this, frames are across a gap, a flash or smoke hiding the feed: entries are followed afresh
 * after it, since the stack may have moved meanwhile, and `gatherKills` joins the two sightings of each.
 */
const NEXT = 0.25;

/**
 * Follows entries from frame to frame, through the stack moving up and a flash hiding it. The feed keeps its order:
 * new entries join at the bottom and old ones leave from the top, so a frame's entries are paired with the previous
 * frame's in order, the pairing that fits best. Two entries alike enough to swap (the same gun and skull, in the same
 * place) can't, then.
 */
export function createTracker() {
  const tracks: Track[] = [];
  let before: Track[] = [];
  let beforeTime = -Infinity;
  return {
    see(time: number, frame: Rgba, rows: FeedRow[], column: Column, unit: number) {
      if (!rows.length) return;
      if (time - beforeTime > NEXT + 1e-6) before = [];
      const fit = (track: Track, row: FeedRow) => {
        if (track.row.enemyKill !== row.enemyKill || Math.abs(track.row.notch - row.notch) > 6 * unit) return -1;
        const alike = correlation(track.row.print, row.print);
        return alike >= LIKE ? 1 + alike : -1;
      };

      const n = before.length;
      const m = rows.length;
      const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
      for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
          const pair = fit(before[i - 1]!, rows[j - 1]!);
          best[i]![j] = Math.max(best[i - 1]![j]!, best[i]![j - 1]!, pair > 0 ? best[i - 1]![j - 1]! + pair : -Infinity);
        }
      }
      const pairs = new Map<FeedRow, Track>();
      for (let i = n, j = m; i > 0 && j > 0; ) {
        if (best[i]![j] === best[i - 1]![j]) i--;
        else if (best[i]![j] === best[i]![j - 1]) j--;
        else {
          pairs.set(rows[j - 1]!, before[i - 1]!);
          i--;
          j--;
        }
      }

      const now: Track[] = [];
      for (const row of rows) {
        let track = pairs.get(row);
        if (!track) {
          track = { first: time, last: time, seen: 0, row, arrived: row, mine: null, cutFrom: 0 };
          tracks.push(track);
        }
        now.push(track);
        track.row = row;
        track.last = time;
        track.mine = row.mine ?? track.mine;
        track.seen++;
        // Once settled, from the sighting found fullest: one caught mid-slide is found short and cut off-centre.
        const tall = row.bottom - row.top;
        if (!track.picture || (track.seen >= SETTLED && tall > track.cutFrom)) {
          track.picture = cutRow(frame, row, column);
          track.cutFrom = track.seen >= SETTLED ? tall : 0;
        }
      }
      before = now;
      beforeTime = time;
    },
    /** Yours, seen more than once so not a frame's noise. */
    kills: () => tracks.filter((track) => track.mine && track.seen >= 2).sort((a, b) => a.first - b.first),
  };
}

function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    ab += da * db;
    aa += da * da;
    bb += db * db;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

/** Bilinear, so a scaled-down entry keeps its thin lines. */
function resample(source: Rgba, left: number, top: number, width: number, height: number, outWidth: number, outHeight: number): Rgba {
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  const sx = width / outWidth;
  const sy = height / outHeight;
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      // Averages the box each output pixel covers.
      const x0 = left + x * sx;
      const y0 = top + y * sy;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      const steps = Math.max(1, Math.round(Math.max(sx, sy)));
      for (let j = 0; j < steps; j++) {
        for (let i = 0; i < steps; i++) {
          const px = Math.min(source.width - 1, Math.max(0, Math.floor(x0 + ((i + 0.5) * sx) / steps)));
          const py = Math.min(source.height - 1, Math.max(0, Math.floor(y0 + ((j + 0.5) * sy) / steps)));
          const at = (py * source.width + px) * 4;
          r += source.data[at]!;
          g += source.data[at + 1]!;
          b += source.data[at + 2]!;
          a += source.data[at + 3]!;
          count++;
        }
      }
      const out = (y * outWidth + x) * 4;
      data[out] = r / count;
      data[out + 1] = g / count;
      data[out + 2] = b / count;
      data[out + 3] = a / count;
    }
  }
  return { data, width: outWidth, height: outHeight };
}

/** The entry `row` scaled to `ROW` tall, from as far left as a long name reaches. */
function cutRow(frame: Rgba, row: FeedRow, column: Column): RowPicture {
  const { tall } = column;
  const scale = ROW / tall;
  const top = (row.top + row.bottom - tall) / 2;
  const left = Math.max(0, Math.round(row.notch - 14 * tall));
  // Past the column's end: an end read short (a picture with none of the victim's colour behind it) can't crop the victim.
  const right = Math.min(frame.width, column.right + Math.round(3 * tall));
  const width = Math.max(1, Math.round((right - left) * scale));
  return { ...resample(frame, left, top, right - left, tall, width, ROW), notch: Math.round((row.notch - left) * scale) };
}

/** How white a pixel is, which is all a weapon or skull in the feed is. */
function whiteness(picture: Rgba, at: number): number {
  const r = picture.data[at]!;
  const g = picture.data[at + 1]!;
  const b = picture.data[at + 2]!;
  const low = Math.min(r, g, b);
  if (Math.max(r, g, b) - low >= 60) return 0;
  return Math.max(0, Math.min(1, (low - 150) / 70));
}

/** A picture's opaque pixels, ready to be compared with what is under them. */
type ColorTemplate = { width: number; height: number; at: Int32Array; values: Float32Array; sum: number; squares: number };
/** A shape's opacity over its whole box. */
type ShapeTemplate = { width: number; height: number; alpha: Float32Array; sum: number; squares: number };

export type PreparedArt = {
  killers: { name: string; template: ColorTemplate }[];
  victims: { name: string; template: ColorTemplate }[];
  weapons: { id: string; template: ShapeTemplate }[];
  headshot: ShapeTemplate;
};

function colorTemplate(picture: Rgba): ColorTemplate {
  const at: number[] = [];
  const values: number[] = [];
  let sum = 0;
  let squares = 0;
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) {
      const index = (y * picture.width + x) * 4;
      if (picture.data[index + 3]! < 200) continue;
      at.push(y * 4096 + x);
      for (let c = 0; c < 3; c++) {
        const value = picture.data[index + c]!;
        values.push(value);
        sum += value;
        squares += value * value;
      }
    }
  }
  return { width: picture.width, height: picture.height, at: Int32Array.from(at), values: Float32Array.from(values), sum, squares };
}

function shapeTemplate(picture: Rgba): ShapeTemplate {
  const alpha = new Float32Array(picture.width * picture.height);
  let sum = 0;
  let squares = 0;
  for (let index = 0; index < alpha.length; index++) {
    const value = picture.data[index * 4 + 3]! / 255;
    alpha[index] = value;
    sum += value;
    squares += value * value;
  }
  return { width: picture.width, height: picture.height, alpha, sum, squares };
}

export function prepareArt(art: KillArt): PreparedArt {
  return {
    killers: art.agents.map(({ name, picture }) => ({ name, template: colorTemplate(picture) })),
    victims: art.agents.map(({ name, picture }) => ({ name, template: colorTemplate(mirror(picture)) })),
    weapons: art.weapons.map(({ id, picture }) => ({ id, template: shapeTemplate(picture) })),
    headshot: shapeTemplate(art.headshot),
  };
}

const ncc = (n: number, sp: number, st: number, spp: number, stt: number, spt: number) => {
  const vp = spp - (sp * sp) / n;
  const vt = stt - (st * st) / n;
  return vp > 0 && vt > 0 ? (spt - (sp * st) / n) / Math.sqrt(vp * vt) : -1;
};

/** Normalised cross-correlation of the template's opaque pixels with the picture under them. */
function matchColor(picture: Rgba, template: ColorTemplate, ox: number, oy: number): number {
  if (ox < 0 || oy < 0 || ox + template.width > picture.width || oy + template.height > picture.height) return -1;
  let sp = 0;
  let spp = 0;
  let spt = 0;
  const { at, values } = template;
  for (let index = 0; index < at.length; index++) {
    const spot = at[index]!;
    const p = ((oy + (spot >> 12)) * picture.width + ox + (spot & 4095)) * 4;
    for (let c = 0; c < 3; c++) {
      const a = picture.data[p + c]!;
      sp += a;
      spp += a * a;
      spt += a * values[index * 3 + c]!;
    }
  }
  return values.length < 30 ? -1 : ncc(values.length, sp, template.sum, spp, template.squares, spt);
}

/** Correlation of the template's shape with the white in the picture, over the template's whole box. */
function matchShape(white: Float32Array, width: number, height: number, template: ShapeTemplate, ox: number, oy: number): number {
  if (ox < 0 || oy < 0 || ox + template.width > width || oy + template.height > height) return -1;
  let sp = 0;
  let spp = 0;
  let spt = 0;
  for (let y = 0; y < template.height; y++) {
    const row = (oy + y) * width + ox;
    const own = y * template.width;
    for (let x = 0; x < template.width; x++) {
      const a = white[row + x]!;
      sp += a;
      spp += a * a;
      spt += a * template.alpha[own + x]!;
    }
  }
  return ncc(template.width * template.height, sp, template.sum, spp, template.squares, spt);
}

type Best<T> = { item: T; score: number; x: number; y: number };

function search<T>(items: T[], xs: [number, number], ys: [number, number], step: number, score: (item: T, x: number, y: number) => number): Best<T> | null {
  let top: Best<T> | null = null;
  for (const item of items) {
    for (let y = ys[0]; y <= ys[1]; y++) {
      for (let x = Math.round(xs[0]); x <= Math.round(xs[1]); x += step) {
        const value = score(item, x, y);
        if (!top || value > top.score) top = { item, score: value, x, y };
      }
    }
  }
  return top;
}

/** Mirrors left to right. */
function mirror(picture: Rgba): Rgba {
  const data = new Uint8ClampedArray(picture.width * picture.height * 4);
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) {
      const from = (y * picture.width + x) * 4;
      const to = (y * picture.width + (picture.width - 1 - x)) * 4;
      for (let c = 0; c < 4; c++) data[to + c] = picture.data[from + c]!;
    }
  }
  return { data, width: picture.width, height: picture.height };
}

export type Reading = ReadKill & {
  scores: { killer: number; victim: number; weapon: number; headshot: number };
  /** How well each agent fits each side, wherever it fits best. */
  fits: { killer: Record<string, number>; victim: Record<string, number> };
  /** Where each player's name is written, across the cut-out entry. */
  names: { killer: [number, number]; victim: [number, number] };
};

/** The gap a 128-tall entry leaves before and after its skull (lib/killfeed.ts). */
const PADDING = Math.round((40 * ROW) / 128);
const CENTRED = (size: number): [number, number] => [Math.floor((ROW - size) / 2) - 1, Math.floor((ROW - size) / 2) + 1];

/** Who killed whom with what, from one cut-out entry. */
export function readKill(row: RowPicture, art: PreparedArt): Reading | null {
  const color = (agent: { template: ColorTemplate }, x: number, y: number) => matchColor(row, agent.template, x, y);
  // Names of any length move both pictures, so look along each side coarsely, then closely at the likeliest.
  const locate = <T extends { name: string; template: ColorTemplate }>(agents: T[], from: number, to: number) => {
    const all = agents
      .map((agent) => search([agent], [from, to], [0, 0], 2, color))
      .filter((found): found is Best<T> => !!found)
      .sort((a, b) => b.score - a.score);
    let best: Best<T> | null = null;
    for (const guess of all.slice(0, 3)) {
      const close = search([guess.item], [guess.x - 2, guess.x + 2], [-1, 1], 1, color);
      if (close && (!best || close.score > best.score)) best = close;
    }
    return { best, fits: Object.fromEntries(all.map((found) => [found.item.name, found.score])) };
  };
  const { best: victim, fits: victimFits } = locate(art.victims, row.notch, row.width - 2 * ROW);
  const { best: killer, fits: killerFits } = locate(art.killers, 0, row.notch - 3 * ROW);
  if (!victim || !killer) return null;

  const white = new Float32Array(row.width * ROW);
  for (let index = 0; index < white.length; index++) white[index] = whiteness(row, index * 4);
  const shape = (template: ShapeTemplate, x: number, y: number) => matchShape(white, row.width, ROW, template, x, y);

  // The skull sits a gap before the notch, and the weapon a gap before the skull or the notch.
  const badgeRight = row.notch - PADDING;
  const headshot = search([art.headshot], [badgeRight - BADGE - 12, badgeRight - BADGE + 4], CENTRED(BADGE), 1, shape);
  const shot = !!headshot && headshot.score > 0.4;
  const weaponRight = shot ? headshot.x - PADDING : badgeRight;
  const lefts = new Map<PreparedArt["weapons"][number], number>();
  const weapon = search(art.weapons, [0, 0], CENTRED(WEAPON), 1, (item, _x, y) => {
    let top = -1;
    for (let x = weaponRight - item.template.width - 16; x <= weaponRight - item.template.width + 10; x++) {
      const score = shape(item.template, x, y);
      if (score > top) {
        top = score;
        lefts.set(item, x);
      }
    }
    return top;
  });
  // The names sit between each picture and the middle: after the killer's to the weapon, after the notch to the victim's.
  const killerEnd = killer.x + 2 * ROW;
  const weaponLeft = weapon ? (lefts.get(weapon.item) ?? weaponRight) : weaponRight;

  return {
    killer: killer.item.name,
    victim: victim.item.name,
    weapon: weapon?.item.id ?? "",
    headshot: shot,
    scores: { killer: killer.score, victim: victim.score, weapon: weapon?.score ?? -1, headshot: headshot?.score ?? -1 },
    fits: { killer: killerFits, victim: victimFits },
    names: { killer: [killerEnd, Math.max(killerEnd, weaponLeft)], victim: [row.notch + 2, Math.max(row.notch + 2, victim.x + 4)] },
  };
}

export type FoundKill = ReadKill & {
  /** Seconds into the video. */
  time: number;
  /** Where it first showed, to find the frame it came in on. */
  row: FeedRow;
  /** Your death, rather than your kill. */
  death: boolean;
  /** Your kills so far, this one counted, since you last died. */
  streak: number;
  /** The entry as read, and where its players' names are written on it. */
  picture: RowPicture;
  names: Reading["names"];
};

/** Long enough for the stack to shuffle, shorter than a round. */
const SAME_KILL = 20;
/** Sightings of an entry, half a second of them, for it to have been read standing still. */
const STEADY = 5;

/** One per kill or death, in order: a track that lost its entry for a moment reads the same twice. */
/** Below this the victim's picture wasn't really found: the entry was cut mid-move or mid-fade. */
const SURE = 0.55;

export type Sighting = {
  time: number;
  death: boolean;
  seen: number;
  /** Where it came in. */
  row: FeedRow;
  /** What `kill` was read from. */
  picture: RowPicture;
  kill: Reading;
};

const sure = (read: Sighting[]) => read.filter((entry) => entry.kill.scores.victim >= SURE);

/** You are the same picture in each entry, so the agent that fits your side best over all of them is you. */
export function whoAmI(read: Sighting[]): string | undefined {
  const fit = new Map<string, number>();
  for (const { death, kill } of sure(read)) {
    for (const [name, score] of Object.entries(death ? kill.fits.victim : kill.fits.killer)) fit.set(name, (fit.get(name) ?? 0) + score);
  }
  return [...fit].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function gatherKills(read: Sighting[], me = whoAmI(read)): FoundKill[] {
  const sorted = sure(read).sort((a, b) => a.time - b.time);

  const groups: { key: string; last: number; members: typeof sorted }[] = [];
  for (const entry of sorted) {
    // You die once a round, and each enemy does.
    const key = entry.death ? "death" : entry.kill.victim;
    const group = groups.find((group) => group.key === key && entry.time - group.last <= SAME_KILL);
    if (group) {
      group.members.push(entry);
      group.last = entry.time;
    } else groups.push({ key, last: entry.time, members: [entry] });
  }

  let streak = 0;
  return groups
    .map(({ members }) => {
      // One seen briefly was read mid-slide or mid-fade; of the rest, glare through the panel can wash out the
      // white of the gun and skull, so the surest reading wins.
      const steady = members.filter((entry) => entry.seen >= STEADY);
      const sureness = (entry: Sighting) => entry.kill.scores.victim + entry.kill.scores.weapon;
      const best = (steady.length ? steady : members).reduce((a, b) => (sureness(b) > sureness(a) || (sureness(b) === sureness(a) && b.seen > a.seen) ? b : a));
      const first = members[0]!;
      return {
        time: first.time,
        row: first.row,
        death: best.death,
        killer: best.death ? best.kill.killer : (me ?? best.kill.killer),
        victim: best.death ? (me ?? best.kill.victim) : best.kill.victim,
        weapon: best.kill.weapon,
        headshot: best.kill.headshot,
        streak: 0,
        picture: best.picture,
        names: best.kill.names,
      };
    })
    .sort((a, b) => a.time - b.time)
    .map((kill) => {
      streak = kill.death ? 0 : streak + 1;
      return { ...kill, streak: kill.death ? 0 : streak };
    });
}

/** What fills the slot an entry came into: nothing, the blank flash of colour an entry arrives as, or an entry's look. */
function slot(frame: Rgba, row: FeedRow): "empty" | "flash" | Float32Array {
  const tall = row.bottom - row.top;
  const y0 = Math.max(0, Math.round(row.top + 0.2 * tall));
  const y1 = Math.min(frame.height, Math.round(row.bottom - 0.2 * tall));
  const x0 = Math.max(0, Math.round(row.notch - 2 * tall));
  const x1 = Math.min(frame.width, Math.round(row.notch + tall));
  let filled = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const at = (y * frame.width + x) * 4;
      if (kind(frame.data[at]!, frame.data[at + 1]!, frame.data[at + 2]!)) filled++;
      count++;
    }
  }
  if (count === 0 || filled < count * 0.5) return "empty";
  const look = printOf(frame, row.notch, row.top, row.bottom);
  return Math.max(...look) < 0.2 ? "flash" : look;
}

/**
 * The frame `row` came in on. From the first frame at or after `seen` that shows it, back while each frame
 * before shows the same entry or its flash: the stack moving up can put another entry in the slot just before.
 */
export function arrival(frames: { time: number; frame: Rgba }[], row: FeedRow, seen: number): number | null {
  const looks = frames.map(({ frame }) => slot(frame, row));
  let at = frames.findIndex(({ time }, index) => time >= seen - 1e-6 && typeof looks[index] !== "string");
  if (at === -1) return null;
  const own = looks[at] as Float32Array;
  const same = (look: (typeof looks)[number]) => look === "flash" || (look instanceof Float32Array && correlation(look, own) >= 0.7);
  while (at > 0 && same(looks[at - 1]!)) at--;
  return frames[at]!.time;
}

/** Padding round a name, in its own pixels, so its letters don't touch the edge. */
const MARGIN = 6;
/** A wider gap than this between letters ends the name: a word space is far narrower. */
const NAME_GAP = 0.4 * ROW;

/** How much a pixel looks like a name's letter: bright in every channel. Compression tints white text towards the colour behind it, so not how white. */
function ink(picture: Rgba, at: number): number {
  return Math.max(0, Math.min(1, (Math.min(picture.data[at]!, picture.data[at + 1]!, picture.data[at + 2]!) - 130) / 80));
}

/**
 * A player's name off a cut-out entry, as text recognition reads best: black on white, a few times larger. `side`
 * says which end of `span` the name keeps to: the killer's runs up to the middle, the victim's starts from it, and
 * the pictures beside them can reach into the span.
 */
export function nameStrip(picture: RowPicture, span: [number, number], side: "killer" | "victim", scale = 4): Rgba {
  const from = Math.max(0, Math.floor(span[0]));
  const to = Math.min(picture.width, Math.ceil(span[1]));
  const inked: boolean[] = [];
  for (let x = from; x < to; x++) {
    let filled = false;
    for (let y = Math.round(0.25 * ROW); y < Math.round(0.75 * ROW) && !filled; y++) filled = ink(picture, (y * picture.width + x) * 4) > 0.5;
    inked.push(filled);
  }
  // Letters close together are one name; the run nearest the middle is the player's.
  const runs: [number, number][] = [];
  for (let x = 0; x < inked.length; x++) {
    if (!inked[x]) continue;
    const last = runs[runs.length - 1];
    if (last && x - last[1] <= NAME_GAP) last[1] = x;
    else runs.push([x, x]);
  }
  const run = (side === "killer" ? runs[runs.length - 1] : runs[0]) ?? [0, Math.max(0, inked.length - 1)];
  const left = from + Math.max(0, run[0] - 2);
  const width = Math.max(1, Math.min(to, from + run[1] + 3) - left);

  const out = { width: (width + 2 * MARGIN) * scale, height: (ROW + 2 * MARGIN) * scale };
  const data = new Uint8ClampedArray(out.width * out.height * 4).fill(255);
  for (let y = 0; y < out.height; y++) {
    const sy = y / scale - MARGIN;
    if (sy < 0 || sy > ROW - 1) continue;
    for (let x = 0; x < out.width; x++) {
      const sx = x / scale - MARGIN;
      if (sx < 0 || sx > width - 1) continue;
      // Bilinear, so the letters come out smooth rather than blocky.
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(width - 1, x0 + 1);
      const y1 = Math.min(ROW - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const at = (px: number, py: number) => ink(picture, (py * picture.width + left + px) * 4);
      const value = Math.round(255 * (1 - ((at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy)));
      const index = (y * out.width + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
    }
  }
  return { data, ...out };
}

/** Below this, text recognition is guessing. */
const READABLE = 60;

/**
 * The players' names as read off each entry. You are the same name in every one, so the reading the entries agree
 * on most surely names you in all of them, even where yours was misread; everyone else keeps a clear reading, or
 * none.
 */
export function pickNames(
  kills: { death: boolean }[],
  read: { killer: { text: string; confidence: number }; victim: { text: string; confidence: number } }[],
): { killer?: string; victim?: string }[] {
  const sure = new Map<string, number>();
  kills.forEach((kill, index) => {
    const mine = kill.death ? read[index]!.victim : read[index]!.killer;
    if (mine.text && mine.confidence >= READABLE) sure.set(mine.text, (sure.get(mine.text) ?? 0) + mine.confidence);
  });
  const me = [...sure].sort((a, b) => b[1] - a[1])[0]?.[0];
  const clear = (name: { text: string; confidence: number }) => (name.text && name.confidence >= READABLE ? name.text : undefined);
  return kills.map((kill, index) => ({
    killer: kill.death ? clear(read[index]!.killer) : me,
    victim: kill.death ? me : clear(read[index]!.victim),
  }));
}

/** A video's frames as the feed's corner, read at `unit` (its height over 1080). */
export type FrameSource = {
  unit: number;
  frameRate: number;
  /** In seconds. */
  duration: number;
  /** In seconds, oldest first; null where the file has none. */
  frames: (times: number[]) => AsyncIterable<{ time: number; frame: Rgba } | null>;
};

/** Often enough to catch every entry, which stays up for seconds. */
const STEP = 0.1;
/** How far before an entry was first caught to look for the frame it came in on. */
const LOOKBACK = 1;
/** And after: it was caught mid-arrival, and is followed back from where it looks settled. */
const SETTLE = 0.3;
/** Read before a clip starts, to tell an entry that came in on its first frame from one still up from before it. */
const LEAD = 1;
/** And after it ends, so an entry that comes in on its last frames is still seen settled. */
const TAIL = 1.5;

/** The part of the video read for a clip that shows `start` to `end` of it, on a grid that lands on `start`. */
function scanWindow(source: FrameSource, start: number, end: number): { from: number; to: number } {
  return { from: start - Math.floor(Math.min(LEAD, start) / STEP + 1e-6) * STEP, to: Math.min(source.duration, end + TAIL) };
}

function sampleTimes(from: number, to: number, step: number): number[] {
  const times: number[] = [];
  for (let index = 0; from + index * step <= to + 1e-6; index++) times.push(from + index * step);
  return times;
}

/** How many frames `watchFeed` reads, for progress. */
export function scanLength(source: FrameSource, start: number, end: number): number {
  const { from, to } = scanWindow(source, start, end);
  return sampleTimes(from, to, STEP).length;
}

export type Watched = { start: number; end: number; from: number; to: number; sightings: Sighting[] };

/** Every entry the clip showing `start` to `end` of the video could have, read once each. */
export async function watchFeed(source: FrameSource, start: number, end: number, prepared: PreparedArt, onFrame?: () => void): Promise<Watched> {
  const { from, to } = scanWindow(source, start, end);
  const tracker = createTracker();
  const seen: FeedRow[] = [];
  for await (const read of source.frames(sampleTimes(from, to, STEP))) {
    onFrame?.();
    if (!read) continue;
    const rows = readRows(read.frame, source.unit);
    seen.push(...rows);
    const column = measureColumn(seen);
    if (column) tracker.see(read.time, read.frame, rows, column, source.unit);
  }
  const sightings = tracker.kills().flatMap((track) => {
    const kill = track.picture && readKill(track.picture, prepared);
    return kill ? [{ time: track.first, death: track.mine === "victim", seen: track.seen, row: track.arrived, picture: track.picture!, kill }] : [];
  });
  return { start, end, from, to, sightings };
}

/**
 * The kills and deaths that come in while the clip shows: one up before it started belongs to what came before,
 * and is read either side of the start so a flash hiding it for a moment doesn't make it look new. `me` can come
 * from more of the video than this clip, which may show too few entries to tell you apart.
 */
export async function placeKills(source: FrameSource, watched: Watched, me?: string): Promise<FoundKill[]> {
  const { start, end, from, to } = watched;
  // A frame is timed when it starts showing, and is the clip's if it shows at its start; one showing at its
  // end is the next clip's start. So two clips cut from one video share none.
  const step = 1 / source.frameRate;
  const shows = (time: number) => time >= start - step + 1e-6 && time < end - step + 1e-6;
  const kills: FoundKill[] = [];
  for (const kill of gatherKills(watched.sightings, me ?? whoAmI(watched.sightings))) {
    // Caught a tenth of a second apart, and yours can be told only once its yellow draws in; the entry came in
    // before that, on one frame, flashing its colour first.
    if (kill.time < start - step || kill.time > end + LOOKBACK) continue;
    const frames: { time: number; frame: Rgba }[] = [];
    for await (const read of source.frames(sampleTimes(Math.max(from, kill.time - LOOKBACK), Math.min(to, kill.time + SETTLE), step))) {
      if (read) frames.push(read);
    }
    const time = arrival(frames, kill.row, kill.time) ?? kill.time;
    if (shows(time)) kills.push({ ...kill, time: Math.max(start, time) });
  }
  return kills;
}
