/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Draws a clip as its post will look, from the small preview copy: the same layout maths as the
// project, the captions' look and the hook. The project itself renders the final video.

import { WebFonts, getTextLook, type TextLook } from "@plan.video/runtime";

import { captionStyle, clipWords, type ClipEdit } from "@/lib/clip-studio";
import { captionsPlace, postLayout } from "@/lib/post-builder";
import { LAYOUT_HEIGHT, LAYOUT_WIDTH, coverRect } from "@/lib/stream-layouts";

import type { TranscriptWord } from "@plan.video/assets";

const LINGER = 0.3;
const POP_SECONDS = 0.16;
const HOOK_FADE = 0.3;

const HOOK_LOOK: TextLook = {
  font: "Luckiest Guy",
  weight: 400,
  size: 1,
  textCase: "upper",
  fill: "#FFFFFF",
  strokes: [{ color: "#000000", width: 0.18 }],
  shadows: [{ color: "#000000", blur: 0.3, opacity: 0.8 }],
};

/** What a caption style draws in, where it has no look of its own. */
const PLAIN: TextLook = { font: "Montserrat", weight: 500, size: 1, fill: "#FFFFFF", shadows: [{ color: "#000000", blur: 0.3, opacity: 0.7 }] };

const loading = new Map<string, Promise<void>>();

/** Loads a look's face once; `onReady` redraws when it arrives. */
export function useFont(look: TextLook, onReady: () => void): void {
  const key = `${look.font} ${look.weight}`;
  if (typeof FontFace === "undefined") return;
  let pending = loading.get(key);
  if (!pending) {
    const source = WebFonts[look.font];
    if (!source) return;
    const face = new FontFace(look.font, `url(${source.url})`, { weight: String(look.weight), style: look.italic ? "italic" : "normal" });
    pending = face.load().then((loaded) => void document.fonts.add(loaded)).catch(() => {});
    loading.set(key, pending);
  }
  void pending.then(onReady);
}

export const captionLook = (clip: ClipEdit): TextLook => {
  const style = captionStyle(clip.captions.style);
  return (style.look && getTextLook(style.look)) || PLAIN;
};

export const hookLook = (): TextLook => HOOK_LOOK;

type Words = { words: TranscriptWord[]; start: number; end: number };

/** Groups of up to `most` words, a new one at each sentence mark and pause, as the captions read them. */
export function captionGroups(words: TranscriptWord[], most: number): Words[] {
  const groups: Words[] = [];
  let current: TranscriptWord[] = [];
  const flush = () => {
    if (current.length) groups.push({ words: current, start: current[0]!.start, end: current[current.length - 1]!.end });
    current = [];
  };
  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous && (word.start - previous.end > 0.45 || current.length >= most)) flush();
    current.push(word);
    if (/[.!?,;]$/.test(word.text)) flush();
  }
  flush();
  return groups;
}

function groupAt(groups: Words[], time: number): Words | null {
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    const next = groups[i + 1];
    const until = Math.min(group.end + LINGER, next ? next.start : Infinity);
    if (time >= group.start && time < until) return group;
  }
  return null;
}

const cased = (text: string, look: TextLook) => (look.textCase === "upper" ? text.toUpperCase() : look.textCase === "lower" ? text.toLowerCase() : text);

function setFont(ctx: CanvasRenderingContext2D, look: TextLook, size: number) {
  ctx.font = `${look.italic ? "italic " : ""}${look.weight} ${size}px "${look.font}"`;
  ctx.letterSpacing = look.letterSpacing ? `${look.letterSpacing * size}px` : "0px";
}

/** Lines of words that fit `width`, at the font already set. */
function wrap(ctx: CanvasRenderingContext2D, words: string[], width: number): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  for (const word of words) {
    const tried = [...line, word].join(" ");
    if (line.length && ctx.measureText(tried).width > width) {
      lines.push(line);
      line = [word];
    } else line.push(word);
  }
  if (line.length) lines.push(line);
  return lines;
}

/** A run of text in a look: shadows, then the widest outline first, then the fill. */
function paintText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, look: TextLook, size: number, fill: string | null) {
  ctx.lineJoin = "round";
  const colour = fill ?? (typeof look.fill === "string" ? look.fill : look.fill.from);
  for (const shadow of look.shadows ?? []) {
    ctx.save();
    ctx.shadowColor = withOpacity(shadow.color, shadow.opacity ?? 1);
    ctx.shadowBlur = shadow.blur * size;
    ctx.shadowOffsetX = (shadow.x ?? 0) * size;
    ctx.shadowOffsetY = (shadow.y ?? 0) * size;
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  for (const stroke of look.strokes ?? []) {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * size;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

function withOpacity(color: string, opacity: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const n = Number.parseInt(hex, 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${opacity})`;
}

/** The pop the captions and hook come in with: up past full size, then settling. */
function popScale(age: number): number {
  if (age >= POP_SECONDS * 2) return 1;
  if (age < POP_SECONDS) return 0.6 + (age / POP_SECONDS) * 0.5;
  return 1.1 - ((age - POP_SECONDS) / POP_SECONDS) * 0.1;
}

function drawCaptions(ctx: CanvasRenderingContext2D, clip: ClipEdit, time: number, scale: number, middle: number) {
  const style = captionStyle(clip.captions.style);
  const look = captionLook(clip);
  const groups = captionGroups(clipWords(clip), Math.max(1, clip.captions.words));
  const group = groupAt(groups, time);
  if (!group) return;
  const size = clip.captions.size * scale;
  setFont(ctx, look, size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const texts = group.words.map((word) => cased(word.text, look));
  const lines = wrap(ctx, texts, (LAYOUT_WIDTH - 160) * scale);
  const leading = size * 1.15;
  const cx = (LAYOUT_WIDTH / 2) * scale;
  const pop = style.preset === "pop" || style.preset === "classic" ? popScale(time - group.start) : 1;
  const accent = style.colors?.[0] ?? "#FFE14D";

  ctx.save();
  ctx.translate(cx, middle);
  ctx.scale(pop, pop);
  let index = 0;
  lines.forEach((line, row) => {
    const y = (row - (lines.length - 1) / 2) * leading;
    const full = line.join(" ");
    const lineWidth = ctx.measureText(full).width;
    let x = -lineWidth / 2;
    for (const word of line) {
      const spoken = group.words[index]!;
      const width = ctx.measureText(word).width;
      const now = time >= spoken.start && time < spoken.end + 0.05;
      const said = time >= spoken.start;
      let fill = clip.captions.color;
      if (style.preset === "box" && now) {
        const pad = size * 0.12;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.roundRect(x - pad, y - size * 0.62, width + pad * 2, size * 1.2, size * 0.16);
        ctx.fill();
      }
      if (style.preset === "spotlight" && now) fill = accent;
      ctx.save();
      if (style.preset === "rise") {
        const age = time - spoken.start;
        ctx.globalAlpha = said ? Math.min(1, age / 0.15) : 0;
        ctx.translate(0, said ? Math.max(0, 1 - age / 0.15) * size * 0.3 : 0);
      }
      ctx.textAlign = "left";
      paintText(ctx, word, x, y, look, size, fill);
      ctx.restore();
      x += width + ctx.measureText(" ").width;
      index += 1;
    }
  });
  ctx.restore();
}

function drawHook(ctx: CanvasRenderingContext2D, clip: ClipEdit, time: number, scale: number) {
  const { hook } = clip;
  if (!hook.on || !hook.text.trim() || time >= hook.seconds) return;
  const size = hook.size * scale;
  const look = HOOK_LOOK;
  setFont(ctx, look, size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, cased(hook.text.trim(), look).split(/\s+/), (LAYOUT_WIDTH - 140) * scale);
  const leading = size * 1.05;
  const middle = hook.y * LAYOUT_HEIGHT * scale;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, (hook.seconds - time) / HOOK_FADE));
  ctx.translate((LAYOUT_WIDTH / 2) * scale, middle);
  const pop = popScale(time);
  ctx.scale(pop, pop);
  lines.forEach((line, row) => paintText(ctx, line.join(" "), 0, (row - (lines.length - 1) / 2) * leading, look, size, null));
  ctx.restore();
}

/**
 * Draws `clip` at `time` seconds into it onto `ctx`, sized `width` across (9:16). `source` is the
 * picture at that moment; null draws only the words over black.
 */
export function drawClip(ctx: CanvasRenderingContext2D, clip: ClipEdit, time: number, width: number, source: HTMLVideoElement | null) {
  const scale = width / LAYOUT_WIDTH;
  const height = LAYOUT_HEIGHT * scale;
  ctx.save();
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  const sourceWidth = source?.videoWidth ?? 0;
  const sourceHeight = source?.videoHeight ?? 0;
  let middle = (clip.captions.y ?? 0.72) * LAYOUT_HEIGHT * scale;
  if (source && sourceWidth && sourceHeight) {
    const { slots, crops } = postLayout(clip.layout, { width: sourceWidth, height: sourceHeight }, clip.crops);
    if (clip.captions.y === null) middle = captionsPlace(slots) * LAYOUT_HEIGHT * scale;
    for (const slot of slots) {
      const crop = crops[slot.crop];
      if (!crop) continue;
      const shown = coverRect(crop, slot.box.width / slot.box.height);
      const box = { x: slot.box.x * scale, y: slot.box.y * scale, width: slot.box.width * scale, height: slot.box.height * scale };
      ctx.save();
      ctx.beginPath();
      if (slot.radius) ctx.roundRect(box.x, box.y, box.width, box.height, slot.radius * scale);
      else ctx.rect(box.x, box.y, box.width, box.height);
      ctx.clip();
      if (slot.blur) ctx.filter = `blur(${Math.max(1, slot.blur * scale)}px)`;
      ctx.drawImage(source, shown.x, shown.y, shown.width, shown.height, box.x, box.y, box.width, box.height);
      ctx.restore();
    }
  }
  if (clip.captions.on && clip.heard) drawCaptions(ctx, clip, time, scale, middle);
  drawHook(ctx, clip, time, scale);
  ctx.restore();
}
