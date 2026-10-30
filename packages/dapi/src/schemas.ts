/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { z } from "zod";
import { NonNegativeTime, TIME_FORMS } from "./time";

export const NodeId = z
  .string()
  .min(1)
  .describe("node id from the project's JSX, or `file:id` (`intro.tsx:hero`) when two files use the same id");

export const SceneId = z
  .string()
  .min(1)
  .describe("scene id from the project's JSX, or `file:id` (`intro.tsx:main`) when two files use the same id");

export const AssetPath = z
  .string()
  .min(1)
  .describe(
    "absolute file path or URL (works with or without an open project), or a library path like `b-roll/clip.mp4` (needs an open project)",
  );

/** Beyond this the cells get too small to be worth the tokens; use `media_filmstrip`. */
export const MAX_FRAMES_PER_SHEET = 12;

export const Bytes = z.custom<Uint8Array>((value) => value instanceof Uint8Array, "expected bytes (a Uint8Array)");

/** A single frame stamped with its timecode, or a contact sheet stamped with its span (`0f-08s10f`). */
export const TimecodedImage = z.object({
  timecode: z.string(),
  png: Bytes,
});

export const ImageRef = z.object({
  timecode: z.string(),
  path: z.string().describe("absolute path of the PNG"),
});

export const outputDirField = z
  .string()
  .optional()
  .describe("absolute directory to write the PNGs into (default: a fresh directory under the system temp dir)");

/** `checkSheetOptions` rejects `perSheet` outside sheets, so call it on any object that spreads these fields. */
export const sheetFields = {
  separate: z
    .boolean()
    .optional()
    .describe("write one image per position instead of merging them into contact sheets of up to 12 cells, each labelled with its timecode"),
  perSheet: z
    .int()
    .min(1)
    .max(MAX_FRAMES_PER_SHEET)
    .optional()
    .describe("positions per contact sheet, 1-12; fewer means a larger cell each (default: as many as fit)"),
};

export function checkSheetOptions(
  value: { separate?: boolean | undefined; perSheet?: number | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.perSheet !== undefined && value.separate) {
    ctx.addIssue({
      code: "custom",
      path: ["perSheet"],
      message: "perSheet lays out contact sheets; it cannot be combined with separate: true",
    });
  }
}

/** A `[start, end)` window in seconds; both optional, and start must precede end. */
export const windowFields = {
  start: NonNegativeTime.optional().describe(`start of the window — ${TIME_FORMS} (default: 0)`),
  end: NonNegativeTime.optional().describe(`end of the window — ${TIME_FORMS} (default: asset duration)`),
};

export function checkWindow(
  value: { start?: number | undefined; end?: number | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.start !== undefined && value.end !== undefined && value.start >= value.end) {
    ctx.addIssue({
      code: "custom",
      path: ["end"],
      message: `start (${value.start}s) must be less than end (${value.end}s)`,
    });
  }
}

export const LogLevel = z.enum(["debug", "info", "warning", "error"]);

export const LogEntry = z.object({
  ts: z.number().describe("unix time, milliseconds"),
  level: LogLevel,
  message: z.string(),
  source: z.string().describe("file:line the entry came from, or empty"),
});
