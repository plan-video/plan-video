/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";
import { Caption, getActiveEntity, getSceneAncestor, isScene } from "@plan.video/runtime";

import { SidebarTabs } from "@/agent-chat";
import { CaptionTemplateLook, captionLoopSeconds, captionStillSeconds } from "@/components/editor/caption-template-look";
import { useAutoCaptions } from "@/components/genai/use-auto-captions";
import { CAPTION_PRESET_OPTIONS, captionPresetOption } from "@/components/sidebar-right/inspector/caption-types";
import { Button } from "@/components/ui/button";
import { PresetGrid, PresetTile } from "@/components/ui/preset-tile";
import { useDerived, useEditor } from "@/engine/hooks";
import { CAPTION_TEMPLATES, captionTemplateOf, type CaptionTemplate } from "@/lib/caption-templates";
import { t } from "@/lib/i18n";
import { TEXT_STYLES } from "@/engine/text-presets";

import type { Entity } from "koota";

// Kept while the tab is closed, so the next Generate uses the style picked before.
const [picked, setPicked] = createSignal<CaptionTemplate>(CAPTION_TEMPLATES[0]!);

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One clock for every tile, so they play in step; only while the tab is open. */
function useLoopClock(loop: () => number, still: () => number) {
  const [time, setTime] = createSignal(still());
  let begun = 0;
  let frame = requestAnimationFrame(function tick(now) {
    if (!begun) begun = now;
    setTime(((now - begun) / 1000) % loop());
    frame = requestAnimationFrame(tick);
  });
  onCleanup(() => cancelAnimationFrame(frame));
  return time;
}

function templateName(template: CaptionTemplate): string {
  const look = template.look ? TEXT_STYLES.find((style) => style.id === template.look) : undefined;
  const motion = CAPTION_PRESET_OPTIONS.find((option) => option.name === template.preset);
  return [look?.name, motion?.label].filter((name) => name !== undefined).map((name) => t(name)).join(" · ");
}

export function CaptionsPanel() {
  const world = useWorld();
  const editor = useEditor();
  const { captionScene } = useAutoCaptions();

  const scene = useDerived(() => {
    const active = getActiveEntity(world);
    if (!active) return null;
    return isScene(active) ? active : getSceneAncestor(active);
  });

  const caption = useDerived((): Entity | null => {
    const active = scene();
    if (!active) return null;
    for (const entity of world.query(Caption)) {
      if (getSceneAncestor(entity) === active) return entity;
    }
    return null;
  });

  const worn = useDerived(() => {
    const entity = caption();
    const data = entity?.get(Caption);
    if (!data) return null;
    return captionTemplateOf(data.look, captionPresetOption(data.type).name);
  });

  const selected = () => (caption() ? worn() : picked());

  const words = createMemo(() => t("Pick a style").split(/\s+/).filter(Boolean));
  const loop = () => captionLoopSeconds(words().length);
  const still = () => captionStillSeconds(words().length);
  // Reduced motion: nothing plays by itself, but a pointed-at tile plays on a clock of its own.
  const reduced = reducedMotion();
  const time = reduced ? still : useLoopClock(loop, still);

  const choose = (template: CaptionTemplate) => {
    setPicked(template);
    const entity = caption();
    if (!entity) return;
    // One task, so one undo step.
    editor.editProperty(entity, "look", template.look ?? false);
    editor.editProperty(entity, "preset", template.preset === "classic" ? false : template.preset);
    editor.editProperty(entity, "colors", template.colors ?? false);
  };

  const generate = () => {
    const active = scene();
    if (!active) {
      toast(t("Open a scene first"));
      return;
    }
    captionScene(active, picked());
  };

  return (
    <div class="relative flex min-h-0 flex-1 flex-col text-sm text-foreground">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-4">
        <div class="flex min-w-0 flex-1 items-center">
          <SidebarTabs />
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="p-4">
          <PresetGrid>
            <For each={CAPTION_TEMPLATES}>
              {(template) => {
                // Made once: the tile plays on the panel's clock, not on hover.
                const look = <CaptionTemplateLook template={template} words={words()} time={time} />;
                return (
                  <PresetTile
                    title={templateName(template)}
                    aspect="16 / 10"
                    selected={selected() === template}
                    onClick={() => choose(template)}
                  >
                    {(playing) => {
                      if (!reduced) return look;
                      const clock = playing ? useLoopClock(loop, still) : still;
                      return <CaptionTemplateLook template={template} words={words()} time={clock} />;
                    }}
                  </PresetTile>
                );
              }}
            </For>
          </PresetGrid>
        </div>
      </div>

      <div class="flex shrink-0 flex-col gap-2 border-t border-border p-3">
        <Show
          when={caption()}
          fallback={
            <Button class="w-full" onClick={generate}>
              {t("Generate captions")}
            </Button>
          }
        >
          {(current) => (
            <div class="grid grid-cols-2 gap-2">
              <Button variant="secondary" class="w-full" onClick={generate}>
                {t("Redo captions")}
              </Button>
              <Button variant="secondary" class="w-full" onClick={() => editor.remove(current())}>
                {t("Remove captions")}
              </Button>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
