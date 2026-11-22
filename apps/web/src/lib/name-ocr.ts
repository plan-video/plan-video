/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The build ships Tesseract's worker, engine and English model itself (the model by ocr-model.ts): our CSP blocks
// the CDN it would fetch them from, and a self-hosted copy shouldn't depend on one.
import workerUrl from "tesseract.js/dist/worker.min.js?url";
import coreUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";

import type { Rgba } from "./kill-read";

export type ReadName = { text: string; confidence: number };

export type NameReader = {
  read: (strip: Rgba) => Promise<ReadName>;
  close: () => Promise<void>;
};

/** A Valorant name is at most 16 characters; stray strokes at either end are the pictures beside it. */
export function cleanName(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/^[\s|!_.,:;'"`~-]+|[\s|!_.,:;'"`~-]+$/g, "")
    .slice(0, 16);
}

/** Reads one line of text at a time. Several megabytes on first use, so only made when names are wanted. */
export async function createNameReader(): Promise<NameReader> {
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: workerUrl,
    corePath: coreUrl,
    langPath: new URL(`${import.meta.env.BASE_URL}ocr`, location.href).href,
    workerBlobURL: false,
    cacheMethod: "none",
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  return {
    async read(strip) {
      canvas.width = strip.width;
      canvas.height = strip.height;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(strip.data), strip.width, strip.height), 0, 0);
      const { data } = await worker.recognize(canvas);
      return { text: cleanName(data.text), confidence: data.confidence };
    },
    close: () => worker.terminate().then(() => undefined),
  };
}
