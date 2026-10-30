/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createMemo, createSignal, Show } from "solid-js";
import { RemoveBackgroundDialog } from "./remove-background-dialog";
import { useGenerationRecords } from "./use-generation-records";
import { useGenerateImage } from "./use-generate-image";
import { useGenerateVideo } from "./use-generate-video";
import { useGenerateVoice } from "./use-generate-voice";
import { useGenerateAudio } from "./use-generate-audio";
import { useAutoCaptions } from "./use-auto-captions";
import { useMediaSelection } from "./selection";
import { useTransforms } from "./use-transforms";
import { createDefaultConfig } from "./prompt-input";
import { toast } from "somoto";
import { useWorld } from "@plan.video/koota-solid";
import { useDerived, useSelection } from "@/engine/hooks";
import { undoEdit } from "@/engine/input/shortcuts";
import { bringRectIntoView } from "@/engine/camera";
import { fitSceneToClip, sceneFitFor } from "@/engine/scene-size";
import { getDocumentEditor } from "@/engine/editor";
import { t } from "@/lib/i18n";
import { cx } from "@/lib/cva";
import { useLayout } from "@/context/layout";
import { BAR_SLOT_CLASS } from "@/components/canvas/toolbar-slot";
import { isDesktop } from "@/projects";

import type { GenerationConfig } from "./schemas";
import type { Entity } from "koota";

/**
 * Generating takes the desktop app: the website has nothing answering
 * `/api/trpc`, so there it keeps to what runs in the browser (captions,
 * removing a background) and leaves out prompts, reruns and credits.
 */
const canGenerate = isDesktop();

interface ActionBarProps {
  openPromptInput?(config: GenerationConfig): void;
}

export function ActionBar(props: ActionBarProps) {
  const { toolbarSlot } = useLayout();
  const { imageNodes, videoNodes } = useMediaSelection();
  const { isOn, toggle } = useTransforms();
  const [cutoutFor, setCutoutFor] = createSignal<Entity | null>(null);

  const { generate: generateImage } = useGenerateImage();
  const { generate: generateVideo } = useGenerateVideo();
  const { generate: generateVoice } = useGenerateVoice();
  const { generate: generateAudio } = useGenerateAudio();
  const { generate: autoCaptions, canCaption } = useAutoCaptions();
  const { isGenerated, totalCredits, firstConfig } = useGenerationRecords();

  const world = useWorld();
  const { nodes } = useSelection();

  const isImage = createMemo(() => imageNodes().length > 0);
  const isVideo = createMemo(() => videoNodes().length > 0);

  /** One clip whose footage is another size than its scene: the scene can take the footage's. */
  const sceneFit = useDerived(
    () => {
      const selected = nodes();
      return selected.length === 1 ? sceneFitFor(world, selected[0]!) : null;
    },
    (a, b) => a?.scene === b?.scene && a?.width === b?.width && a?.height === b?.height,
  );

  const visible = createMemo(() => {
    return isImage() || canCaption() || !!sceneFit() || (canGenerate && isVideo() && isGenerated());
  });

  const fitScene = () => {
    const clip = nodes()[0];
    const fit = clip ? fitSceneToClip(world, clip) : null;
    if (!fit) return;
    // The scene, not the clip, so the size shown is the scene's, before and after an undo.
    getDocumentEditor(world).select(fit.scene);
    bringRectIntoView(world, fit);
    toast(t("Scene resized to {width} × {height}", { width: fit.width, height: fit.height }), {
      action: { label: t("Undo"), onClick: () => undoEdit(world) },
    });
  };

  const handleRerun = () => {
    const config = firstConfig();
    if (!config) {
      toast(t("No generation config found"), { description: t("This asset wasn't generated with a prompt.") });
      return;
    }

    const promise = (() => {
      switch (config.mode) {
        case "IMAGE":
          return generateImage(config);
        case "VIDEO":
          return generateVideo(config);
        case "VOICE":
          return generateVoice(config);
        case "AUDIO":
          return generateAudio(config);
      }
    })();

    promise.catch((err) => {
      toast(t("Rerun failed"), {
        description: err instanceof Error ? err.message : String(err),
      });
    });
  };

  /** One picture opens the preview; several, or taking it back off, act at once. */
  const removeBackground = () => {
    const images = imageNodes();
    if (images.length === 1 && !isOn("removeBackground")) setCutoutFor(images[0]!);
    else toggle("removeBackground");
  };

  const handleEditWithPrompt = () => {
    props.openPromptInput?.(createDefaultConfig("IMAGE"));
  };

  const handleMakeVideo = () => {
    props.openPromptInput?.(createDefaultConfig("VIDEO"));
  };

  const handleReuse = () => {
    const config = firstConfig();
    if (!config) {
      toast(t("No generation config found"), { description: t("This asset wasn't generated with a prompt.") });
      return;
    }
    props.openPromptInput?.(config);
  };

  return (
    <>
      <Show when={visible()}>
        <div class={cx("absolute z-10 rounded-lg p-1 bg-background border border-border-input flex gap-1 items-center", BAR_SLOT_CLASS[toolbarSlot()])}>
          <Show when={canCaption() && !isVideo()}>
            <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={autoCaptions}>
              <Icon name="captions" />
              {t("Auto-Captions")}
            </Button>
          </Show>
          <Show when={isImage()}>
            <div class="flex gap-1 items-center">
              <Button
                variant="ghost"
                class="gap-0 pl-0.5 text-muted-foreground"
                onClick={removeBackground}
              >
                <Icon name="ai-generate" />
                {isOn("removeBackground") ? t("Restore background") : t("Remove background")}
              </Button>
            </div>
            <Show when={canGenerate}>
              <Separator orientation="vertical" class="min-h-5" />
              <div class="flex gap-1 items-center">
                <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={handleEditWithPrompt}>
                  <Icon name="ai-generate" />
                  {t("Edit with prompt")}
                </Button>
                <Show when={isGenerated()}>
                  <DropdownMenu placement="right">
                    <DropdownMenuTrigger<typeof Button>
                      as={(triggerProps) => (
                        <Button {...triggerProps} variant="ghost" class="gap-0 pr-0.5 text-muted-foreground">
                          {t("More")}
                          <Icon name="chevron-down" />
                        </Button>
                      )}
                    />
                    <DropdownMenuPortal>
                      <DropdownMenuContent>
                        <div class="flex items-center gap-1 px-0 pr-2 h-7">
                          <Icon name="ai-generate" class="size-6 text-muted-foreground" />
                          <span class="text-xs text-muted-foreground">{t("{count, plural, other {# AI credits used}}", { count: totalCredits() })}</span>
                        </div>
                        <Separator class="my-1" />
                        <DropdownMenuGroup>
                          <DropdownMenuItem onSelect={handleMakeVideo}>
                            <Icon name="film-video-export" class="size-6 mr-2 text-foreground" />
                            {t("Make video")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={handleRerun}>
                            <Icon name="rerun" class="size-6 mr-2 text-foreground" />
                            {t("Rerun")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={handleReuse}>
                            <Icon name="reuse-settings" class="size-6 mr-2 text-foreground" />
                            {t("Reuse")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenuPortal>
                  </DropdownMenu>
                </Show>
              </div>
            </Show>
          </Show>
          <Show when={sceneFit()}>
            <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={fitScene}>
              <Icon name="media-fit-type" />
              {t("Fit scene to video")}
            </Button>
            <Show when={isVideo() && (canCaption() || (canGenerate && isGenerated()))}>
              <Separator orientation="vertical" class="min-h-5" />
            </Show>
          </Show>
          <Show when={isVideo() && (canCaption() || (canGenerate && isGenerated()))}>
            <div class="flex gap-1 items-center">
              <Show when={canCaption()}>
                <Button variant="ghost" class="gap-0 pl-0.5 text-muted-foreground" onClick={autoCaptions}>
                  <Icon name="captions" />
                  {t("Auto-Captions")}
                </Button>
              </Show>
              <Show when={canGenerate && isGenerated()}>
                <Show when={canCaption()}>
                  <Separator orientation="vertical" class="min-h-5" />
                </Show>
                <DropdownMenu placement="right">
                  <DropdownMenuTrigger<typeof Button>
                    as={(triggerProps) => (
                      <Button {...triggerProps} variant="ghost" class="gap-0 pr-0.5 text-muted-foreground">
                        {t("More")}
                        <Icon name="chevron-down" />
                      </Button>
                    )}
                  />
                  <DropdownMenuPortal>
                    <DropdownMenuContent>
                      <div class="flex items-center gap-1 px-0 pr-2 h-7">
                        <Icon name="ai-generate" class="size-6 text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">{t("{count, plural, other {# AI credits used}}", { count: totalCredits() })}</span>
                      </div>
                      <Separator class="my-1" />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={handleRerun}>
                          <Icon name="rerun" class="size-6 mr-2 text-foreground" />
                          {t("Rerun")}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenu>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={cutoutFor()} keyed>
        {(entity) => <RemoveBackgroundDialog entity={entity} onClose={() => setCutoutFor(null)} />}
      </Show>
    </>
  );
}
