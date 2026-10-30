/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { JSX as SolidJSX } from "solid-js";
import type { Entity } from "koota";
import type { AssetRef } from "./generate";

/** Seconds (number), frames at 30 fps ("30f"), or a "MM:SS" / "HH:MM:SS" clock string. Values may be negative. */
export type Time = number | `${number}f` | `${string}:${string}`;

export type Fit = "cover" | "contain" | "fill";

export type StrokeJoin = "miter" | "round" | "bevel";

export type StrokeCap = "butt" | "round" | "square";

/**
 * How an element follows its scene's frame when it is resized: pinned to the near edge (default),
 * the far one, the middle, both edges ("stretch" resizes it) or the frame's proportions ("scale").
 */
export type HorizontalConstraint = "left" | "right" | "center" | "stretch" | "scale";

export type VerticalConstraint = "top" | "bottom" | "center" | "stretch" | "scale";

/** The canvas `globalCompositeOperation` modes, camelCase. Default "sourceOver". */
export type BlendMode =
  | "sourceOver"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "colorDodge"
  | "colorBurn"
  | "hardLight"
  | "softLight"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

/** CSS filter functions over the parent's rendered pixels: `blur` takes a radius in px, `hueRotate` degrees, the rest 0–1. */
export type EffectType =
  | "blur"
  | "brightness"
  | "contrast"
  | "grayscale"
  | "hueRotate"
  | "invert"
  | "saturate"
  | "sepia";

/**
 * `cubicBezier(x1,y1,x2,y2)` takes CSS-style control points, `spring(bounce,duration)` a 0–1 bounce
 * and a duration in ms, `steps(n)` holds n discrete values.
 */
export type Easing =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "gentle"
  | "snappy"
  | "bouncy"
  | "strong"
  | `cubicBezier(${string})`
  | `spring(${string})`
  | `steps(${string})`;

/** The prop is the track holder's: `width` under a `<stroke>` is the line width, `value` under an `<effect>` its amount. */
export type AnimatableProperty =
  | "x"
  | "y"
  | "offsetX"
  | "offsetY"
  | "width"
  | "height"
  | "rotation"
  | "scale"
  | "scaleX"
  | "scaleY"
  | "opacity"
  | "cornerRadius"
  | "cornerRadiusTopLeft"
  | "cornerRadiusTopRight"
  | "cornerRadiusBottomRight"
  | "cornerRadiusBottomLeft"
  | "volume"
  | "playbackRate"
  | "color"
  | "offset"
  | "blur"
  | "value";

export type TransitionType =
  | "dissolve"
  | "slideFromRight"
  | "slideFromLeft"
  | "fadeToBlack"
  | "fadeToWhite"
  | "pushLeft"
  | "pushUp"
  | "zoomIn"
  | "zoomOut"
  | "crossZoom"
  | "spin"
  | "whip"
  | "flash"
  | "blur"
  | "wipe"
  | "iris";

export type TransitionSpec = {
  /** Transition style. Default "dissolve". */
  type?: TransitionType;
  /**
   * Length of the transition: centered on the cut between two clips, or inside
   * the clip at the end it plays on. Any `Time` format. Default 1 second.
   */
  duration?: Time;
  /**
   * Which way a transition that moves goes: slides, pushes, the whip and the
   * wipe. Default: the style's own (a push goes left, pushUp up).
   */
  direction?: "left" | "right" | "up" | "down";
  /** The curve it plays along. Default: the style's own. */
  easing?: "linear" | "easeIn" | "easeOut" | "easeInOut";
  /** The colour a fade or flash goes through. Default: the style's own (black, or white). */
  color?: string;
};

/** "appearWord" / "appearChar" / "scramble" apply only to text; "gain" ramps audio and has no visual effect. */
export type AnimationType =
  | "fade"
  | "gain"
  | "grow"
  | "shrink"
  | "blur"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "spin"
  | "twist"
  | "appearWord"
  | "appearChar"
  | "scramble"
  | "pop"
  | "bounce";

/** How glyphs are cased when drawn, whatever the text says. Default "original". */
export type TextCase = "original" | "upper" | "lower";

export type TextLookName =
  | "commentary" | "hook" | "punch" | "yellow" | "glow" | "neon"
  | "cinema" | "teal" | "fire" | "alert" | "sticker" | "slime"
  | "bubblegum" | "magenta" | "lime" | "chrome" | "gold" | "retro"
  | "comic" | "cute" | "plain" | "soft" | "handwritten" | "ink";

export type CaptionPreset =
  | "classic"
  | "cascade"
  | "spotlight"
  | "whisper"
  | "paper"
  | "guinea"
  | "stark"
  | "pop"
  | "box"
  | "marker"
  | "deep"
  | "rise"
  | "focus";

// Any prop can be animated by a `<keyframeTrack>` child naming it (see `AnimatableProperty`); none
// takes keyframes inline.

type IdentityProps = {
  name?: string;
  /**
   * Editor state, kept in the source so a canvas click has somewhere to be written and the selection
   * survives a recompile; nothing rendered depends on it. The editor writes the bare attribute.
   */
  selected?: boolean;
  /** Timeline row height, px. Editor state, like `selected`; absent means the common row height. */
  clipHeight?: number;
  /** Whether the timeline shows this element's keyframe rows. Editor state, like `selected`; absent means collapsed. */
  expanded?: boolean;
};

type PositionProps = {
  /** Position relative to the parent, px. Defaults to 0. */
  x?: number;
  y?: number;
};

type OffsetProps = {
  /** Render-time translation on top of `x`/`y`, px: moves the drawn content without changing the layout box. Defaults to 0. */
  offsetX?: number;
  offsetY?: number;
};

type SizeProps = {
  /** Box size, px. Defaults to the parent's size. */
  width?: number;
  height?: number;
  /** A resize of one bound drives the other, keeping `width`:`height` (or, with neither authored, the box's current ratio). */
  keepAspectRatio?: boolean;
};

type TransformProps = PositionProps & OffsetProps & SizeProps & {
  /**
   * Only read against a frame that changes size, so a constraint moves nothing until the scene is
   * resized; a `<sequence>`'s children follow the frame the sequence sits in. Default "left"/"top".
   */
  constrainX?: HorizontalConstraint;
  constrainY?: VerticalConstraint;
  /** Rotation in degrees. */
  rotation?: number;
  /** Skew in degrees along each axis. Default 0. */
  skewX?: number;
  skewY?: number;
  /** Mirrors the element across its vertical (`flipX`) or horizontal (`flipY`) axis. */
  flipX?: boolean;
  flipY?: boolean;
  /** The point it rotates, scales and skews about, 0–1 across the box. Default 0.5, the centre. */
  anchorX?: number;
  anchorY?: number;
  /** Uniform scale about the box origin, 1 = natural size. Overrides `scaleX`/`scaleY` while set. */
  scale?: number;
  /** Per-axis scale, 1 = natural size. */
  scaleX?: number;
  scaleY?: number;
  /** Opacity, 0–1 (out-of-range values clamp, like CSS). */
  opacity?: number;
  /** Uniform corner radius, px. */
  cornerRadius?: number;
  /**
   * Per-corner radius, px. A corner without one takes `cornerRadius`, so
   * `cornerRadius={20} cornerRadiusTopLeft={0}` rounds three corners.
   */
  cornerRadiusTopLeft?: number;
  cornerRadiusTopRight?: number;
  cornerRadiusBottomRight?: number;
  cornerRadiusBottomLeft?: number;
};

type CompositeProps = {
  /** Blend mode over what is below. Default "sourceOver". */
  blendMode?: BlendMode;
  /** Excludes the element from rendering (and its audio from the mix) while it keeps its timeline place and children. */
  hidden?: boolean;
};

type TimingProps = {
  /** Parent-timeline time at which the node begins. Default 0. */
  start?: Time;
  /** Parent-timeline time at which the node ends. Alternative to `sourceOut`. */
  end?: Time;
  /** Source in point: where playback begins within the source, trimming the head. Default 0. */
  sourceIn?: Time;
  /** Source out point: where playback ends within the source. Defaults to the natural end. Alternative to `end`. */
  sourceOut?: Time;
  /** Speed multiplier for local time: at 2, twice the source plays in the same stretch of timeline. Default 1. */
  playbackRate?: number;
};

type SequenceItemProps = {
  /**
   * How the clip goes out: in a `<Sequence>` it blends into the next clip, centred on the cut; elsewhere
   * it plays out over what is under it. A partial value merges into the existing transition, `null` removes it.
   */
  transition?: TransitionSpec | null;
  /** How the clip comes in, from its start; gives way to a `transition` the previous clip in a `<Sequence>` plays into it. */
  transitionIn?: TransitionSpec | null;
};

type FillProps = {
  /** Any CSS color, the node's intrinsic solid fill (drawn beneath any paint children); alpha is ignored — use `opacity`. */
  fill?: string;
};

type MediaProps = {
  /**
   * Path, URL, asset id, or a `generate.*` / `transform.*` declaration. A directory of numbered frames
   * (`shot_001.png`, ...) plays as footage (see `frameRate`). On `<Captions>`, a .srt, .vtt or transcript
   * .json is mounted instead of transcribing the scene; `generate.*` is not accepted there.
   */
  src: string | AssetRef;
};

type FitProps = {
  /** How the source maps into the box. Default "cover" on `<Video>`, "contain" on `<Image>`. */
  objectFit?: Fit;
  /**
   * The part of the source drawn into the box, as fractions of the frame.
   * Set together they are a crop; absent, the whole frame is drawn.
   */
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
};

type FrameRateProps = {
  /**
   * Frames per second for a `src` naming a directory of numbered frames: 600 frames at 24 run 25 s.
   * Default 30. Ignored for encoded video and stills. Not `playbackRate`, and unrelated to the
   * composition's frame rate.
   */
  frameRate?: number;
};

type AudioTrackProps = {
  /** Decibels: 0 = unity gain, negative attenuates (-6 ≈ half as loud), -Infinity = silence. Use `muted` to silence. */
  volume?: number;
  /** Excludes the node's audio from the mix; independent of `volume`. */
  muted?: boolean;
  /** `id` of another element with audio; derives `start` by cross-correlating the two signals. Mutually exclusive with `start`. */
  syncTo?: string;
};

type OpacityProps = {
  /** Opacity, 0–1 (out-of-range values clamp, like CSS). */
  opacity?: number;
};

type ColorProps = {
  /** Any CSS color: the glyph color on `<Text>`, the paint color on paints, strokes, shadows and color stops. */
  color: string;
};

/** On a `<textRange>` an unset field inherits the text's, so a range says only what it changes. */
type FontProps = {
  /** A family available on the machine (`dapi fonts`). */
  fontFamily?: string;
  /** Font size, px. */
  fontSize?: number;
  /** CSS weights 100–900, or "normal" / "bold". */
  fontWeight?: number | "normal" | "bold";
  fontStyle?: "normal" | "italic" | "oblique";
  /** Extra space between glyphs, px (negative tightens). Default 0. */
  letterSpacing?: number;
  /** Casing applied when drawing; the text itself is left as written. Default "original". */
  textCase?: TextCase;
};

type CommonProps = IdentityProps & TransformProps & CompositeProps & TimingProps & SequenceItemProps;

type PaintProps = OpacityProps & CompositeProps;

type TrackChildren = {
  children?: SolidJSX.Element;
};

/** `id` is read by the compile step and never seen by a host. */
export type SourceProps = {
  id?: string;
  /** Callback or variable ref, SolidJS-style; receives the element's `SceneNode` when it is created. */
  ref?: SceneNode | ((node: SceneNode) => void);
};

/** `[a, b, c, d, e, f]` in CSS `matrix()` / canvas `setTransform` order: `a`/`d` scale, `b`/`c` skew, `e`/`f` translate. */
export type CameraMatrix = [a: number, b: number, c: number, d: number, e: number, f: number];

/**
 * A scene's timeline viewport: `zoom` in pixels per second of timeline, `x`
 * the horizontal scroll in seconds, `y` the vertical scroll in pixels. See
 * `SceneProps["timeline"]`.
 */
export type TimelineView = [zoom: number, x: number, y: number];

/**
 * The infinite canvas every project renders into; only allowed as the root
 * element, and holding `<scene>` children.
 */
export type StageProps = {
  /** Canvas color, any CSS color. */
  background?: string;
  /**
   * The editor's viewport on open; `[1, 0, 0, 1, 0, 0]` is the origin at 100%. Omitted, it opens on
   * `[0.3, 0, 0, 0.3, 85, 150]`, framing a 1920×1080 scene at the origin; for other sizes scale `s` to fit
   * roughly 580×330 screen px (`[0.25, 0, 0, 0.25, 235, 70]` for 1080×1920). The first pan overwrites it.
   */
  camera?: CameraMatrix;
  children?: SolidJSX.Element;
};

/**
 * The clipped, playable frame a composition is made in; the only element allowed under `<stage>`.
 * Takes no timing of its own. `x`/`y`, `selected` and `active` are editor state kept in the source
 * so a scene dragged or clicked on the canvas has somewhere to be written back to.
 */
export type SceneProps = IdentityProps & PositionProps & Required<Pick<SizeProps, "width" | "height">> & Pick<SizeProps, "keepAspectRatio"> & FillProps & {
  /** "visible" draws what reaches past the frame on the canvas too. Default "hidden": cut at the frame. */
  overflow?: "hidden" | "visible";
  /**
   * At most one root element is active (a nested `active` is dropped; the last rendered wins). Nothing
   * activates on its own: mark one scene of every authored project `active`, or it opens on an empty
   * timeline with no playhead and no scene to export.
   */
  active?: boolean;
  /** `[zoom px per second, x seconds in, y px down]` on open. Editor state; absent is the right opening for an authored project. */
  timeline?: TimelineView;
  /** Where the playhead stands on open, any time format. Editor state, written on scrub (not as playback moves); absent means the first frame. */
  playhead?: Time;
  /** Decibels on the scene's master bus: 0 = unity, -6 = half as loud, -Infinity = silence. Composes with each clip's `volume`. */
  volume?: number;
  /**
   * `[in, out]` of the scene that plays (looping) and exports; `null` for the whole scene. Editor state
   * carried by the source, but read wherever the file is: it trims what comes out of a render.
   */
  workarea?: [inPoint: Time, outPoint: Time] | null;
  children?: SolidJSX.Element;
};

export type GroupProps = CommonProps & FillProps & {
  /** Element children, plus `<Effect>` (filtering the group as a whole), `<Animation>` and `<KeyframeTrack>` children. */
  children?: SolidJSX.Element;
};

/**
 * Draws nothing; while its clip lasts, its transform composes onto the sibling directly beneath it
 * (in a `<sequence>`, onto what sits below the sequence). `width`/`height` are only the pivot box:
 * default 1920x1080, so set them to the scene's size for other frames.
 */
export type AdjustmentLayerProps =
  & IdentityProps
  & Omit<TransformProps, "opacity" | "cornerRadius" | "cornerRadiusTopLeft" | "cornerRadiusTopRight" | "cornerRadiusBottomRight" | "cornerRadiusBottomLeft">
  & Pick<CompositeProps, "hidden">
  & TimingProps
  & SequenceItemProps
  & {
    /** `<Animation>`/`<KeyframeTrack>` children animate the transform; `<Effect>` children filter the clip it acts on. Layers stack. */
    children?: SolidJSX.Element;
  };

export type RectProps = CommonProps & FillProps & {
  /**
   * Clips the parent to the rect's box instead of drawing; keeps its transform, `cornerRadius` and timing,
   * and several masks intersect. `fill`, `opacity`, `blendMode` and paints have no effect. Without
   * `width`/`height` a mask is 500×500, and without `end` it clips for the parent's whole window.
   */
  mask?: boolean;
  /**
   * Paint children (`<SolidPaint>`, `<LinearGradientPaint>`,
   * `<RadialGradientPaint>`), plus `<Stroke>`, `<Shadow>`, `<Effect>`,
   * `<Animation>` and `<KeyframeTrack>` children.
   */
  children?: SolidJSX.Element;
};

/** An outline of the parent's box (or glyphs): `color`/`opacity` are its paint. Several stack in document order, later on top. */
export type StrokeProps = ColorProps & PaintProps & TrackChildren & {
  /** Line width, px. Default 1. */
  width?: number;
  /** How the stroke turns corners. Default "miter". */
  join?: StrokeJoin;
  /** How the stroke ends open paths (text glyphs). Default "butt". */
  cap?: StrokeCap;
  /** Miter length limit, as a ratio of the width. Default 10. */
  miterLimit?: number;
};

/**
 * `<shadow>` — a drop shadow beneath the parent's box (or glyphs): a blurred,
 * offset copy of its silhouette in `color`. Several stack in document order.
 */
export type ShadowProps = ColorProps & OpacityProps & Pick<CompositeProps, "hidden"> & TrackChildren & {
  /** Blur radius, px. Default 0. */
  blur?: number;
  /** Where the shadow sits relative to the silhouette, px. Default 0. */
  offsetX?: number;
  offsetY?: number;
};

/**
 * `<effect>` — a filter over the parent's rendered pixels (its fills, strokes
 * and children together), a sub-entity like a paint. Several stack in
 * document order.
 */
export type EffectProps = Pick<CompositeProps, "hidden"> & TrackChildren & {
  type: EffectType;
  /** The amount: px for "blur", degrees for "hueRotate", 0–1 otherwise. */
  value: number;
};

/**
 * A look a `<grade>` can lay under its sliders. "mono" and "noir" take the
 * colour out.
 */
export type GradeLook =
  | "warm"
  | "cool"
  | "fresh"
  | "golden"
  | "tealOrange"
  | "vivid"
  | "film"
  | "faded"
  | "moody"
  | "mono"
  | "noir";

/**
 * Only the last grade under a node counts; a clip's own grade goes under its scene's. Sliders run
 * -100 to 100, default 0 (unchanged). Each wheel takes a hue in degrees, an amount (0–100) and a
 * level (-100 to 100).
 */
export type GradeProps = Pick<CompositeProps, "hidden"> & {
  look?: GradeLook;
  /** How much of the look, 0–100. Default 100. */
  lookAmount?: number;
  /** Two stops darker at -100, two brighter at 100. */
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  /** Cooler (blue) below 0, warmer (orange) above. */
  temperature?: number;
  /** Greener below 0, more magenta above. */
  tint?: number;
  /** -100 is black and white. */
  saturation?: number;
  /** The shadows wheel. */
  liftHue?: number;
  liftAmount?: number;
  liftLevel?: number;
  /** The midtones wheel. */
  gammaHue?: number;
  gammaAmount?: number;
  gammaLevel?: number;
  /** The highlights wheel. */
  gainHue?: number;
  gainAmount?: number;
  gainLevel?: number;
};

/** Played over the clip's head or tail. Several stack, later ones winning; a `<keyframeTrack>` on the same property overrides it while it has keyframes. */
export type AnimationProps = {
  type: AnimationType;
  /** "in" plays from the clip's head, "out" into its tail. Default "in". */
  phase?: "in" | "out";
  /** Length of the animation. Any `Time` format. Default 1 second. */
  duration?: Time;
  /**
   * Gap between the clip edge and the animation: after the head for "in",
   * before the tail for "out". Any `Time` format. Default 0.
   */
  delay?: Time;
};

/** One track per prop; the static value holds when it is empty, and outside the keyframed range the first/last keyframe holds. */
export type KeyframeTrackProps = {
  property: AnimatableProperty;
  /** `<Keyframe>` children, in any order; they sort by `time`. */
  children?: SolidJSX.Element;
};

export type KeyframeProps = {
  /** Source-local: a head-trimmed clip's first keyframe time is `sourceIn`, not 0, so keyframes stay pinned to content on trim. */
  time: Time;
  /** The value at `time`: a number, or any CSS color on a `color` track. */
  value: number | string;
  /** Shapes the segment to the next keyframe; ignored on the last. Default "linear". */
  easing?: Easing;
};

export type SolidPaintProps = ColorProps & PaintProps & TrackChildren;

export type GradientPaintProps = PaintProps & {
  /** Gradient rotation in degrees. Defaults to 0 (left to right). */
  rotation?: number;
  /** `<ColorStop>` children — the gradient's color stops. */
  children?: SolidJSX.Element;
};

export type ColorStopProps = ColorProps & OpacityProps & TrackChildren & {
  /** Position along the gradient, 0–1. */
  offset: number;
};

/** Fills a rect or text with media. The tag only says what the source is expected to be: a frames directory plays under either. */
export type MediaPaintProps = PaintProps & MediaProps & FitProps & FrameRateProps & TrackChildren;

export type VideoProps = CommonProps & MediaProps & FitProps & FrameRateProps & AudioTrackProps & {
  /** Paint children, stacked over the media paint created by `src`; `<Stroke>`, `<Shadow>`, `<Effect>`, `<Animation>` and `<KeyframeTrack>` children. */
    children?: SolidJSX.Element;
  };

export type ImageProps = CommonProps & MediaProps & FitProps & FrameRateProps & {
  /** Paint children, stacked over the media paint created by `src`; `<Stroke>`, `<Shadow>`, `<Effect>`, `<Animation>` and `<KeyframeTrack>` children. */
    children?: SolidJSX.Element;
  };

export type HtmlPaintProps = PaintProps & {
  /** Real DOM laid out at the parent's box size and drawn into it (html-in-canvas); signals in it update the drawing. */
  children?: SolidJSX.Element;
};

/** `<Html>` — a rectangle whose intrinsic paint draws the given DOM children. */
export type HtmlProps = CommonProps & Pick<HtmlPaintProps, "children">;

// HTMLCanvasElement without requiring the DOM lib (this package also
// type-checks in node contexts): the real type when present, a structural
// stub otherwise.
type HostCanvas = typeof globalThis extends { HTMLCanvasElement: new () => infer T } ? T
  : { width: number; height: number; getContext(contextId: string, options?: unknown): unknown };

/** `<ShaderPaint>` — transforms the media paint directly below it. Takes no children. */
export type ShaderPaintProps = PaintProps & {
  /**
   * Fragment-stage WGSL, applied to the video/image paint directly below it
   * in the paint stack, or run procedurally (over a transparent source) when
   * there is none. Entry point
   * `@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f`;
   * sample the media with `sampleSource(uv)`.
   */
  wgsl: string;
  /**
   * Values for the shader's `@group(1)` uniform declarations, matched by
   * name: numbers bind to `f32`, arrays of 2-4 to `vec2f`-`vec4f`, CSS
   * color strings to `vec3f`/`vec4f`.
   */
  uniforms?: Record<string, number | number[] | string>;
};

/**
 * What an element's `ref` receives; the document and renderer hold the same object, so `===` works.
 * Both ref forms work, as in SolidJS. `E` defaults to the backing canvas of a `<surface>`.
 */
export interface SceneNode<E = HostCanvas> {
  /** The Koota entity the element rendered into; `entity.get`/`set` reach the runtime traits. */
  readonly entity: Entity;
  readonly native: boolean;
  tag: string;
  props: Record<string, unknown>;
  parent: SceneNode<E> | null;
  children: SceneNode<E>[];
  /**
   * A `<surface>`'s backing canvas: draw with any context (2d, webgl, webgpu); the engine samples it every
   * frame into the holder's box. Sized to the holder (a same-size set is a no-op, so your own
   * `renderer.setSize` isn't clobbered). Null on purely native elements; an `<html>`'s is its root.
   */
  readonly element: E | null;
}

/** `<surfacePaint>` — a canvas the element's `ref` draws into (`element` on the received node). Takes no children. */
export type SurfacePaintProps = PaintProps;

/** `<Surface>` — a rectangle carrying a `<SurfacePaint>`; its `ref`'s `element` is the canvas. */
export type SurfaceProps = CommonProps;

/** Draws nothing inside a scene; on the canvas the editor shows its waveform in the `x`/`y`/`width`/`height` box. */
export type AudioProps = IdentityProps & PositionProps & SizeProps & TimingProps & MediaProps & AudioTrackProps & {
  /** `<KeyframeTrack>` (a `volume` track) and `<Animation>` children. */
  children?: SolidJSX.Element;
};

export type TextProps = CommonProps & Partial<ColorProps> & FontProps & {
  /** Horizontal alignment of glyphs within the box. Default "left". */
  textAlign?: "left" | "center" | "right";
  /** The block anchored top, bottom or middle, or ("alphabetic") the first baseline at the box top. Default "top". */
  textBaseline?: "top" | "middle" | "bottom" | "alphabetic";
  /** Line height as a multiple of each line's natural height. Default 1. */
  leading?: number;
  /**
   * The text content, required; alongside it, `<TextRange>`, paint,
   * `<Stroke>`, `<Shadow>`, `<Effect>`, `<Animation>` and `<KeyframeTrack>`
   * children.
   */
  children: SolidJSX.Element;
};

/**
 * `start`/`end` index the text as written (before `textCase`). Its paints, strokes and shadows replace
 * the text's for those glyphs; later ranges win where they overlap. Layout (`textAlign`,
 * `textBaseline`, `leading`) is not per range.
 */
export type TextRangeProps = Partial<ColorProps> & FontProps & {
  /** First character of the run, 0-based. */
  start: number;
  /** One past the last character of the run. Defaults to the end of the text. */
  end?: number;
  /** Paint, `<Stroke>`, `<Shadow>` and `<KeyframeTrack>` (a `color` track) children. */
  children?: SolidJSX.Element;
};

export type SequenceProps = Pick<IdentityProps, "name"> & {
  children?: SolidJSX.Element;
};

export type CaptionsProps = IdentityProps & TimingProps & OffsetProps & Partial<MediaProps> & {
  /** Caption style preset. Default "classic". */
  preset?: CaptionPreset;
  /** Fills the caption preset's color slots in order; any CSS color, alpha is ignored. */
  colors?: string[];
  /** Replaces the preset's face, colour, outlines and shadows; the preset keeps its grouping, placement and word motion. */
  look?: TextLookName;
  /** Anchored to the top or bottom safe margin, or centred; the preset keeps the horizontal placement. Defaults to the preset's. */
  verticalAlign?: "top" | "center" | "bottom";
  /** Most words on screen at once (1 = one word at a time); a new line still starts at every sentence mark and pause. */
  words?: number;
  /** Most characters on screen at once, spaces not counted. Defaults to the preset's own grouping. */
  chars?: number;
  /** Seconds the words stay after the last of them is said, unless the next line starts first. Default 0.3. */
  linger?: number;
  /** Part of the transcript cache key (scene id + seed): a new value transcribes the scene again. Default 0. */
  seed?: number;
  /** `<Animation>` children. */
  children?: SolidJSX.Element;
};
