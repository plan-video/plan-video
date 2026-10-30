/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { generate } from "@plan.video/jsx";
import { ImagePaint, Rect } from "@plan.video/reconciler";
import { Library } from "@plan.video/runtime";
import { useWorld } from "@plan.video/koota-solid";
import { useEditor } from "@/engine/hooks";
import { ASPECT_RATIO_DIMENSIONS } from "./config";
import { insertGenerated, randomSeed } from "./insert";

import type { ImageGenerationConfig } from "./schemas";

export function useGenerateImage() {
  const world = useWorld();
  const editor = useEditor();

  const run = async (config: ImageGenerationConfig) => {
    const library = world.get(Library);

    // By library path: durable in the file. Ids that no longer name a library asset are dropped.
    const refs = (config.imageRefIds ?? [])
      .map((id) => library?.get(id)?.path)
      .filter((path): path is string => path !== undefined);

    const dims = ASPECT_RATIO_DIMENSIONS[config.aspectRatio] ?? { width: 1920, height: 1080 };

    // One seed per variant, so a batch is separate takes rather than one asset shown four times.
    const sources = Array.from({ length: config.count }, () => generate.image({
      prompt: config.prompt,
      model: config.model,
      aspectRatio: config.aspectRatio,
      ...(refs.length ? { refs } : {}),
      seed: randomSeed(),
    }));

    insertGenerated(world, editor, dims, (box, index) => (
      <Rect keepAspectRatio x={box.x} y={box.y} width={box.width} height={box.height}>
        <ImagePaint src={sources[index]} />
      </Rect>
    ), config.count, sources);
  };

  return { generate: run } as const;
}
