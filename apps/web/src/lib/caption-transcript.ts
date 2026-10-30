/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { assetName, isUrlSource, type Asset, type AssetLibrary, type Transcript, type TranscriptWord } from "@plan.video/assets";
import {
  AssetId,
  Caption,
  CaptionDecoderHandle,
  isCaption,
  Computed,
  FrameRate,
  Host,
  Library,
  bubbleTimeRangeUp,
  forgetAssetFile,
  getNextName,
  getSourceFrameAt,
  getTimelineOrigin,
  recomputeEntityTimeRange,
  resolveTranscript,
  Selected,
  secondsToFrames,
  setTranscriptDuration,
  store,
} from "@plan.video/runtime";
import { createSignal } from "solid-js";
import { toast } from "somoto";

import { insertWords, keepWords, listWords, removeWords, transcriptEnd, wordsText } from "@/lib/caption-edit";
import { t } from "@/lib/i18n";
import { getDocumentEditor } from "@/engine/editor";
import { getEditHistory, setCaptionTranscriptApplier } from "@/engine/history";
import { authoredTime, editTime } from "@/engine/timing";
import { captionWordSelection, clearCaptionWordSelection, setCaptionWordSelection } from "@/engine/timeline/caption-word-selection";

import type { Entity, World } from "koota";

/** A drag has already moved the timeline decoder's words; reloading them would drop a drag still going. */
export type CaptionEditSource = "list" | "drag" | "timeline";

const writes = new Map<string, Promise<void>>();

/** Bumped on undo/redo, so a pending keystroke does not save over it. */
const [historyStamp, setHistoryStamp] = createSignal(0);
export const captionHistoryStamp = historyStamp;

setCaptionTranscriptApplier((world, assetId, transcript) => {
  const library = world.get(Library);
  const asset = library?.get(assetId);
  if (!library || !asset || asset.type !== "TRANSCRIPT") return;
  setHistoryStamp((stamp) => stamp + 1);
  void saveCaptionTranscript(world, library, asset, transcript);
});

/** So each panel showing its words reloads. */
const [transcriptRevision, setTranscriptRevision] = createSignal(0);
export const captionTranscriptRevision = transcriptRevision;

export function saveCaptionTranscript(
  world: World,
  library: AssetLibrary,
  asset: Asset,
  transcript: Transcript,
  source: CaptionEditSource = "list",
): Promise<void> {
  return queue(asset, () => persistCaptionTranscript(world, library, asset, transcript, source));
}

/** False when no words are picked, so the caller can act on the selection instead. */
export function removePickedCaptionWords(world: World, copy = false): boolean {
  const picked = captionWordSelection();
  if (!picked || picked.indices.size === 0) return false;

  const { entity, indices } = picked;
  const assetId = entity.isAlive() ? entity.get(AssetId)?.value : undefined;
  const library = world.get(Library);
  const asset = assetId ? library?.get(assetId) : undefined;
  clearCaptionWordSelection();
  if (!library || !asset) return true;

  void queue(asset, async () => {
    let transcript: Transcript;
    try {
      transcript = await resolveTranscript(asset);
    } catch {
      toast.error(t("Could not edit captions"), { description: t("The caption file could not be read.") });
      return;
    }
    if (copy) void navigator.clipboard?.writeText(wordsText(transcript, indices)).catch(() => undefined);
    const next = removeWords(transcript, indices);
    getEditHistory(world).recordTranscript(asset.id, transcript, next);
    await persistCaptionTranscript(world, library, asset, next, "timeline");
  });
  return true;
}

let wordClipboard: TranscriptWord[] | null = null;
let wordsOnClipboard = false;
let clipboardChain: Promise<void> = Promise.resolve();

function enqueueClipboard(task: () => Promise<void>): Promise<void> {
  const run = clipboardChain.catch(() => undefined).then(task);
  clipboardChain = run;
  return run;
}

function captionFile(world: World, entity: Entity): { library: AssetLibrary; asset: Asset } | null {
  if (!entity.isAlive() || !isCaption(entity)) return null;
  const library = world.get(Library);
  const assetId = entity.get(AssetId)?.value;
  const asset = assetId ? library?.get(assetId) : undefined;
  if (!library || !asset || asset.type !== "TRANSCRIPT" || isUrlSource(asset.source)) return null;
  return { library, asset };
}

/** False when no words are picked. */
export function copyPickedCaptionWords(world: World): boolean {
  const picked = captionWordSelection();
  if (!picked || picked.indices.size === 0 || !picked.entity.isAlive()) return false;
  const file = captionFile(world, picked.entity);
  if (!file) return false;

  const indices = new Set(picked.indices);
  wordsOnClipboard = true;
  void enqueueClipboard(async () => {
    const transcript = await resolveTranscript(file.asset);
    wordClipboard = copiedWords(transcript, indices);
    const text = wordClipboard.map((word) => word.text).join(" ");
    if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
  });
  return true;
}

function copiedWords(transcript: Transcript, indices: ReadonlySet<number>): TranscriptWord[] {
  return keepWords(transcript, indices).flatMap((segment) => segment.words.map((word) => ({ ...word })));
}

/** So the next paste is of elements again. */
export function clearCaptionWordClipboard(): void {
  wordsOnClipboard = false;
  wordClipboard = null;
}

export function cutPickedCaptionWords(world: World): boolean {
  const picked = captionWordSelection();
  if (!picked || picked.indices.size === 0 || !picked.entity.isAlive()) return false;
  const file = captionFile(world, picked.entity);
  if (!file) return false;

  const indices = new Set(picked.indices);
  wordsOnClipboard = true;
  clearCaptionWordSelection();
  void enqueueClipboard(async () => {
    const transcript = await resolveTranscript(file.asset);
    const words = copiedWords(transcript, indices);
    wordClipboard = words;
    const text = words.map((word) => word.text).join(" ");
    if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
    const next = removeWords(transcript, indices);
    getEditHistory(world).recordTranscript(file.asset.id, transcript, next);
    await persistCaptionTranscript(world, file.library, file.asset, next, "timeline");
  });
  return true;
}

/** After the picked word, or at the end when the caption layer is selected. False when not a caption-word paste. */
export function pasteCaptionWords(world: World): boolean {
  if (!wordsOnClipboard) return false;

  const picked = captionWordSelection();
  const pickedCaption = picked?.entity.isAlive() && isCaption(picked.entity) ? picked.entity : null;
  const selectedCaption = [...world.query(Selected)].find((entity) => isCaption(entity)) ?? null;
  const target = pickedCaption ?? selectedCaption;
  if (!target) return false;
  const file = captionFile(world, target);
  if (!file) return false;

  const after = pickedCaption && picked ? Math.max(...picked.indices) : undefined;
  void enqueueClipboard(async () => {
    const words = wordClipboard;
    if (!words || words.length === 0 || !target.isAlive()) return;
    const transcript = await resolveTranscript(file.asset);
    const listed = listWords(transcript);
    const afterPosition = after === undefined ? listed.length - 1 : Math.min(after, listed.length - 1);
    const next = insertWords(transcript, afterPosition, words);
    getEditHistory(world).recordTranscript(file.asset.id, transcript, next);
    await persistCaptionTranscript(world, file.library, file.asset, next, "timeline");
    if (!target.isAlive()) return;
    const start = afterPosition + 1;
    setCaptionWordSelection(target, words.map((_, index) => start + index));
  });
  return true;
}

/**
 * A copy of the caption saying only them, so masks, animations and effects are theirs alone. The words stay
 * in `caption`; taking them out is the caller's. Null when it could not be made.
 */
export async function moveWordsToLayer(
  world: World,
  library: AssetLibrary,
  caption: Entity,
  asset: Asset,
  transcript: Transcript,
  positions: ReadonlySet<number>,
): Promise<Entity | null> {
  const own = keepWords(transcript, positions);
  const words = own.flatMap((segment) => segment.words);
  if (words.length === 0) return null;

  const slash = asset.path.lastIndexOf("/");
  const stored = await library.store(new Blob([JSON.stringify(own)], { type: "application/json" }), {
    name: `${assetName(asset).replace(/\.[^.]+$/, "")} words.json`,
    folder: slash === -1 ? "" : asset.path.slice(0, slash),
  });
  await library.flush();
  setTranscriptDuration(stored, transcriptEnd(own));
  if (!caption.isAlive()) return null;

  // Read off the caption before the copy exists: it plays the same source from the same origin.
  const fps = world.get(FrameRate)?.value ?? 30;
  const computed = store(world, Computed);
  const origin = computed.origin[caption.id()] ?? 0;
  const from = computed.start[caption.id()] ?? 0;
  const to = computed.end[caption.id()] ?? 0;
  const clamp = (frame: number) => Math.min(to, Math.max(from, frame));
  const first = clamp(origin + secondsToFrames(Math.min(...words.map((word) => word.start)), fps));
  const last = clamp(origin + secondsToFrames(Math.max(...words.map((word) => word.end)), fps));

  clearCaptionWordSelection();
  const editor = getDocumentEditor(world);
  const [copy] = editor.duplicate(caption);
  if (!copy) return null;

  editor.editProperty(copy, "name", getNextName(world, t("Words")));
  editor.editProperty(copy, "src", stored.path);
  // A `seed` only asks for a transcription, which the copy has.
  if (copy.get(Host)?.props.seed !== undefined) editor.editProperty(copy, "seed", false);

  const parent = getTimelineOrigin(copy);
  editTime(world, copy, "end", last - parent);
  editTime(world, copy, "start", first - parent);
  editTime(world, copy, "sourceIn", getSourceFrameAt(caption, first));
  if (authoredTime(world, copy, "sourceOut") !== undefined) {
    editTime(world, copy, "sourceOut", getSourceFrameAt(caption, last));
  }
  return copy;
}

export function captionWritesSettled(assetId: string): Promise<void> {
  return (writes.get(assetId) ?? Promise.resolve()).catch(() => undefined);
}

/** So edits land in order. */
function queue(asset: Asset, write: () => Promise<void>): Promise<void> {
  const previous = writes.get(asset.id) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(write);
  writes.set(asset.id, run);
  return run;
}

async function persistCaptionTranscript(
  world: World,
  library: AssetLibrary,
  asset: Asset,
  transcript: Transcript,
  source: CaptionEditSource,
): Promise<void> {
  if (asset.type !== "TRANSCRIPT" || isUrlSource(asset.source)) {
    toast.error(t("Could not edit captions"), { description: t("This transcript is not a file in the project.") });
    return;
  }

  try {
    const blob = new Blob([JSON.stringify(transcript)], { type: "application/json" });
    await library.fs.write(asset.source, blob);
    forgetAssetFile(asset);
    const stat = await library.fs.stat(asset.source);
    library.update(asset, {
      mimeType: "application/json",
      ...(stat ? { stat } : {}),
    });
    await library.flush();

    setTranscriptDuration(asset, transcriptEnd(transcript));
    const reloads: Promise<void>[] = [];
    for (const entity of world.query(Caption)) {
      if (entity.get(AssetId)?.value !== asset.id) continue;
      recomputeEntityTimeRange(world, entity);
      bubbleTimeRangeUp(world, entity);
      const reload = source === "drag" ? undefined : entity.get(CaptionDecoderHandle)?.reload();
      if (reload) reloads.push(reload.catch(() => undefined));
    }
    await Promise.all(reloads);
    setTranscriptRevision((revision) => revision + 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : t("Could not save the caption.");
    toast.error(t("Could not edit captions"), { description: message });
  }
}
