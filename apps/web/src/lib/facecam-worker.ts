/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The person detector runs here: on the page it holds the main thread for seconds per clip.

import { RawImage, env, pipeline } from "@huggingface/transformers";

import type { FoundPerson } from "./facecam-find";

export type FacecamFrame = { data: Uint8ClampedArray; width: number; height: number };
export type FacecamRequest = { id: number; frames: FacecamFrame[] };
export type FacecamAnswer = { id: number; people?: FoundPerson[][]; error?: string };

type Detection = { score: number; label: string; box: { xmin: number; ymin: number; xmax: number; ymax: number } };
type Detector = (image: RawImage, options: object) => Promise<Detection[]>;

// transformers.js points ONNX Runtime at a CDN our CSP blocks; the build ships the files itself.
if (import.meta.env.PROD && env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = undefined as never;

let detector: Promise<Detector> | null = null;

self.onmessage = async (event: MessageEvent<FacecamRequest>) => {
  const { id, frames } = event.data;
  try {
    detector ??= pipeline("object-detection", "Xenova/yolos-tiny", { dtype: "q8" }) as unknown as Promise<Detector>;
    const run = await detector;
    const people: FoundPerson[][] = [];
    for (const frame of frames) {
      const found = await run(new RawImage(frame.data, frame.width, frame.height, 4), { threshold: 0.5, percentage: true });
      people.push(found.filter((entry) => entry.label === "person").map(({ score, box }) => ({ score, x: box.xmin, y: box.ymin, width: box.xmax - box.xmin, height: box.ymax - box.ymin })));
    }
    self.postMessage({ id, people } satisfies FacecamAnswer);
  } catch (error) {
    detector = null;
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies FacecamAnswer);
  }
};
