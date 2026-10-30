/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { useWorld } from "@plan.video/koota-solid";
import { assetName } from "@plan.video/assets";
import { colorToHex, Computed, FrameRate, store } from "@plan.video/runtime";
import { toast } from "somoto";
import { Button } from "@/components/ui/button";
import { ControlRow } from "@/components/ui/control-group";
import { Icon } from "@/components/ui/icon";
import { PanelSection } from "@/components/ui/panel-section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FloatingInspector,
  FloatingInspectorContent,
  FloatingInspectorHeader,
  FloatingInspectorTitle,
} from "@/components/ui/floating-inspector";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ColorOpacityPicker } from "@/components/ui/color-opacity-picker";
import { useAuth } from "@/context/auth";
import { useEditor } from "@/engine/hooks";
import {
  DEFAULT_HIGHLIGHT,
  captionBrandStyle,
  loadCaptionStyles,
  saveCaptionBrandStyle,
  setBrandHighlight,
} from "@/lib/caption-brand";
import { applyCaptionLook, readCaptionLook } from "@/lib/caption-look";
import {
  TOOL_FAILURES,
  TRANSLATE_LANGUAGES,
  addEmoji,
  hasEmoji,
  highlightWords,
  languageLabel,
  pickKeywords,
  stripEmoji,
  transcriptToSrt,
  translateTranscript,
  type CaptionTask,
} from "@/lib/caption-tools";
import { intlLocale, t } from "@/lib/i18n";
import { downloadObject } from "@/utils/browser";
import { useCaptionTranscript } from "./use-caption-transcript";

import type { Transcript } from "@plan.video/assets";
import type { Entity } from "koota";

type CaptionToolsProps = {
  selection: Entity[];
};

type LanguageOption = { code: string; label: string };

export function CaptionTools(props: CaptionToolsProps) {
  const world = useWorld();
  const editor = useEditor();
  const auth = useAuth();
  const entity = () => props.selection[0]!;
  const { asset, transcript, loaded, commit } = useCaptionTranscript(entity);

  createEffect(() => loadCaptionStyles(auth.ownerId()));

  let anchorRef!: HTMLDivElement;
  const [busy, setBusy] = createSignal<CaptionTask | null>(null);
  const [highlight, setHighlight] = createSignal(captionBrandStyle()?.highlight ?? DEFAULT_HIGHLIGHT);
  const [picking, setPicking] = createSignal(false);
  // The brand style loads after the panel opens, and another tab can change it.
  createEffect(() => {
    const saved = captionBrandStyle()?.highlight;
    if (saved !== undefined) setHighlight(saved);
  });

  const languages = createMemo<LanguageOption[]>(() => {
    const locale = intlLocale() ?? navigator.language;
    return TRANSLATE_LANGUAGES.map((code) => ({ code, label: languageLabel(code, locale) }));
  });
  const [language, setLanguage] = createSignal<string>("es");
  const languageOption = () => languages().find((option) => option.code === language());

  const words = () => transcript() ?? [];
  const ready = () => loaded() && words().some((segment) => segment.words.length > 0) && busy() === null;

  const run = async (task: CaptionTask, work: (current: Transcript) => Promise<Transcript>) => {
    const current = transcript();
    if (!current || busy()) return;
    setBusy(task);
    try {
      const next = await work(current);
      // The words changed meanwhile: what came back was worked out on others.
      if (transcript() !== current) return;
      commit(next, true);
    } catch (error) {
      toast.error(t(TOOL_FAILURES[task]), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const highlightKeywords = () =>
    void run("keywords", async (current) => {
      const color = highlight();
      // Run again, it moves the highlights rather than adding to them.
      return highlightWords(current, await pickKeywords(current), color, color);
    });

  const changeHighlight = (next: number) => {
    setHighlight(next);
    setBrandHighlight(next);
  };

  const saveBrand = () => {
    const look = readCaptionLook(world, entity());
    if (!look || !saveCaptionBrandStyle(look, highlight())) {
      toast.error(t("Could not save the brand style"));
      return;
    }
    toast.success(t("Brand style saved"), { description: t("New captions start with it.") });
  };

  const applyBrand = () => {
    const style = captionBrandStyle();
    if (!style) return;
    applyCaptionLook(world, editor, entity(), style);
    setHighlight(style.highlight);
  };

  const downloadSrt = () => {
    const caption = entity();
    const fps = world.get(FrameRate)?.value ?? 30;
    const computed = store(world, Computed);
    const origin = computed.origin[caption.id()] ?? 0;
    const from = computed.start[caption.id()] ?? 0;
    const to = computed.end[caption.id()] ?? Infinity;
    const srt = transcriptToSrt(words(), (time) => {
      const frame = origin + time * fps;
      return frame < from || frame > to ? null : frame / fps;
    });
    if (!srt) {
      toast.error(t("There are no words on screen to export"));
      return;
    }
    const file = asset();
    const name = file ? assetName(file).replace(/\.[^.]+$/, "") : "captions";
    void downloadObject(new Blob([srt], { type: "application/x-subrip" }), `${name}.srt`);
  };

  const working = (task: CaptionTask, label: string) => (busy() === task ? t("Working…") : label);

  return (
    <Show when={asset()}>
      <PanelSection title={t("Caption tools")} ref={anchorRef}>
        <ControlRow label={t("Brand")} contentClass="flex gap-2">
          <Button
            variant="secondary"
            class="flex-1"
            title={t("Keep this caption's look for this workspace's captions")}
            onClick={saveBrand}
          >
            {captionBrandStyle() ? t("Update") : t("Save")}
          </Button>
          <Show when={captionBrandStyle()}>
            <Button variant="secondary" class="flex-1" title={t("Give this caption the saved look")} onClick={applyBrand}>
              {t("Apply")}
            </Button>
          </Show>
        </ControlRow>

        <ControlRow label={t("Emoji")} contentClass="flex gap-2">
          <Button
            variant="secondary"
            class="flex-1"
            disabled={!ready()}
            onClick={() => void run("emoji", addEmoji)}
          >
            {working("emoji", t("Add emoji"))}
          </Button>
          <Show when={hasEmoji(words())}>
            <Button variant="ghost" disabled={busy() !== null} onClick={() => commit(stripEmoji(words()), true)}>
              {t("Remove")}
            </Button>
          </Show>
        </ControlRow>

        <ControlRow label={t("Keywords")} contentClass="flex gap-2">
          <button
            type="button"
            class="size-7 shrink-0 rounded-md border border-border-input focus-ring"
            style={{ "background-color": colorToHex(highlight()) }}
            title={t("Highlight color")}
            aria-label={t("Highlight color")}
            onClick={() => setPicking((open) => !open)}
          />
          <Button variant="secondary" class="flex-1" disabled={!ready()} onClick={highlightKeywords}>
            {working("keywords", t({ message: "Highlight", context: "verb: color the keywords" }))}
          </Button>
        </ControlRow>

        <ControlRow label={t("Translate")} contentClass="grid grid-cols-2 gap-2">
          <Select<LanguageOption>
            value={languageOption()}
            onChange={(next) => next && setLanguage(next.code)}
            options={languages()}
            optionValue="code"
            optionTextValue="label"
            itemComponent={(itemProps) => <SelectItem item={itemProps.item}>{itemProps.item.rawValue.label}</SelectItem>}
          >
            <SelectTrigger class="w-full min-w-0">
              <SelectValue<LanguageOption> class="truncate text-xs">
                {(state) => state.selectedOption()?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectPortal>
              <SelectContent class="max-h-72 overflow-y-auto" />
            </SelectPortal>
          </Select>
          <Button
            variant="secondary"
            disabled={!ready()}
            onClick={() => void run("translate", (current) => translateTranscript(current, language()))}
          >
            {working("translate", t("Translate"))}
          </Button>
        </ControlRow>

        <ControlRow label={t("Subtitles")}>
          <Button variant="secondary" class="w-full gap-1.5" disabled={!loaded()} onClick={downloadSrt}>
            <Icon name="download" />
            {t("Download .srt")}
          </Button>
        </ControlRow>

        <Show when={picking()}>
          <FloatingInspector open anchorRef={anchorRef}>
            <FloatingInspectorHeader>
              <FloatingInspectorTitle>{t("Highlight color")}</FloatingInspectorTitle>
              <div class="ml-auto">
                <Tooltip>
                  <TooltipTrigger
                    as={Button}
                    size="icon"
                    variant="ghost"
                    class="text-muted-foreground"
                    onClick={() => setPicking(false)}
                  >
                    <Icon name="close-remove" class="size-6" />
                  </TooltipTrigger>
                  <TooltipContent>{t("Close")}</TooltipContent>
                </Tooltip>
              </div>
            </FloatingInspectorHeader>
            <FloatingInspectorContent class="p-0">
              <ColorOpacityPicker color={highlight()} opacity={1} onColorChange={changeHighlight} withoutOpacity />
            </FloatingInspectorContent>
          </FloatingInspector>
        </Show>
      </PanelSection>
    </Show>
  );
}
