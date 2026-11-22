/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { getTextLook, loadWebFont, SUBTLE_STYLES, type SubtleStyleName, type TextLook } from "@plan.video/runtime";
import { useWorld } from "@plan.video/koota-solid";

import { SubtleTemplateLook } from "./subtle-template-look";

import type { CaptionPreset } from "@plan.video/jsx";
import type { CaptionTemplate } from "@/lib/caption-templates";

export const CAPTION_WORD_SECONDS = 0.42;
const HOLD_SECONDS = 1.1;
const ACROSS = 0.74;
const DOWN = 0.3;

export const captionLoopSeconds = (words: number) => words * CAPTION_WORD_SECONDS + HOLD_SECONDS;
/** Every word up and the last one spoken: the frame shown when motion is reduced. */
export const captionStillSeconds = (words: number) => words * CAPTION_WORD_SECONDS + 0.3;

// The runtime decoders' slot colours (media/caption/*.ts), for a template that doesn't give one.
const DEFAULT_SLOT: Partial<Record<CaptionPreset, string>> = {
  spotlight: "#24D5FF",
  box: "#FFD60A",
  deep: "#FFFFFF",
  marker: "#4ADE80",
};
const ONE_WORD = new Set<CaptionPreset>(["classic", "pop"]);
const STILL = new Set<CaptionPreset>(["classic", "spotlight"]);
const SETTLE_SECONDS = 0.25;

type WordPose = { shown: boolean; alpha: number; scale: number; lift: number; blur: number; fill: string | null };
type Frame = { poses: WordPose[]; spoken: number; age: number; settled: boolean };

const easeOut = (seconds: number, length: number) => {
  const t = Math.min(1, Math.max(0, seconds / length));
  return 1 - (1 - t) ** 3;
};

// The runtime's POP animation (systems/motion.ts popScale, overshoot 1.2) over its 0.22 s.
function popScale(seconds: number): number {
  const t = Math.min(1, Math.max(0, seconds / 0.22));
  if (t < 0.55) return (1 - (1 - t / 0.55) ** 3) * 1.2;
  if (t < 0.82) return 1.2 - ((t - 0.55) / 0.27) * 0.28;
  return 0.92 + ((t - 0.82) / 0.18) * 0.08;
}

/** Each motion as its decoder poses it, with the words said one after another. */
function frameAt(preset: CaptionPreset, slot: string, count: number, time: number): Frame {
  const spoken = Math.min(count - 1, Math.floor(time / CAPTION_WORD_SECONDS));
  const age = time - spoken * CAPTION_WORD_SECONDS;
  const poses: WordPose[] = [];

  for (let i = 0; i < count; i++) {
    const own = time - i * CAPTION_WORD_SECONDS;
    const pose: WordPose = { shown: true, alpha: 1, scale: 1, lift: 0, blur: 0, fill: null };
    if (ONE_WORD.has(preset)) {
      pose.shown = i === spoken;
      if (preset === "pop") pose.scale = popScale(age);
    } else if (preset === "spotlight") {
      if (i === spoken) pose.fill = slot;
    } else if (preset === "deep") {
      pose.alpha = i === spoken ? 1 : 0.4;
      if (i === spoken) {
        pose.fill = slot;
        pose.scale = 1 + 0.04 * easeOut(age, 0.12);
      }
    } else if (preset === "rise") {
      const eased = own >= 0 ? easeOut(own, 0.24) : 0;
      pose.alpha = eased;
      pose.lift = 0.34 * (1 - eased);
    } else if (preset === "focus") {
      const sharp = own >= 0 ? easeOut(own, 0.18) : 0;
      pose.blur = 0.12 * (1 - sharp);
      pose.alpha = 0.35 + 0.65 * sharp;
    }
    poses.push(pose);
  }

  return { poses, spoken, age, settled: STILL.has(preset) || age >= SETTLE_SECONDS };
}

function fontOf(look: TextLook, size: number): string {
  return `${look.italic ? "italic " : ""}${look.weight} ${size}px "${look.font}"`;
}

function cased(look: TextLook, word: string): string {
  if (look.textCase === "upper") return word.toLocaleUpperCase();
  if (look.textCase === "lower") return word.toLocaleLowerCase();
  return word;
}

// The renderer's order (runtime utils/text.ts): what sits under the words, then shadows, outlines widest first, fill.
function draw(
  ctx: CanvasRenderingContext2D,
  look: TextLook,
  template: CaptionTemplate,
  slot: string,
  sample: string[],
  frame: Frame,
  width: number,
  height: number,
) {
  const words = sample.map((word) => cased(look, word));
  const line = words.join(" ");
  const strokes = look.strokes ?? [];
  const widest = strokes.reduce((most, stroke) => Math.max(most, stroke.width), 0);

  ctx.font = fontOf(look, 100);
  ctx.letterSpacing = `${(look.letterSpacing ?? 0) * 100}px`;
  ctx.textBaseline = "alphabetic";
  const probe = ctx.measureText(line);
  const across = (probe.actualBoundingBoxLeft + probe.actualBoundingBoxRight) / 100 + widest;
  const down = (probe.actualBoundingBoxAscent + probe.actualBoundingBoxDescent) / 100 + widest;
  const size = Math.min((width * ACROSS) / across, (height * DOWN) / down);
  const em = (value: number) => value * size;

  ctx.font = fontOf(look, size);
  ctx.letterSpacing = `${em(look.letterSpacing ?? 0)}px`;
  ctx.lineJoin = "round";
  const metrics = ctx.measureText(line);
  const y = (height - metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2 + metrics.actualBoundingBoxAscent;
  const top = y - metrics.fontBoundingBoxAscent;
  const boxHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
  const middle = top + boxHeight / 2;

  const advances = words.map((word) => ctx.measureText(word).width);
  const space = ctx.measureText(" ").width;
  const xs: number[] = [];
  if (ONE_WORD.has(template.preset)) {
    for (const advance of advances) xs.push((width - advance) / 2);
  } else {
    let x = (width - advances.reduce((sum, advance) => sum + advance, 0) - space * (words.length - 1)) / 2;
    for (const advance of advances) {
      xs.push(x);
      x += advance + space;
    }
  }

  const spokenX = xs[frame.spoken]!;
  const spokenWidth = advances[frame.spoken]!;
  if (template.preset === "box") {
    const padX = boxHeight * 0.12;
    const padY = boxHeight * 0.04;
    const w = spokenWidth + padX * 2;
    const h = boxHeight - padY * 2;
    const scale = 0.9 + 0.1 * easeOut(frame.age, 0.12);
    ctx.save();
    ctx.translate(spokenX + spokenWidth / 2, middle);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h * 0.16);
    ctx.fillStyle = slot;
    ctx.fill();
    ctx.restore();
  } else if (template.preset === "marker") {
    const pad = boxHeight * 0.1;
    const w = (spokenWidth + pad * 2) * easeOut(frame.age, 0.2);
    const h = boxHeight * 0.62;
    if (w > 0) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.roundRect(spokenX - pad, top + boxHeight * 0.26, w, h, h * 0.18);
      ctx.fillStyle = slot;
      ctx.fill();
      ctx.restore();
    }
  }

  const each = (paint: (word: string, x: number, pose: WordPose) => void) => {
    words.forEach((word, i) => {
      const pose = frame.poses[i]!;
      if (!pose.shown || pose.alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha *= pose.alpha;
      if (pose.blur > 0) ctx.filter = `blur(${em(pose.blur)}px)`;
      const centre = xs[i]! + advances[i]! / 2;
      ctx.translate(centre, middle - em(pose.lift));
      ctx.scale(pose.scale, pose.scale);
      ctx.translate(-centre, -middle);
      paint(word, xs[i]!, pose);
      ctx.restore();
    });
  };

  for (const shadow of look.shadows ?? []) {
    each((word, x) => {
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = em(shadow.blur);
      ctx.shadowOffsetX = em(shadow.x ?? 0);
      ctx.shadowOffsetY = em(shadow.y ?? 0);
      ctx.globalAlpha *= shadow.opacity ?? 1;
      ctx.fillStyle = shadow.color;
      ctx.strokeStyle = shadow.color;
      if (widest > 0) {
        ctx.lineWidth = em(widest);
        ctx.strokeText(word, x, y);
      } else {
        ctx.fillText(word, x, y);
      }
    });
  }

  for (const stroke of strokes) {
    each((word, x) => {
      ctx.lineWidth = em(stroke.width);
      ctx.strokeStyle = stroke.color;
      ctx.strokeText(word, x, y);
    });
  }

  each((word, x, pose) => {
    const fill = pose.fill ?? look.fill;
    if (typeof fill === "string") {
      ctx.fillStyle = fill;
    } else {
      const gradient = ctx.createLinearGradient(0, top, 0, top + boxHeight);
      gradient.addColorStop(0, fill.from);
      gradient.addColorStop(1, fill.to);
      ctx.fillStyle = gradient;
    }
    ctx.fillText(word, x, y);
  });
}

const subtleName = (template: CaptionTemplate): SubtleStyleName | null =>
  template.preset in SUBTLE_STYLES ? (template.preset as SubtleStyleName) : null;

/** Plays `template` on `words` at `time()`; draws only when the pose changes and while on screen. */
export function CaptionTemplateLook(props: { template: CaptionTemplate; words: string[]; time: () => number }) {
  return (
    <Show when={subtleName(props.template)} fallback={<LookMotionLook {...props} />}>
      {(name) => <SubtleTemplateLook name={name()} words={props.words} wordSeconds={CAPTION_WORD_SECONDS} time={props.time} />}
    </Show>
  );
}

function LookMotionLook(props: { template: CaptionTemplate; words: string[]; time: () => number }) {
  const world = useWorld();
  let canvas!: HTMLCanvasElement;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [loaded, setLoaded] = createSignal(false);
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    const resize = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    const seen = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));
    resize.observe(canvas);
    seen.observe(canvas);
    onCleanup(() => {
      resize.disconnect();
      seen.disconnect();
    });
  });

  createEffect(() => {
    const look = getTextLook(props.template.look);
    setLoaded(false);
    if (!look) return;
    void loadWebFont(world, look.font)
      .catch(() => {})
      .then(() => document.fonts.load(fontOf(look, 100)))
      .catch(() => {})
      .then(() => setLoaded(true));
  });

  createEffect(() => {
    const { width, height } = size();
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  });

  let drawn = "";
  createEffect(() => {
    const { width, height } = size();
    const look = getTextLook(props.template.look);
    const words = props.words;
    if (!loaded() || !visible() || !width || !height || !look || words.length === 0) {
      drawn = "";
      return;
    }
    const template = props.template;
    const slot = template.colors?.[0] ?? DEFAULT_SLOT[template.preset] ?? "#FFFFFF";
    const frame = frameAt(template.preset, slot, words.length, props.time());
    const key = `${canvas.width}:${frame.spoken}${frame.settled ? "" : `:${frame.age.toFixed(3)}`}`;
    if (key === drawn) return;
    drawn = key;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    draw(ctx, look, template, slot, words, frame, canvas.width, canvas.height);
  });

  return <canvas ref={canvas} aria-hidden="true" class="absolute inset-0 size-full" />;
}
