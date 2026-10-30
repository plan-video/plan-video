/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createResource } from "solid-js";
import { getAssetSpec, isAssetRef, isTransformSpec } from "@plan.video/jsx";
import { authoredElement } from "@plan.video/reconciler";
import { useLibrary } from "@/engine/library";
import { supabase } from "@/lib/supabase";
import { settled } from "@/utils/signal";
import { useMediaSelection } from "./selection";
import {
  PROMPT_INPUT_AUDIO_MODEL_OPTIONS,
  PROMPT_INPUT_IMAGE_MODEL_OPTIONS,
  PROMPT_INPUT_VIDEO_MODEL_OPTIONS,
  PROMPT_INPUT_VOICE_MODEL,
  PROMPT_INPUT_VOICE_OPTIONS,
} from "./config";
import { generationConfigSchema, type GenerationConfig } from "./schemas";

import type { AssetInput, AssetRef, GenerateSpec } from "@plan.video/jsx";
import type { AssetLibrary } from "@plan.video/assets";

// Stored configs carry `fileRef`s with embedded `assetId`s instead of raw asset ids; this normalizes
// them so the object validates as a `GenerationConfig`.
export function toClientConfig(stored: unknown): GenerationConfig | undefined {
  if (!stored || typeof stored !== "object") return undefined;
  const c = stored as Record<string, unknown> & {
    images?: Array<{ assetId?: string }>;
    startFrame?: { assetId?: string };
    endFrame?: { assetId?: string };
  };

  const candidate: Record<string, unknown> = { ...c };

  if (c.images) {
    const imageRefIds = c.images
      .map((r) => r.assetId)
      .filter((id): id is string => typeof id === "string");
    delete candidate.images;
    if (imageRefIds.length > 0) candidate.imageRefIds = imageRefIds;
  }
  if (c.startFrame?.assetId) {
    candidate.startFrameImageId = c.startFrame.assetId;
  }
  delete candidate.startFrame;
  if (c.endFrame?.assetId) {
    candidate.endFrameImageId = c.endFrame.assetId;
  }
  delete candidate.endFrame;

  const parsed = generationConfigSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

// Inputs are named by library path in the file and by asset id in the prompt box.
function toPromptConfig(spec: GenerateSpec, library: AssetLibrary): GenerationConfig {
  const idOf = (input: AssetInput | undefined): string | undefined =>
    typeof input === "string" ? library.get(input)?.id : undefined;

  switch (spec.type) {
    case "image":
      return {
        mode: "IMAGE",
        model: spec.model ?? PROMPT_INPUT_IMAGE_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
        aspectRatio: spec.aspectRatio ?? "16:9",
        count: 1,
        imageRefIds: (spec.refs ?? []).map(idOf).filter((id): id is string => id !== undefined),
      };
    case "video":
      return {
        mode: "VIDEO",
        model: spec.model ?? PROMPT_INPUT_VIDEO_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
        aspectRatio: spec.aspectRatio ?? "16:9",
        duration: spec.duration ?? 5,
        generateAudio: spec.audio ?? false,
        startFrameImageId: idOf(spec.startFrame),
        endFrameImageId: idOf(spec.endFrame),
      };
    case "voice":
      return {
        mode: "VOICE",
        model: PROMPT_INPUT_VOICE_MODEL,
        prompt: spec.prompt,
        voice: spec.voice ?? PROMPT_INPUT_VOICE_OPTIONS[0].value,
      };
    case "audio":
      return {
        mode: "AUDIO",
        model: spec.model ?? PROMPT_INPUT_AUDIO_MODEL_OPTIONS[0].id,
        prompt: spec.prompt,
      };
  }
}

function generationUnder(ref: AssetRef): GenerateSpec | undefined {
  const spec = getAssetSpec(ref);
  if (!isTransformSpec(spec)) return spec;
  return isAssetRef(spec.input) ? generationUnder(spec.input) : undefined;
}

export function useGenerationRecords() {
  const library = useLibrary();
  const { bound, sources } = useMediaSelection();

  // Read from the declarations, so this answers before the asset exists; transforms are looked through.
  const declarations = createMemo(() =>
    sources()
      .map((entity) => authoredElement(entity)?.props.src)
      .filter(isAssetRef)
      .map(generationUnder)
      .filter((spec): spec is GenerateSpec => spec !== undefined),
  );

  // Credits are the server's to know, and it knows them per generation.
  const generationIds = createMemo(() => {
    const ids = new Set<string>();
    for (const { asset } of bound()) {
      if (asset.generation?.id) ids.add(asset.generation.id);
    }
    return [...ids];
  }, [], { equals: (a, b) => a.length === b.length && a.every((id, i) => id === b[i]) });

  const [records] = createResource(() => generationIds().length > 0 && generationIds(), async (ids) => {
    if (!supabase) return [];
    const { data, error } = await supabase
      .from("usage_records")
      .select("id,credits,config")
      .in("id", ids);

    if (error) {
      console.error("[credits] Failed to load usage records", error);
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      credits: (row.credits as number | null) ?? 0,
      config: row.config as unknown,
    }));
  },
  );

  const settledRecords = () => (generationIds().length > 0 && settled(records)) || [];

  const totalCredits = createMemo(() => {
    return settledRecords().reduce((sum, r) => sum + r.credits, 0);
  });

  const isGenerated = createMemo(() => declarations().length > 0 || generationIds().length > 0);

  const firstConfig = (): GenerationConfig | undefined => {
    const lib = library();
    const declared = declarations()[0];
    if (declared && lib) return toPromptConfig(declared, lib);

    // Nothing declared: an asset generated before projects were JSX, whose settings only the run's record has.
    const ids = generationIds();
    if (ids.length === 0) return undefined;
    const record = settledRecords().find((r) => r.id === ids[0]);
    return toClientConfig(record?.config);
  };

  return { isGenerated, totalCredits, firstConfig };
}
