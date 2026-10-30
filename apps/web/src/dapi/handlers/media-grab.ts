/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { encodePng } from "@plan.video/encoder";
import { formatTimecode, getAssetFile } from "@plan.video/runtime";
import { DapiError } from "@plan.video/dapi";
import { pickInformativeTimes } from "../lib/frame-triage";
import { requireAssetType, resolveAsset } from "../lib/assets";
import { SheetCollector } from "../lib/sheets";

import type { FrameQuality, TimecodedImage } from "@plan.video/dapi";
import type { ToolHandler } from "../handler";

// Pixel budget per frame, aspect ratio kept. 0 means native resolution;
// `small` stays small enough for vision models.
const FRAME_QUALITY_BUDGETS: Record<FrameQuality, number> = {
  small: 384 * 384,
  medium: 768 * 768,
  large: 1536 * 1536,
  fullres: 0,
};

const AUTO_MAX_FRAMES = 30;

export const mediaGrab: ToolHandler<"media_grab"> = async (args, ctx) => {
  const { times, count, start, end, quality, auto, separate, perSheet } = args;
  const asset = await resolveAsset(ctx, args.path);
  requireAssetType(asset, ["VIDEO"], "a video");

  const from = Math.min(Math.max(start ?? 0, 0), asset.duration);
  const to = Math.min(Math.max(end ?? asset.duration, from), asset.duration);
  let requested: number[] = [];
  if (auto || count !== undefined) {
    if (to <= from) {
      throw new DapiError(
        "invalid-input",
        `The requested window is empty; start (${from.toFixed(2)}s) is at or past end (${to.toFixed(2)}s).`,
      );
    }
    if (!auto && count !== undefined) {
      const interval = (to - from) / count;
      requested = Array.from({ length: count }, (_, i) => from + i * interval);
    }
  } else {
    requested = (times && times.length ? times : [0]).map((t) => resolveTime(t, asset.duration));
  }

  const budget = FRAME_QUALITY_BUDGETS[quality ?? (separate ? "small" : "fullres")];

  const blob = await getAssetFile(asset);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new DapiError("wrong-kind", `Asset ${asset.id} has no video track.`);

    // Track timestamps may not start at 0; offset content time by the first.
    const firstTimestamp = (await track.getFirstTimestamp()) ?? 0;

    if (auto) {
      const picked = await pickInformativeTimes(track, {
        from: firstTimestamp + from,
        to: firstTimestamp + to,
        max: count ?? AUTO_MAX_FRAMES,
      });
      requested = picked.map((t) => Math.max(0, t - firstTimestamp));
    }

    const displayWidth = await track.getDisplayWidth();
    const displayHeight = await track.getDisplayHeight();
    let sourceWidth = displayWidth;
    let sourceHeight = displayHeight;
    if (budget > 0 && displayWidth * displayHeight > budget) {
      const scale = Math.sqrt(budget / (displayWidth * displayHeight));
      sourceWidth = Math.max(1, Math.round(displayWidth * scale));
      sourceHeight = Math.max(1, Math.round(displayHeight * scale));
    }

    // The largest cell across the sheets sets the decode size, so no frame is
    // decoded bigger than it will be drawn.
    const sheets = separate ? undefined : new SheetCollector(requested.length, { width: sourceWidth, height: sourceHeight }, perSheet);
    const width = sheets ? Math.min(sourceWidth, sheets.cellWidth) : sourceWidth;

    // Decode in ascending order (the sink's fast path), then restore the requested order.
    const ordered = requested.map((time, index) => ({ time, index })).sort((a, b) => a.time - b.time);

    // No pool: each yielded canvas is fresh, so encoding it can't race the
    // generator's read-ahead reusing a pooled canvas.
    const sink = new CanvasSink(track, width < displayWidth ? { width } : undefined);
    const frames: TimecodedImage[] = new Array(requested.length);

    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(ordered.map(({ time }) => firstTimestamp + time))) {
      const { time, index } = ordered[i++]!;
      if (!wrapped) throw new DapiError("not-found", `No frame found at ${time}s.`);
      const timecode = formatTimecode(time, asset.frameRate);
      if (sheets) await sheets.add(index, { at: time, timecode, image: wrapped.canvas });
      else frames[index] = { timecode, png: await encodePng(wrapped.canvas) };
    }

    return sheets ? sheets.result() : frames;
  } finally {
    input.dispose();
  }
};

/** A negative time counts back from the end: -1 is one second before it, -1f one frame. */
function resolveTime(t: number, duration: number): number {
  if (t >= 0) {
    if (t > duration) {
      throw new DapiError("invalid-input", `time ${t}s is past the asset's duration (${duration.toFixed(2)}s).`);
    }
    return t;
  }
  const resolved = duration + t;
  if (resolved < 0) {
    throw new DapiError("invalid-input", `time ${t} counts past the start of the clip (duration ${duration.toFixed(2)}s).`);
  }
  return resolved;
}
