/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { getAssetSpec, isAssetRef, isTransformSpec, isTransformType, parseSource } from "@plan.video/jsx";
import {
  Ai, AssetId, Audio, Computed, FrameRate, GenAi,   getAsset, getAssetFile, getEntityTree, getParentNode,
  getSourceWindow, Hidden, isPaintEntity, Muted, Paint, PaintType, Project, readSpeedCurve, Source,
  timelineOffsetAtSource,
} from "@plan.video/runtime";
import { createEncoder } from "@plan.video/encoder";
import { createCapture } from "@/engine/capture";
import { isPendingSource } from "@/engine/editor";
import { assetName, GENERATED_DIR, isPartialAsset } from "@plan.video/assets";
import {
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_VOICE_MODEL,
  PROMPT_INPUT_VOICE_OPTIONS,
} from "@/components/genai/config";
import { assert, mimeTypeToExtension } from "@/utils";
import { extractSpeechWav, type SpeechWav } from "@/lib/clip-audio";
import { placeClipWords, segmentWords, transcribeAudio, TranscriptionRefused, type ClipTiming } from "@/lib/transcribe";
import { snapToSpeech } from "@/lib/speech-timing";
import { uploadBlob } from "@/lib/uploads";
import { removeImageBackground } from "@/lib/background-removal";
import { track } from "@/lib/analytics";
import { msg, t } from "@/lib/i18n";
import { trpc } from "@/lib/trpc";
import { toast } from "somoto";

import type { AspectRatio, AssetInput, AssetRef, AssetSpecInput, GenerateSpec, TransformType } from "@plan.video/jsx";
import type { Asset, AssetLibrary, AssetType, PartialAsset, ReserveOptions, Transcript } from "@plan.video/assets";
import type { FileRef } from "@plan.video/api-contract";
import type { ExportResult } from "@plan.video/encoder";
import type { Entity, World } from "koota";

const FAILURE_TITLES: Record<GenerateSpec["type"] | "transcript", string> = {
  image: msg("Image generation failed"),
  video: msg("Video generation failed"),
  voice: msg("Voice generation failed"),
  audio: msg("Audio generation failed"),
  transcript: msg("Caption generation failed"),
};

const ASSET_TYPES: Record<GenerateSpec["type"], AssetType> = {
  image: "IMAGE",
  video: "VIDEO",
  voice: "AUDIO",
  audio: "AUDIO",
};

const TRANSFORMS: Record<TransformType, { title: string; suffix: string }> = {
  removeBackground: { title: msg("Background removal failed"), suffix: "Background removed" },
  upscale: { title: msg("Upscale failed"), suffix: "Upscaled" },
  addAudio: { title: msg("Adding audio failed"), suffix: "With audio" },
};

/**
 * Field order is fixed, so `JSON.stringify` of it is a stable `generationKey`. A
 * transform's key is its type and input alone: the endpoints take no model or factor.
 */
type ResolvedGeneration =
  | { type: "image"; model: string; prompt: string; aspectRatio: AspectRatio; seed?: number; refIds: string[] }
  | { type: "video"; model: string; prompt: string; aspectRatio: AspectRatio; duration: number; audio: boolean; seed?: number; startFrameId?: string; endFrameId?: string }
  | { type: "voice"; model: string; prompt: string; voice: string; seed?: number }
  | { type: "audio"; model: string; prompt: string; duration?: number; seed?: number };
type ResolvedTransform = { type: TransformType; inputId: string };
type ResolvedSpec = ResolvedGeneration | ResolvedTransform;

const isResolvedTransform = (spec: ResolvedSpec): spec is ResolvedTransform => isTransformType(spec.type);

type RunDescription = Omit<ReserveOptions, "key" | "folder"> & { title: string };

/** Already told to the user; passed up the dependency graph as is, so it isn't reported twice. */
class ReportedError extends Error {}

export function attachAi(world: World, library: AssetLibrary): EditorGenAi {
  const ai = new EditorGenAi(library, world.get(Project)?.id ?? "project");
  world.set(Ai, ai);
  return ai;
}

export class EditorGenAi extends GenAi {
  private readonly library: AssetLibrary;
  /** Prefixes upload keys, so referenced assets land project-unique in the bucket. */
  private readonly projectId: string;

  /**
   * Keyed by ref identity, so a ref used by several elements resolves once. A failed one is
   * forgotten, so asking again once its record is gone asks the library again.
   */
  private readonly memo = new Map<AssetRef, Promise<Asset>>();
  private readonly inflight = new Map<string, Promise<Asset>>();

  public constructor(library: AssetLibrary, projectId: string) {
    super();
    this.library = library;
    this.projectId = projectId;
  }

  /** Identical concurrent declarations collapse to one request. */
  public resolve(ref: AssetRef): Promise<Asset> {
    assert(isAssetRef(ref), "Not a generate.* declaration");

    let promise = this.memo.get(ref);
    if (!promise) {
      promise = this.generateFromRef(ref);
      promise.catch(() => this.memo.delete(ref));
      this.memo.set(ref, promise);
    }
    return promise;
  }

  /** Keyed by scene id + seed: the same pair is the same transcript across sessions; a new seed transcribes again. */
  public async transcribe(world: World, scene: Entity, seed: number): Promise<Asset> {
    await named(scene);
    const key = transcriptKey(scene, seed);
    return this.generated(
      key,
      () => ({ type: "TRANSCRIPT", name: `${this.nextCaptionsName()}.json`, title: FAILURE_TITLES.transcript }),
      (partial) => this.runTranscription(world, scene, key, partial),
    );
  }

  /**
   * A key in error rejects with its recorded reason: not run, paid for or toasted again. A
   * run in flight is joined, and a pending partial a previous session never finished is
   * taken over.
   */
  private async generated(
    key: string,
    describe: () => RunDescription,
    run: (partial: PartialAsset) => Promise<Asset>,
  ): Promise<Asset> {
    const known = this.library.generated(key);
    if (known && !isPartialAsset(known)) return known;
    if (known?.state === "error") throw new ReportedError(known.error || t("Generation failed"));

    const running = this.inflight.get(key);
    if (running) return await running;

    const { title, ...partial } = describe();
    const promise = this.library.reserve({ key, folder: GENERATED_DIR, ...partial }).then(async (reserved) => {
      try {
        return await run(reserved);
      } catch (error) {
        const failure = reportFailure(error, title);
        this.library.fail(reserved, failure.message);
        throw failure;
      }
    });
    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async generateFromRef(ref: AssetRef): Promise<Asset> {
    const spec = getAssetSpec(ref);
    const title = isTransformSpec(spec) ? TRANSFORMS[spec.type].title : FAILURE_TITLES[spec.type];

    // Inputs first: their ids are part of the key. An input that failed has said so already.
    let resolved: ResolvedSpec;
    try {
      resolved = await this.resolveSpec(spec);
    } catch (error) {
      throw error instanceof ReportedError ? error : reportFailure(error, title);
    }

    return this.generated(
      JSON.stringify(resolved),
      () => ({ ...this.describe(resolved), title }),
      (partial) => isResolvedTransform(resolved)
        ? this.runTransform(resolved, partial)
        : this.runGeneration(resolved, partial),
    );
  }

  private describe(spec: ResolvedSpec): { type: AssetType; name: string } {
    if (!isResolvedTransform(spec)) return { type: ASSET_TYPES[spec.type], name: provisionalName(spec.prompt) };
    const input = this.library.get(spec.inputId);
    assert(input, `Input asset ${spec.inputId} not found`);
    return { type: input.type, name: `${stem(input)} (${TRANSFORMS[spec.type].suffix})` };
  }

  private resolveInput(input: AssetInput): Promise<Asset> {
    return isAssetRef(input) ? this.resolve(input) : this.library.resolve(input);
  }

  private async resolveSpec(spec: AssetSpecInput): Promise<ResolvedSpec> {
    if (isTransformSpec(spec)) {
      const input = await this.resolveInput(spec.input);
      return { type: spec.type, inputId: input.id };
    }

    switch (spec.type) {
      case "image": {
        const refs = await Promise.all((spec.refs ?? []).map((ref) => this.resolveInput(ref)));
        return {
          type: "image",
          model: spec.model ?? PROMPT_INPUT_IMAGE_MODEL_OPTIONS[0].id,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio ?? "16:9",
          seed: spec.seed,
          refIds: refs.map((asset) => asset.id),
        };
      }
      case "video": {
        const [startFrame, endFrame] = await Promise.all([
          spec.startFrame !== undefined ? this.resolveInput(spec.startFrame) : undefined,
          spec.endFrame !== undefined ? this.resolveInput(spec.endFrame) : undefined,
        ]);
        return {
          type: "video",
          model: spec.model ?? PROMPT_INPUT_VIDEO_MODEL_OPTIONS[0].id,
          prompt: spec.prompt,
          aspectRatio: spec.aspectRatio ?? "16:9",
          duration: spec.duration ?? 5,
          audio: spec.audio ?? false,
          seed: spec.seed,
          startFrameId: startFrame?.id,
          endFrameId: endFrame?.id,
        };
      }
      case "voice": {
        return {
          type: "voice",
          model: PROMPT_INPUT_VOICE_MODEL,
          prompt: spec.prompt,
          voice: spec.voice ?? PROMPT_INPUT_VOICE_OPTIONS[0].value,
          seed: spec.seed,
        };
      }
      case "audio": {
        return {
          type: "audio",
          model: spec.model ?? PROMPT_INPUT_AUDIO_MODEL_OPTIONS[0].id,
          prompt: spec.prompt,
          duration: spec.duration,
          seed: spec.seed,
        };
      }
    }
  }

  /** A spec a model can't take fails here, after the partial is reserved, so the refusal is recorded and not asked again. */
  private async runGeneration(spec: ResolvedGeneration, partial: PartialAsset): Promise<Asset> {
    if (spec.type === "video") checkVideoConstraints(spec);

    const startedAt = performance.now();
    track("generation_started", {
      mode: spec.type,
      model: spec.model,
      prompt_length: spec.prompt.length,
      ...("aspectRatio" in spec ? { aspect_ratio: spec.aspectRatio } : {}),
      ...(spec.type === "image" ? { reference_count: spec.refIds.length } : {}),
    });

    try {
      const { name, results, generationId } = await this.requestGeneration(spec);
      assert(results.length > 0, "No results returned from the model");

      const asset = await this.store(results[0].url, name, { key: partial.generation.key, id: generationId });
      track("generation_completed", {
        mode: spec.type,
        model: spec.model,
        duration_ms: Math.round(performance.now() - startedAt),
      });
      return asset;
    } catch (err) {
      track("generation_failed", {
        mode: spec.type,
        model: spec.model,
        duration_ms: Math.round(performance.now() - startedAt),
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      throw err;
    }
  }

  private async runTranscription(world: World, scene: Entity, key: string, partial: PartialAsset): Promise<Asset> {
    assert(sceneHasAudio(world, scene), t("No audio found. Add an audio or video clip to the scene to generate captions."));

    // Each clip's own audio: a re-rendered mix resamples and reschedules the sound, and the
    // word times come back off the picture.
    const clips = await speechClips(world, scene);
    const placed = (
      await Promise.all(clips.map(async (clip) => {
        try {
          const extracted = await extractSpeechWav(clip.file, clip.trimStart, clip.trimEnd);
          if (!extracted) return [];
          return placeClipWords(await hearSpeech(extracted), clip, extracted.mediaStart);
        } catch (error) {
          // The server said no: rendering the whole scene to ask again only gets the same answer later.
          if (error instanceof TranscriptionRefused) throw error;
          console.warn("[gen-ai] clip transcription failed, using the scene mix", error);
          return [];
        }
      }))
    ).flat();

    // An empty clip read must not win: the scene mix already produced captions for this video.
    const transcript = placed.length > 0
      ? segmentWords(placed)
      : await this.transcribeSceneMix(world, scene);
    assert(
      transcript.length > 0 && transcript.some((segment) => segment.words.length > 0),
      t("No speech detected. The audio does not appear to contain recognizable speech."),
    );

    const blob = new Blob([JSON.stringify(transcript)], { type: "application/json" });
    return this.library.store(blob, {
      name: assetName(partial),
      folder: GENERATED_DIR,
      generation: { key },
    });
  }

  /** For clips whose audio track can't be read. Word times follow the resampled render, so they're less exact. */
  private async transcribeSceneMix(world: World, scene: Entity) {
    const capture = await createCapture(world, scene, { mode: "offline-audio" });
    let result: ExportResult;
    try {
      const encoder = await createEncoder(capture.world, {
        format: "wav",
        video: { enabled: false },
        audio: { enabled: true, codec: "pcm-s16", sampleRate: 16000, numberOfChannels: 1 },
      });
      result = await encoder.render();
    } finally {
      capture.dispose();
    }
    assert(result.type === "success" && result.data !== undefined, "Failed to encode the scene audio");

    const audioFile = new File([result.data], `${crypto.randomUUID()}.wav`, { type: "audio/wav" });
    // 16-bit mono at 16 kHz: two bytes a sample.
    const speech = await extractSpeechWav(audioFile, 0, audioFile.size / (16000 * 2)).catch(() => null);
    return speech ? hearSpeech(speech) : transcribeAudio(audioFile);
  }

  /** Counts the takes still in flight. */
  private nextCaptionsName(): string {
    let max = 0;
    for (const entry of [...this.library.list(), ...this.library.partials()]) {
      const match = assetName(entry).match(/^Captions (\d+)\.json$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `Captions ${max + 1}`;
  }

  public transformInput(input: AssetInput): Promise<Asset> {
    return this.resolveInput(input);
  }

  public transformed(type: TransformType, input: Asset): Asset | undefined {
    const known = this.library.generated(transformKey(type, input));
    return known && !isPartialAsset(known) ? known : undefined;
  }

  /** Files a result made outside the asset system as the transform's, so the declaration binds to it instead of running again. */
  public async adoptTransform(type: TransformType, input: Asset, blob: Blob): Promise<Asset> {
    return this.transformed(type, input) ?? this.library.store(blob, {
      name: `${stem(input)} (${TRANSFORMS[type].suffix})${mimeTypeToExtension(blob.type)}`,
      folder: GENERATED_DIR,
      generation: { key: transformKey(type, input) },
    });
  }

  /**
   * A background is removed on this device; the rest go to the server. A transform over the
   * wrong kind of asset fails here, like a spec a model can't take: recorded, not asked again.
   */
  private async runTransform(spec: ResolvedTransform, partial: PartialAsset): Promise<Asset> {
    const asset = this.library.get(spec.inputId);
    assert(asset, `Input asset ${spec.inputId} not found`);
    checkTransformInput(spec.type, asset);

    const startedAt = performance.now();
    track("generation_started", { mode: spec.type });

    try {
      const stored = spec.type === "removeBackground"
        ? await this.removeBackgroundHere(asset, partial)
        : await this.requestTransform(spec.type, asset, await this.uploadInput(asset.id)).then(({ url, generationId }) =>
          this.store(url, assetName(partial), { key: partial.generation.key, id: generationId }));

      track("generation_completed", {
        mode: spec.type,
        duration_ms: Math.round(performance.now() - startedAt),
      });
      return stored;
    } catch (err) {
      track("generation_failed", {
        mode: spec.type,
        duration_ms: Math.round(performance.now() - startedAt),
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
      throw err;
    }
  }

  private async removeBackgroundHere(asset: Asset, partial: PartialAsset): Promise<Asset> {
    const { blob } = await removeImageBackground(await getAssetFile(asset));
    return this.library.store(blob, {
      name: `${assetName(partial)}.png`,
      folder: GENERATED_DIR,
      generation: { key: partial.generation.key },
    });
  }

  private requestTransform(type: Exclude<TransformType, "removeBackground">, asset: Asset, input: FileRef) {
    switch (type) {
      case "upscale":
        return isMoving(asset.type)
          ? trpc.upscaleVideo.mutate({ video: input })
          : trpc.upscaleImage.mutate({ image: input });
      case "addAudio":
        return trpc.addAudioToVideo.mutate({ video: input });
    }
  }

  /** Named after what came back, not what was asked for. */
  private async store(url: string, name: string, generation: { key: string; id?: string | null }): Promise<Asset> {
    const response = await fetch(url);
    assert(response.ok, `Failed to fetch the generated asset: ${response.status}`);
    const blob = await response.blob();

    return this.library.store(blob, {
      name: name + resultExtension(url, blob),
      folder: GENERATED_DIR,
      generation,
    });
  }

  private requestGeneration(spec: ResolvedGeneration) {
    switch (spec.type) {
      case "image": {
        return (async () => {
          const images = spec.refIds.length > 0
            ? await Promise.all(spec.refIds.map((id) => this.uploadInput(id)))
            : undefined;

          return await trpc.generateImage.mutate({
            model: spec.model,
            prompt: spec.prompt,
            aspectRatio: spec.aspectRatio,
            count: 1,
            seed: spec.seed,
            images,
          });
        })();
      }
      case "video": {
        return (async () => {
          const [startFrame, endFrame] = await Promise.all([
            spec.startFrameId ? this.uploadInput(spec.startFrameId) : undefined,
            spec.endFrameId ? this.uploadInput(spec.endFrameId) : undefined,
          ]);

          return await trpc.generateVideo.mutate({
            model: spec.model,
            prompt: spec.prompt,
            aspectRatio: spec.aspectRatio,
            duration: spec.duration,
            generateAudio: spec.audio,
            seed: spec.seed,
            startFrame,
            endFrame,
          });
        })();
      }
      case "voice": {
        return trpc.textToSpeech.mutate({
          model: spec.model,
          prompt: spec.prompt,
          voice: spec.voice,
          seed: spec.seed,
        });
      }
      case "audio": {
        return trpc.generateSound.mutate({
          model: spec.model,
          prompt: spec.prompt,
          duration: spec.duration,
          seed: spec.seed,
        });
      }
    }
  }

  private async uploadInput(assetId: string) {
    const asset = this.library.get(assetId);
    assert(asset, `Referenced asset ${assetId} not found`);
    const uploaded = await uploadBlob(await getAssetFile(asset), `${this.projectId}-${assetId}`);
    assert(uploaded, `Failed to upload referenced asset ${assetId}`);
    return uploaded;
  }
}

const isMoving = (type: AssetType): boolean => type === "VIDEO" || type === "SEQUENCE";

const stem = (asset: Asset): string => assetName(asset).replace(/\.[^.]+$/, "");

/** Must match the key `generateFromRef` files a transform under. */
const transformKey = (type: TransformType, input: Asset): string => JSON.stringify({ type, inputId: input.id } satisfies ResolvedTransform);

/** Only checkable once the input has resolved. */
function checkTransformInput(type: TransformType, input: Asset): void {
  switch (type) {
    case "removeBackground":
      assert(input.type === "IMAGE", t("Only a picture has a background to remove"));
      return;
    case "upscale":
      assert(input.type === "IMAGE" || isMoving(input.type), t("Only a picture or footage can be upscaled"));
      return;
    case "addAudio":
      assert(isMoving(input.type), t("Only footage can be scored"));
      return;
  }
}

const PROVISIONAL_NAME_LENGTH = 48;

function provisionalName(prompt: string): string {
  const text = prompt.trim().replace(/\s+/g, " ").replace(/\//g, "-");
  if (text.length <= PROVISIONAL_NAME_LENGTH) return text || t("Generation");
  const cut = text.lastIndexOf(" ", PROVISIONAL_NAME_LENGTH);
  return `${text.slice(0, cut > 0 ? cut : PROVISIONAL_NAME_LENGTH)}…`;
}

/**
 * Neither extension is guaranteed: some models return a plain slug, some servers say only
 * `application/octet-stream`, so this can be empty and the library reads the bytes instead.
 */
function resultExtension(url: string, blob: Blob): string {
  const fromType = blob.type ? mimeTypeToExtension(blob.type) : ".bin";
  if (fromType !== ".bin") return fromType;

  const fileName = url.split(/[?#]/)[0]!.split("/").pop() ?? "";
  const dot = fileName.lastIndexOf(".");
  const fromUrl = dot > 0 ? fileName.slice(dot + 1) : "";
  return fromUrl && fromUrl.length <= 5 ? `.${fromUrl}` : "";
}

/**
 * The message is what the library records and the element carries, so the asset panel,
 * canvas and toast say the same. The toast is keyed by it, so variants that failed the same
 * way show once.
 */
function reportFailure(error: unknown, title: string): ReportedError {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`[gen-ai] ${title}:`, error);
  toast.error(t(title), {
    id: `gen-ai:${title}:${message}`,
    description: message,
  });

  return new ReportedError(message);
}

const NAMING_TIMEOUT = 5000;

/**
 * A scene the editor just made, or put back with an undo, holds a pending source until a
 * write names it. The audio capture looks the scene up by source and the transcript is keyed
 * by it, so starting earlier fails the capture and files the transcript under the wrong name.
 */
async function named(scene: Entity): Promise<void> {
  const started = performance.now();
  while (
    scene.isAlive()
    && isPendingSource(scene.get(Source)?.value ?? "")
    && performance.now() - started < NAMING_TIMEOUT
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A scene without a source stamp falls back to its entity id, which only holds within the session. */
function transcriptKey(scene: Entity, seed: number): string {
  const source = scene.get(Source)?.value;
  const locator = source ? parseSource(source)?.locator : undefined;
  const sceneId = typeof locator === "string" ? locator : source ?? String(scene.id());
  return `transcript:v1:${sceneId}:${seed}`;
}

interface SpeechClip extends ClipTiming {
  file: File;
}

async function hearSpeech(speech: SpeechWav): Promise<Transcript> {
  return snapToSpeech(await transcribeAudio(speech.wav), speech.envelope);
}

/** The origin is the scene time of media time 0, where the picture seeks the same moment. */
async function speechClips(world: World, scene: Entity): Promise<SpeechClip[]> {
  const fps = world.get(FrameRate)?.value || 30;
  const clips: SpeechClip[] = [];

  const heard = new Set<Entity>();

  for (const entity of getEntityTree(world, scene)) {
    if (entity === scene || entity.has(Hidden) || entity.has(Muted) || !entity.has(AssetId)) continue;
    const paint = entity.get(Paint)?.value;
    if (!entity.has(Audio) && paint !== PaintType.VIDEO) continue;

    const asset = getAsset(world, entity.get(AssetId)!.value);
    if (!asset || (asset.type !== "AUDIO" && asset.type !== "VIDEO")) continue;

    // A video paint is a child of the clip and keeps the 16s length a new entity starts with;
    // the clip on the timeline is what playback hears. Muted or hidden clips aren't heard
    // through their paint either, and each clip is heard once or every word comes back twice.
    const clip = isPaintEntity(entity) ? getParentNode(entity) ?? entity : entity;
    if (heard.has(clip) || clip.has(Muted) || clip.has(Hidden)) continue;
    heard.add(clip);
    const source = getSourceWindow(clip);
    const computed = clip.get(Computed);
    const curve = readSpeedCurve(clip);
    const originFrames = computed?.origin ?? 0;
    clips.push({
      file: await getAssetFile(asset),
      origin: originFrames / fps,
      rate: computed?.playbackRate || 1,
      trimStart: source.in / fps,
      trimEnd: Math.max(source.in, source.out) / fps,
      at: curve.keys.length > 0
        ? (mediaSeconds: number) => (originFrames + timelineOffsetAtSource(curve, mediaSeconds * fps)) / fps
        : undefined,
    });
  }

  return clips;
}

function sceneHasAudio(world: World, scene: Entity): boolean {
  for (const entity of getEntityTree(world, scene)) {
    if (entity.has(Hidden) || entity.has(Muted) || !entity.has(AssetId)) continue;
    const clip = isPaintEntity(entity) ? getParentNode(entity) ?? entity : entity;
    if (clip.has(Muted) || clip.has(Hidden)) continue;
    if (entity.has(Audio) || entity.get(Paint)?.value === PaintType.VIDEO) return true;
  }
  return false;
}

/** Per-model constraints (`planvideo models video`); unknown models are left to the server. */
function checkVideoConstraints(spec: Extract<ResolvedGeneration, { type: "video" }>): void {
  const model = PROMPT_INPUT_VIDEO_MODEL_OPTIONS.find((option) => option.id === spec.model);
  if (!model) return;

  assert(model.aspectRatios.includes(spec.aspectRatio), `${spec.model} does not support aspect ratio ${spec.aspectRatio}`);
  assert(model.durations.includes(`${spec.duration}s`), `${spec.model} does not support a duration of ${spec.duration}s`);
  assert(!spec.audio || model.features.includes("audio"), `${spec.model} does not support audio generation`);
  assert(spec.endFrameId === undefined || model.features.includes("end-frame"), `${spec.model} does not support an end frame`);
}
