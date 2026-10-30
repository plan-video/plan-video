/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Data the compile step, the host and the editor all read to name source elements, so a canvas edit
 * can be written back to its JSX. None of them import each other; nothing here touches a file or host.
 */

/**
 * An id outlives edits that renumber the file, so an entity holds it rather than its position;
 * `syncTo` names one too. Any string; the editor only stamps elements that have none. Stripped at
 * compile time: what reaches the host is `SOURCE_ATTR`, which carries it.
 */
export const ID_ATTR = "id";

/** `<file relative to the project>:<id, or position in document order>`. */
export const SOURCE_ATTR = "__source";

/**
 * Stamped on elements inside a `<For>`/`<Index>` body: `<file>:<position of the loop element>`.
 * Iterations share one `SOURCE_ATTR`, so the editor gathers them and unrolls the source before it
 * writes. Only the nearest loop is named.
 */
export const LOOP_ATTR = "__loop";

export const LOOP_TAGS: readonly string[] = ["For", "Index"];

export const isLoopTag = (tag: string): boolean => LOOP_TAGS.includes(tag);

/** The value as a project would have written it, not as a host stores it: a color travels as "#161616", not a packed number. */
export type PropValue = number | string | boolean | null | PropValue[] | { [key: string]: PropValue };

/** A class instance (an `AssetRef`, say) is not, however plain its fields: as an object literal it would read back as something else. */
export function isPropValue(value: unknown): value is PropValue {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "object": {
      if (Array.isArray(value)) return value.every(isPropValue);
      const prototype = Object.getPrototypeOf(value);
      return (prototype === Object.prototype || prototype === null) && Object.values(value as object).every(isPropValue);
    }
    default:
      return false;
  }
}

/** Kept in step with the `IntrinsicElements` of "./jsx-runtime" by hand: that one is types, this is read at runtime. */
export const COMPOSITION_TAGS = [
  "stage",
  "scene",
  "group",
  "rect",
  "video",
  "image",
  "audio",
  "text",
  "textRange",
  "sequence",
  "captions",
  "adjustmentLayer",
  "solidPaint",
  "linearGradientPaint",
  "radialGradientPaint",
  "imagePaint",
  "videoPaint",
  "colorStop",
  "stroke",
  "shadow",
  "effect",
  "grade",
  "animation",
  "keyframeTrack",
  "keyframe",
  "htmlPaint",
  "html",
  "shaderPaint",
  "surfacePaint",
  "surface",
] as const;

export type CompositionTag = (typeof COMPOSITION_TAGS)[number];

const TAGS: ReadonlySet<string> = new Set(COMPOSITION_TAGS);

/** Both spellings: the camelCase intrinsics and the PascalCase components the compile step canonicalizes them into. */
export function isCompositionTag(tag: string): boolean {
  return TAGS.has(tag) || TAGS.has(tag.charAt(0).toLowerCase() + tag.slice(1));
}

/**
 * `file:locator`, where a numeric locator is the position in document order and anything else an id.
 * An id that moved to another file reads as gone rather than as some other element (the safe way to be wrong).
 */
export function parseSource(id: string): { file: string; locator: number | string } | undefined {
  const at = id.lastIndexOf(":");
  if (at < 0) return undefined;

  const suffix = id.slice(at + 1);
  if (!suffix) return undefined;

  const index = Number(suffix);
  return { file: id.slice(0, at), locator: Number.isInteger(index) ? index : suffix };
}

export const formatSource = (file: string, locator: number | string): string => `${file}:${locator}`;
