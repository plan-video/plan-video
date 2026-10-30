/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createMemo } from "solid-js";
import { useCamera } from "@/engine";
import { dropTarget } from "@/engine/scene-drop";

/** Must match hud-system's ACCENT. */
const ACCENT = "#2f6ff0";

export function SceneDropOverlay() {
  const camera = useCamera();

  const boxes = createMemo(() => {
    const target = dropTarget();
    if (!target) return null;
    const { a = 1, d = 1, e = 0, f = 0 } = camera() ?? {};
    const { bounds, size, fit } = target;
    const scene = { left: e + a * bounds.x, top: f + d * bounds.y, width: a * bounds.width, height: d * bounds.height };
    const sx = size.width > 0 ? scene.width / size.width : 0;
    const sy = size.height > 0 ? scene.height / size.height : 0;
    return {
      scene,
      fit: fit && { left: fit.x * sx, top: fit.y * sy, width: fit.width * sx, height: fit.height * sy },
    };
  });

  const px = (value: number) => `${value}px`;

  return (
    <div class="pointer-events-none absolute inset-0 z-3 overflow-hidden">
      <Show when={dropTarget()?.scene} keyed>
        {(_scene) => (
          <Show when={boxes()}>
            {(box) => (
              <div
                class="absolute rounded-[2px]"
                style={{
                  left: px(box().scene.left),
                  top: px(box().scene.top),
                  width: px(box().scene.width),
                  height: px(box().scene.height),
                  "box-shadow": `0 0 0 2px ${ACCENT}`,
                  "background-color": `color-mix(in srgb, ${ACCENT} 10%, transparent)`,
                }}
              >
                <Show when={box().fit}>
                  {(fit) => (
                    <div
                      class="absolute"
                      style={{
                        left: px(fit().left),
                        top: px(fit().top),
                        width: px(fit().width),
                        height: px(fit().height),
                        outline: `1.5px dashed ${ACCENT}`,
                        "outline-offset": "-1.5px",
                      }}
                    />
                  )}
                </Show>
              </div>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
