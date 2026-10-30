/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// `generate.*` makes an asset from a prompt and `transform.*` one from an asset. Both are pure and
// return an `AssetRef`; nothing runs until the mounted tree commits, and refs never used are dropped.

export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

/** A path, URL, asset id, or another declaration. */
export type AssetInput = string | AssetRef;

export type GenerateImageOptions = {
  prompt: string;
  model?: string;
  aspectRatio?: AspectRatio;
  refs?: AssetInput[];
  seed?: number;
};

export type GenerateVideoOptions = {
  prompt: string;
  model?: string;
  aspectRatio?: AspectRatio;
  /** Whole seconds; default 5. */
  duration?: number;
  /** Generate audio alongside; models with the `audio` feature only. */
  audio?: boolean;
  /** Image used as the first frame. */
  startFrame?: AssetInput;
  /** Image used as the last frame; `end-frame` feature only. */
  endFrame?: AssetInput;
  seed?: number;
};

export type GenerateVoiceOptions = {
  prompt: string;
  /** Voice id; default the first voice from `dapi voices`. */
  voice?: string;
  seed?: number;
};

export type GenerateAudioOptions = {
  prompt: string;
  model?: string;
  duration?: number;
  seed?: number;
};

export type GenerateSpec =
  | ({ type: "image" } & GenerateImageOptions)
  | ({ type: "video" } & GenerateVideoOptions)
  | ({ type: "voice" } & GenerateVoiceOptions)
  | ({ type: "audio" } & GenerateAudioOptions);

export type TransformSpec =
  /** The input at twice the pixels; a picture or footage. */
  | { type: "upscale"; input: AssetInput }
  | { type: "removeBackground"; input: AssetInput }
  | { type: "addAudio"; input: AssetInput };

export type TransformType = TransformSpec["type"];

export type AssetSpecInput = GenerateSpec | TransformSpec;

const GENERATE_TYPES: readonly string[] = ["image", "video", "voice", "audio"];
const TRANSFORM_TYPES: readonly string[] = ["upscale", "removeBackground", "addAudio"];

export function isTransformType(type: string): type is TransformType {
  return TRANSFORM_TYPES.includes(type);
}

export function isTransformSpec(spec: AssetSpecInput): spec is TransformSpec {
  return isTransformType(spec.type);
}

/** Opaque handle to a declared (not-yet-made) asset, from `generate.*` or `transform.*`. */
export class AssetRef {
  /** @internal — read via `getAssetSpec`. */
  readonly spec: AssetSpecInput;

  /** @internal — declare refs with `generate.*` / `transform.*`, not `new AssetRef()`. */
  constructor(spec: AssetSpecInput) {
    this.spec = spec;
  }
}

export function isAssetRef(value: unknown): value is AssetRef {
  return value instanceof AssetRef;
}

export function getAssetSpec(ref: AssetRef): AssetSpecInput {
  return ref.spec;
}

/** The inputs a spec names, in option order: what the declaration depends on. */
export function getAssetInputs(spec: AssetSpecInput): AssetInput[] {
  switch (spec.type) {
    case "image":
      return spec.refs ?? [];
    case "video":
      return [spec.startFrame, spec.endFrame].filter((input): input is AssetInput => input !== undefined);
    case "voice":
    case "audio":
      return [];
    default:
      return [spec.input];
  }
}

/** Replaces direct inputs only (a caller wanting the whole chain recurses); returns `ref` itself when none change. */
export function mapAssetInputs(ref: AssetRef, map: (input: AssetInput) => AssetInput): AssetRef {
  const spec = ref.spec;
  let changed = false;
  const mapped = (input: AssetInput): AssetInput => {
    const next = map(input);
    if (next !== input) changed = true;
    return next;
  };

  let next: AssetSpecInput;
  switch (spec.type) {
    case "image":
      next = { ...spec, refs: spec.refs?.map(mapped) };
      break;
    case "video":
      next = {
        ...spec,
        startFrame: spec.startFrame === undefined ? undefined : mapped(spec.startFrame),
        endFrame: spec.endFrame === undefined ? undefined : mapped(spec.endFrame),
      };
      break;
    case "voice":
    case "audio":
      return ref;
    default:
      next = { ...spec, input: mapped(spec.input) };
  }
  return changed ? new AssetRef(next) : ref;
}

export type SerializedAssetInput = string | SerializedAssetRef;

export type SerializedAssetSpec =
  | ({ type: "image"; refs?: SerializedAssetInput[] } & Omit<GenerateImageOptions, "refs">)
  | ({ type: "video"; startFrame?: SerializedAssetInput; endFrame?: SerializedAssetInput } & Omit<GenerateVideoOptions, "startFrame" | "endFrame">)
  | ({ type: "voice" } & GenerateVoiceOptions)
  | ({ type: "audio" } & GenerateAudioOptions)
  | { type: TransformType; input: SerializedAssetInput };

/** An `AssetRef` can't travel as a prop value (see `isPropValue`), so an edit carries its spec in this tagged shape, inputs included. */
export interface SerializedAssetRef {
  $asset: SerializedAssetSpec;
}

export function serializeAssetRef(ref: AssetRef): SerializedAssetRef {
  const serializeInput = (input: AssetInput): SerializedAssetInput =>
    isAssetRef(input) ? serializeAssetRef(input) : input;

  const spec = ref.spec;
  const serialized: Record<string, unknown> = {};
  // Without the undefined entries: they are not part of the declaration, and
  // the writer spells every entry it is handed.
  for (const [key, value] of Object.entries(spec)) {
    if (value === undefined) continue;
    serialized[key] = key === "refs"
      ? (value as AssetInput[]).map(serializeInput)
      : key === "startFrame" || key === "endFrame" || key === "input"
        ? serializeInput(value as AssetInput)
        : value;
  }
  return { $asset: serialized as SerializedAssetSpec };
}

export function isSerializedAssetRef(value: unknown): value is SerializedAssetRef {
  if (typeof value !== "object" || value === null || !("$asset" in value)) return false;
  return isSerializedSpec((value as SerializedAssetRef).$asset);
}

export function reviveAssetRef(value: SerializedAssetRef): AssetRef {
  return new AssetRef(reviveSpec(value.$asset));
}

function reviveInput(input: SerializedAssetInput): AssetInput {
  return typeof input === "string" ? input : reviveAssetRef(input);
}

function reviveSpec(spec: SerializedAssetSpec): AssetSpecInput {
  switch (spec.type) {
    case "upscale":
    case "removeBackground":
    case "addAudio":
      return { type: spec.type, input: reviveInput(spec.input) };
    case "image": {
      const { refs, ...rest } = spec;
      return refs === undefined ? rest : { ...rest, refs: refs.map(reviveInput) };
    }
    case "video": {
      const { startFrame, endFrame, ...rest } = spec;
      return {
        ...rest,
        ...(startFrame === undefined ? {} : { startFrame: reviveInput(startFrame) }),
        ...(endFrame === undefined ? {} : { endFrame: reviveInput(endFrame) }),
      };
    }
    case "voice":
    case "audio":
      return spec;
  }
}

function isSerializedInput(value: unknown): value is SerializedAssetInput {
  return typeof value === "string" || isSerializedAssetRef(value);
}

function isSerializedSpec(spec: unknown): spec is SerializedAssetSpec {
  if (typeof spec !== "object" || spec === null) return false;
  const record = spec as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string") return false;

  if (isTransformType(type)) return isSerializedInput(record.input);
  if (!GENERATE_TYPES.includes(type) || typeof record.prompt !== "string") return false;
  if (record.refs !== undefined && !(Array.isArray(record.refs) && record.refs.every(isSerializedInput))) return false;
  if (record.startFrame !== undefined && !isSerializedInput(record.startFrame)) return false;
  if (record.endFrame !== undefined && !isSerializedInput(record.endFrame)) return false;
  return true;
}

function requirePrompt(value: unknown, call: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${call} requires a non-empty string prompt`);
  }
  return value;
}

function checkAssetInput(value: unknown, call: string, option: string): void {
  if (value === undefined) return;
  if (typeof value === "string" && value.trim().length > 0) return;
  if (isAssetRef(value)) return;
  throw new Error(`${call}: ${option} must be a path, URL, asset id, or an AssetRef`);
}

function requireAssetInput(value: unknown, call: string): AssetInput {
  if (value === undefined) throw new Error(`${call} requires an input: a path, URL, asset id, or an AssetRef`);
  checkAssetInput(value, call, "input");
  return value as AssetInput;
}

export const generate = {
  image(opts: GenerateImageOptions): AssetRef {
    requirePrompt(opts.prompt, "generate.image");
    for (const ref of opts.refs ?? []) checkAssetInput(ref, "generate.image", "refs");
    return new AssetRef({ type: "image", ...opts });
  },

  video(opts: GenerateVideoOptions): AssetRef {
    requirePrompt(opts.prompt, "generate.video");
    checkAssetInput(opts.startFrame, "generate.video", "startFrame");
    checkAssetInput(opts.endFrame, "generate.video", "endFrame");
    if (opts.duration !== undefined && (!Number.isInteger(opts.duration) || opts.duration <= 0)) {
      throw new Error("generate.video: duration must be a positive whole number of seconds");
    }
    return new AssetRef({ type: "video", ...opts });
  },

  voice(opts: GenerateVoiceOptions): AssetRef {
    requirePrompt(opts.prompt, "generate.voice");
    return new AssetRef({ type: "voice", ...opts });
  },

  audio(opts: GenerateAudioOptions): AssetRef {
    requirePrompt(opts.prompt, "generate.audio");
    if (opts.duration !== undefined && (!Number.isFinite(opts.duration) || opts.duration <= 0)) {
      throw new Error("generate.audio: duration must be a positive number of seconds");
    }
    return new AssetRef({ type: "audio", ...opts });
  },
};

/** A chain reads inside out and runs in that order; cached by step and input, so the same call on the same asset is the same asset. */
export const transform = {
  /** `input` at twice the pixels. A picture or footage; the box it is shown in is unchanged. */
  upscale(input: AssetInput): AssetRef {
    return new AssetRef({ type: "upscale", input: requireAssetInput(input, "transform.upscale") });
  },

  /** The subject of the picture `input` cut out, the rest transparent. */
  removeBackground(input: AssetInput): AssetRef {
    return new AssetRef({ type: "removeBackground", input: requireAssetInput(input, "transform.removeBackground") });
  },

  /** The footage `input` scored with a generated soundtrack. */
  addAudio(input: AssetInput): AssetRef {
    return new AssetRef({ type: "addAudio", input: requireAssetInput(input, "transform.addAudio") });
  },
};
