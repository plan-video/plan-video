/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createReadStream, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

/** Where the app finds it; Tesseract asks for `<folder>/eng.traineddata.gz` by that exact name. */
export const OCR_MODEL_PATH = "ocr/eng.traineddata.gz";

/**
 * The English text model the killfeed reads player names with, served at a fixed name from the package rather than
 * a CDN: an imported asset gets a hashed name Tesseract can't ask for.
 */
export function ocrModelPlugin(): Plugin {
  const file = createRequire(import.meta.url).resolve("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz");
  return {
    name: "ocr-model",
    configureServer(server) {
      server.middlewares.use(`/${OCR_MODEL_PATH}`, (_request, response) => {
        response.setHeader("Content-Type", "application/octet-stream");
        createReadStream(file).pipe(response);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: OCR_MODEL_PATH, source: readFileSync(file) });
    },
  };
}
