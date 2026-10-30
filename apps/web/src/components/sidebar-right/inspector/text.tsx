/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createMemo, createResource, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { ControlRow } from '@/components/ui/control-group';
import { Icon } from '@/components/ui/icon';
import { PanelSection } from '@/components/ui/panel-section';
import { SegmentedIconTabs } from '@/components/ui/segmented-icon-tabs';
import {
  Select,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectPortal,
} from '@/components/ui/select';
import { ControlledTextField } from '@/components/ui/text-field';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cx } from '@/lib/cva';
import { msg, t } from '@/lib/i18n';
import { settled } from '@/utils/signal';
import { toast } from 'somoto';
import { usePermissionState } from '@/hooks/use-permission';
import { useHas, useTrait, useWorld } from '@plan.video/koota-solid';
import { Animation as AnimationElement } from '@plan.video/reconciler';
import {
  Animation,
  AnimationPhase,
  AnimationType,
  Cache,
  Chars,
  Computed,
  FONT_WEIGHTS,
  Size,
  TextAlign,
  TextBaseline,
  TextStyle,
  Tool,
  ToolType,
  WebFonts,
  getWebFonts,
  isCaption,
  isText,
  loadWebFont,
} from '@plan.video/runtime';
import { getLocalFonts } from '@/engine/fonts';
import { useDerived, useEditor, useTool } from '@/engine/hooks';
import { removeKeyframeTrack, syncKeyframe } from '@/engine/keyframes';
import { TEXT_MOTION_PRESETS } from './animation-types';
import { useMixed } from './word-mix';

import type { Entity } from 'koota';

type TextPanelProps = {
  selection: Entity[];
  /** Styling caption words: only what a word can set on its own shows. */
  words?: boolean;
};

const RESIZE_MODE_ITEMS = [
  {
    value: 'auto' as const,
    label: msg('Auto width'),
    icon: 'grow-auto-width',
  },
  {
    value: 'fixed' as const,
    label: msg('Fixed size'),
    icon: 'grow-fixed-size',
  },
] as const;

/**
 * Typography: what a `<text>` says and how its glyphs are set. Every value is
 * a prop of the element (`fontFamily`, `fontSize`, `fontWeight`, `leading`,
 * `letterSpacing`, `textAlign`, `textBaseline`) except the content itself,
 * which is the element's children and goes through `editor.editText`.
 *
 * Which font a text is set in is written out plainly; the modifiers around it
 * (leading, spacing, alignment) are unset at their default, so a file says
 * only what its text does differently. Hovering a family or a weight previews
 * it on the trait alone, which the picker undoes on close: a preview is not
 * an edit, and nothing about it belongs in the file.
 *
 * A text with no box sizes itself to its glyphs, so "Grow" is `width`/`height`
 * being authored at all rather than a prop of its own.
 */
export function TextPanel(props: TextPanelProps) {
  const world = useWorld();
  const editor = useEditor();
  const tool = useTool();
  const mixed = useMixed();
  const entity = () => props.selection[0]!;

  const style = useTrait(entity, TextStyle);
  const chars = useTrait(entity, Chars);
  const hasSize = useHas(entity, Size);

  const [selectedFamily, setSelectedFamily] = createSignal(entity().get(TextStyle)?.fontFamily ?? 'Inter');
  const [selectedWeight, setSelectedWeight] = createSignal(entity().get(TextStyle)?.fontWeight ?? '400');
  /** A hovered family or weight is on the trait for the canvas to show, not chosen. */
  let previewing = false;

  // The pickers follow the text's own font as it changes from elsewhere (a
  // caption's look, an undo, an agent), but not a font only being previewed.
  createEffect(() => {
    const family = style()?.fontFamily ?? 'Inter';
    const weight = style()?.fontWeight ?? '400';
    if (previewing) return;
    setSelectedFamily(family);
    setSelectedWeight(weight);
  });

  const fontSize = () => style()?.fontSize ?? 16;
  const leading = () => style()?.leading ?? 1;
  const letterSpacing = () => style()?.letterSpacing ?? 0;
  const textAlign = () => style()?.textAlign ?? TextAlign.LEFT;
  const textBaseline = () => style()?.textBaseline ?? TextBaseline.TOP;

  // The box a switch to "fixed" pins, which the glyphs are sizing right now.
  const width = useDerived(() => entity().get(Computed)?.width ?? 0);
  const height = useDerived(() => entity().get(Computed)?.height ?? 0);

  const [availableWeights, setAvailableWeights] = createSignal<string[]>([]);
  // A closing list still hears the pointer pass over it: only an open one previews.
  let weightsOpen = false;

  const resizeMode = createMemo(() => (hasSize() ? 'fixed' : 'auto'));
  const textSelected = createMemo(() => !props.words && isText(entity()) && !isCaption(entity()));

  const incomingMotion = useDerived(() => {
    const list = entity().get(Cache)?.animations ?? [];
    return list.find((animation) => animation.get(Animation)?.phase !== AnimationPhase.OUT);
  });
  const motionPreset = createMemo(() => {
    const type = incomingMotion()?.get(Animation)?.type;
    if (type === AnimationType.POP) return 'pop';
    if (type === AnimationType.BOUNCE) return 'bounce';
    return undefined;
  });

  /**
   * Pop / bounce on a caption play on each spoken word, not the whole
   * block. On a picked word they stay on that word alone.
   */
  const applyMotion = (name: (typeof TEXT_MOTION_PRESETS)[number]['name']) => {
    const preset = TEXT_MOTION_PRESETS.find((option) => option.name === name);
    if (!preset) return;

    const incoming = (entity().get(Cache)?.animations ?? []).filter(
      (animation) => animation.get(Animation)?.phase !== AnimationPhase.OUT,
    );
    const already = motionPreset() === name && incoming.length === 1;
    if (incoming.length) editor.remove(incoming);
    if (already) return;

    editor.insertElement(entity(), () => (
      <AnimationElement type={preset.name} duration={preset.duration} />
    ));
  };

  const weightOptions = createMemo(() => {
    const weights = availableWeights();
    if (!weights.length) return ALL_FONT_WEIGHTS;
    return ALL_FONT_WEIGHTS.filter(w => weights.includes(w.value));
  });

  /** Writes a family or weight to the trait alone, for the picker to show. */
  const previewFont = (params: { fontFamily?: string; fontWeight?: string }) => {
    // Putting the chosen font back ends the preview.
    previewing =
      (params.fontFamily !== undefined && params.fontFamily !== selectedFamily()) ||
      (params.fontWeight !== undefined && params.fontWeight !== selectedWeight());
    entity().add(TextStyle);
    entity().set(TextStyle, params);
  };

  const handleFontFamilyChange = (family: string) => {
    previewing = false;
    setSelectedFamily(family);
    editor.editProperty(entity(), 'fontFamily', family);

    if (family in WebFonts) {
      void loadWebFont(world, family as keyof typeof WebFonts);
    }
  };

  const handleFontWeightChange = (weight: string) => {
    previewing = false;
    if (weight === selectedWeight()) return;

    setSelectedWeight(weight);
    // Authored as a CSS number, which is the only spelling the prop takes
    // besides the "normal"/"bold" keywords the panel does not offer.
    editor.editProperty(entity(), 'fontWeight', Number(weight));
  };

  const handleResizeModeChange = (mode: 'auto' | 'fixed') => {
    if (mode === 'fixed') {
      // Pinned at what the glyphs came to, so the switch changes nothing yet.
      const [w, h] = [Math.round(width()), Math.round(height())];
      syncKeyframe(world, editor, entity(), 'width', w);
      editor.editProperty(entity(), 'width', w);
      syncKeyframe(world, editor, entity(), 'height', h);
      editor.editProperty(entity(), 'height', h);
      return;
    }

    // A box the glyphs decide is no box to keyframe.
    removeKeyframeTrack(world, editor, entity(), 'width');
    removeKeyframeTrack(world, editor, entity(), 'height');
    editor.editProperty(entity(), 'width', false);
    editor.editProperty(entity(), 'height', false);
  };

  return (
    <PanelSection title={t("Typography")}>
      <Show when={textSelected()}>
        <ControlRow label={t("Content")} contentClass="flex flex-col">
          <GrowingTextArea
            value={chars()?.value ?? ''}
            maxRows={8}
            onInput={(v) => editor.editText(entity(), v)}
            focused={tool() === ToolType.TEXT_EDIT}
            onFocus={() => world.set(Tool, { value: ToolType.TEXT_EDIT })}
            onBlur={() => world.set(Tool, { value: ToolType.MOVE })}
          />
        </ControlRow>
      </Show>

      <ControlRow label={t("Font")}>
        <FontDropdown
          family={selectedFamily()}
          label={mixed('fontFamily') ? t('Mixed') : undefined}
          onPreview={(family) => previewFont({ fontFamily: family })}
          onFamilyChange={handleFontFamilyChange}
          onWeightsChange={setAvailableWeights}
        />
      </ControlRow>

      <ControlRow label={t("Sizing")} contentClass="flex gap-2 items-center">
        <Select
          class="flex-1 min-w-0"
          value={selectedWeight()}
          onChange={v => handleFontWeightChange(v ?? '400')}
          onOpenChange={(isOpen) => { weightsOpen = isOpen; }}
          options={weightOptions().map(w => w.value)}
          itemComponent={itemProps => (
            <SelectItem
              item={itemProps.item}
              onPointerEnter={() => { if (weightsOpen) previewFont({ fontWeight: itemProps.item.rawValue }); }}
            >
              {t(weightOptions().find(w => w.value === itemProps.item.rawValue)?.label ?? '')}
            </SelectItem>
          )}
        >
          <SelectTrigger>
            <SelectValue>
              {mixed('fontWeight') ? t('Mixed') : t(weightOptions().find(w => w.value === selectedWeight())?.label ?? '')}
            </SelectValue>
          </SelectTrigger>
          <SelectPortal>
            <SelectContent onCloseAutoFocus={() => previewFont({ fontWeight: selectedWeight() })} />
          </SelectPortal>
        </Select>

        <ControlledTextField
          class="flex-1"
          value={mixed('fontSize') ? t('Mixed') : fontSize()}
          onNumber={(v) => editor.editProperty(entity(), 'fontSize', v)}
          step={1}
          min={1}
          autoSelect
          limitEvents
        />
      </ControlRow>

      <ControlRow
        label={t("Flow")}
        labelClass="opacity-0"
        contentClass="grid grid-cols-2 gap-2"
      >
        <Show when={!props.words}>
          <ControlledTextField
            icon={<Icon name="text.line-height" />}
            value={Math.round(leading() * 100)}
            onNumber={(v) => editor.editProperty(entity(), 'leading', v === 100 ? false : v / 100)}
            unit="%"
            step={1}
            min={0}
            max={1200}
            autoSelect
            sliderEnabled
            limitEvents
          />
        </Show>
        <ControlledTextField
          icon={<Icon name="text.letter-spacing" />}
          value={mixed('letterSpacing') ? t('Mixed') : letterSpacing()}
          onNumber={(v) => editor.editProperty(entity(), 'letterSpacing', v === 0 ? false : v)}
          unit="px"
          step={1}
          min={-1200}
          max={1200}
          autoSelect
          sliderEnabled
          limitEvents
        />
      </ControlRow>

      <Show when={textSelected()}>
        <ControlRow label={t("Grow")}>
          <SegmentedIconTabs
            value={resizeMode}
            onChange={handleResizeModeChange}
            items={RESIZE_MODE_ITEMS.map((item) => ({ ...item, label: t(item.label) }))}
          />
        </ControlRow>
      </Show>

      <Show when={!props.words}>
        <ControlRow label={t("Align")} contentClass="flex gap-2">
          <SegmentedIconTabs
            class="flex-1"
            value={() => HORIZONTAL_ALIGNS[textAlign()] ?? 'left'}
            onChange={(v) => editor.editProperty(entity(), 'textAlign', v === 'left' ? false : v)}
            items={HORIZONTAL_ALIGN_TABS.map((item) => ({ ...item, label: t(item.label) }))}
          />
          <SegmentedIconTabs
            class="flex-1"
            value={() => VERTICAL_ALIGNS[textBaseline()] ?? 'top'}
            onChange={(v) => editor.editProperty(entity(), 'textBaseline', v === 'top' ? false : v)}
            items={VERTICAL_ALIGN_TABS.map((item) => ({ ...item, label: t(item.label) }))}
          />
        </ControlRow>
      </Show>

      {/* A picked caption word's own motion. A whole caption has Motion in its
          Caption section (and Pop/Bounce under Animations), a plain text the
          Animations section. */}
      <Show when={props.words}>
        <ControlRow label={t("Motion")} contentClass="flex flex-wrap gap-1">
          <For each={TEXT_MOTION_PRESETS}>
            {(preset) => (
              <Button
                size="small"
                variant={motionPreset() === preset.name && !mixed('animations') ? 'on' : 'secondary'}
                onClick={() => applyMotion(preset.name)}
              >
                {t(preset.label)}
              </Button>
            )}
          </For>
        </ControlRow>
      </Show>
    </PanelSection>
  );
}

type FontDropdownProps = {
  family: string;
  /** Shown instead of the family, which is still what the picker checks. */
  label?: string | undefined;
  onPreview(family: string): void;
  onFamilyChange(family: string): void;
  onWeightsChange(weights: string[]): void;
};

export function FontDropdown(props: FontDropdownProps) {
  const [webfonts] = createSignal(getWebFonts());
  const [fontQuery, setFontQuery] = createSignal('');
  const fontsPermission = usePermissionState('local-fonts');

  // Preload web fonts for preview
  onMount(() => {
    if (document.visibilityState !== 'visible') return;
    for (const family of Object.keys(WebFonts)) {
      const config = WebFonts[family as keyof typeof WebFonts];
      const face = new FontFace(family, `url(${config.url})`, { weight: '400' });
      face.load().then((f) => document.fonts.add(f)).catch(() => { });
    }
  });

  const [localFonts, { refetch }] = createResource(fontsPermission, async (state) => {
    if (state !== 'granted') return [];
    try {
      return await getLocalFonts();
    } catch {
      toast.error(t('Failed to access local fonts, please configure the browser to allow access'));
      return [];
    }
  });

  // Report available weights whenever the family changes
  const allFonts = createMemo(() => [...webfonts(), ...(settled(localFonts) ?? [])]);

  createEffect(() => {
    const match = allFonts().find(f => f.family === props.family);
    const weights = match?.variants.map(v => v.weight).filter((w): w is string => !!w) ?? [];
    props.onWeightsChange([...new Set(weights)]);
  });

  const filteredWebFonts = createMemo(() => {
    const q = fontQuery().trim().toLowerCase();
    if (!q) return webfonts();
    return webfonts().filter((f) => f.family.toLowerCase().includes(q));
  });

  const filteredLocalFonts = createMemo(() => {
    const q = fontQuery().trim().toLowerCase();
    const fonts = settled(localFonts);
    if (!fonts?.length) return [];
    if (!q) return fonts;
    return fonts.filter((f) => f.family.toLowerCase().includes(q));
  });

  // A closing list still hears the pointer pass over it: only an open one previews.
  let open = false;
  const preview = (family: string) => {
    if (open) props.onPreview(family);
  };

  const handleOpenChange = (isOpen: boolean) => {
    open = isOpen;
    setFontQuery('');
    // Whatever was hovered last goes: only a selection authors a family, and
    // `family` is the authored one whether or not this picker changed it.
    if (!isOpen) props.onPreview(props.family);
  };

  const handleGrantAccess = async () => {
    if (typeof window.queryLocalFonts !== 'function') {
      toast.error(t('Local fonts are not supported in this browser'));
      return;
    }
    try {
      await window.queryLocalFonts();
      refetch();
    } catch {
      toast.error(t('Failed to access local fonts, please configure the browser to allow access'));
    }
  };

  return (
    <DropdownMenu onOpenChange={handleOpenChange} placement="left" sameWidth gutter={8}>
      <DropdownMenuTrigger
        class={cx(
          "bg-input h-7 hover:bg-input/80 text-foreground data-placeholder:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex w-full items-center gap-0 rounded-md pl-2 pr-0 text-xs whitespace-nowrap transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50",
          "relative overflow-hidden focus-ring justify-between",
          "*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        )}
      >
        {props.label ?? props.family}
        <Icon name="chevron-down" class="size-6 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="max-h-[700px] w-58 flex flex-col">
          <div class="relative flex h-7 items-center shrink-0">
            <Icon name="search" class="size-6 text-muted-foreground" />
            <input
              type="text"
              value={fontQuery()}
              onInput={(e) => setFontQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') return;
                e.stopPropagation();
              }}
              placeholder={t("Search")}
              aria-label={t("Search fonts")}
              autocomplete="off"
              class="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
          <DropdownMenuSeparator />
          <div class="overflow-y-auto flex-1 flex flex-col gap-2">
            <DropdownMenuGroup>
              <DropdownMenuGroupLabel>{t("Web Fonts")}</DropdownMenuGroupLabel>
              <For each={filteredWebFonts()}>
                {(font) => (
                  <LazyFontItem
                    family={font.family}
                    checked={props.family === font.family}
                    onPointerEnter={preview}
                    onSelect={props.onFamilyChange}
                  >
                    {font.family}
                  </LazyFontItem>
                )}
              </For>
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuGroupLabel>{t("System Fonts")}</DropdownMenuGroupLabel>
              <Show when={!localFonts.latest?.length}>
                <Button
                  variant="secondary"
                  class="text-foreground gap-0"
                  onClick={handleGrantAccess}
                >
                  <Icon name="lock-closed-small" class="size-6" />
                  <span class="mr-3">{t("Grant Access")}</span>
                </Button>
              </Show>
              <Show when={filteredLocalFonts().length}>
                <For each={filteredLocalFonts()}>
                  {(font) => (
                    <LazyFontItem
                      family={font.family}
                      checked={props.family === font.family}
                      onPointerEnter={preview}
                      onSelect={props.onFamilyChange}
                    >
                      {font.family}
                    </LazyFontItem>
                  )}
                </For>
              </Show>
            </DropdownMenuGroup>
          </div>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}

type GrowingTextAreaProps = {
  value: string;
  onInput(value: string): void;
  maxRows?: number;
  focused?: boolean;
  onBlur?(): void;
  onFocus?(): void;
};

export function GrowingTextArea(props: GrowingTextAreaProps) {
  let ref!: HTMLTextAreaElement;
  const lineHeight = 18; // matches text-xs leading
  const maxRows = () => props.maxRows ?? 8;

  const resize = () => {
    if (!ref) return;
    ref.style.height = 'auto';
    const max = lineHeight * maxRows() + 8; // 8px for py-1
    ref.style.height = `${Math.min(ref.scrollHeight, max)}px`;
  };

  // Resize when value changes externally (e.g. undo/redo, selection change)
  createEffect(() => {
    props.value;
    resize();
  });

  createEffect(() => {
    if (props.focused) {
      ref.focus();
      ref.select();
    }
  });

  const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    props.onInput(e.currentTarget.value);
    resize();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ref.blur();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      ref.blur();
    }
  };

  return (
    <textarea
      ref={ref!}
      value={props.value}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      rows={1}
      class="bg-input h-7 rounded-md px-2 py-1 text-xxs text-foreground placeholder:text-muted-foreground outline-none resize-none w-full focus-ring overflow-y-auto"
      style={{ 'line-height': `${lineHeight}px` }}
    />
  );
}

type LazyFontItemProps = {
  family: string;
  checked: boolean;
  onPointerEnter: (family: string) => void;
  onSelect: (family: string) => void;
  children: string;
};

function LazyFontItem(props: LazyFontItemProps) {
  let ref!: HTMLDivElement;
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0 },
    );
    observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  return (
    <DropdownMenuCheckboxItem
      ref={ref}
      checked={props.checked}
      closeOnSelect
      onSelect={() => props.onSelect(props.family)}
      onPointerEnter={() => props.onPointerEnter(props.family)}
      style={visible() ? { 'font-family': `'${props.family}', Inter` } : undefined}
    >
      <span class="truncate leading-none">{props.children}</span>
    </DropdownMenuCheckboxItem>
  );
}

/** The runtime's names for the weights (FONT_WEIGHTS), marked for translating. */
const FONT_WEIGHT_LABELS: Record<string, string> = {
  '100': msg({ message: 'Thin', context: 'font weight' }),
  '200': msg({ message: 'Extra Light', context: 'font weight' }),
  '300': msg({ message: 'Light', context: 'font weight' }),
  '400': msg({ message: 'Normal', context: 'font weight' }),
  '500': msg({ message: 'Medium', context: 'font weight' }),
  '600': msg({ message: 'Semi Bold', context: 'font weight' }),
  '700': msg({ message: 'Bold', context: 'font weight' }),
  '800': msg({ message: 'Extra Bold', context: 'font weight' }),
  '900': msg({ message: 'Black', context: 'font weight' }),
};

const ALL_FONT_WEIGHTS = Object.entries(FONT_WEIGHTS).map(([value, label]) => ({ value, label: FONT_WEIGHT_LABELS[value] ?? label }));

const HORIZONTAL_ALIGN_TABS = [
  { value: 'left', label: msg('Align left'), icon: 'text.align-left' },
  { value: 'center', label: msg('Align center'), icon: 'text.align-center' },
  { value: 'right', label: msg('Align right'), icon: 'text.align-right' },
] as const;

const VERTICAL_ALIGN_TABS = [
  { value: 'top', label: msg('Align top'), icon: 'text.align-top' },
  { value: 'middle', label: msg('Align middle'), icon: 'text.align-middle' },
  { value: 'bottom', label: msg('Align bottom'), icon: 'text.align-bottom' },
] as const;

// The trait's enum in the prop's vocabulary, which is what a tab is worth.
const HORIZONTAL_ALIGNS: Record<TextAlign, string> = {
  [TextAlign.LEFT]: 'left',
  [TextAlign.CENTER]: 'center',
  [TextAlign.RIGHT]: 'right',
};

const VERTICAL_ALIGNS: Record<TextBaseline, string> = {
  [TextBaseline.TOP]: 'top',
  [TextBaseline.MIDDLE]: 'middle',
  [TextBaseline.BOTTOM]: 'bottom',
  // No tab offers a first-line baseline; it reads as the top one.
  [TextBaseline.ALPHABETIC]: 'top',
};
