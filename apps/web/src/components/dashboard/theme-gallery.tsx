/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { For, Show, createMemo, createSignal, lazy, Suspense, type JSX } from "solid-js";
import { toast } from "somoto";

import { Icon } from "@/components/dashboard/dashboard-icon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { THEME_PRESETS, activeThemeId, customThemes, deleteTheme, saveTheme, selectTheme, type SavedTheme } from "@/lib/app-theme";
import { fieldControlBase } from "@/components/calendar/popup";
import { cx } from "@/lib/cva";
import { dashboardTheme, setDashboardTheme, themeModeChoice, type ThemeModeChoice } from "@/lib/dashboard-theme";
import { msg, t } from "@/lib/i18n";
import { DEFAULT_THEME, decodeThemeCode, encodeThemeCode, resolvePalette, type ThemeSpec } from "@/lib/theme-palette";

import { PageToggle } from "./page-toggle";
import { DashboardFormModal, DashboardSurfaceCard, DashboardTitledSection } from "./shared";
import { ThemeDashboardArt } from "./theme-art";

const ThemeBuilder = lazy(() => import("./theme-builder").then((module) => ({ default: module.ThemeBuilder })));

const MODES: { value: ThemeModeChoice; label: string }[] = [
  { value: "light", label: msg("Light") },
  { value: "dark", label: msg("Dark") },
  { value: "system", label: msg({ message: "System", context: "appearance" }) },
];

type BuilderStart = { id: string | null; name: string; spec: ThemeSpec };

function ThemeTile(props: { theme: SavedTheme; label: string; menu: JSX.Element }) {
  const selected = () => activeThemeId() === props.theme.id;
  const palette = createMemo(() => resolvePalette(props.theme.spec, dashboardTheme()));
  return (
    <div class="group relative min-w-0">
      <button
        type="button"
        role="radio"
        aria-checked={selected()}
        class="flex w-full min-w-0 flex-col gap-1.5 rounded-lg text-left outline-none focus-ring"
        onClick={() => selectTheme(props.theme.id)}
      >
        <ThemeDashboardArt
          palette={palette()}
          class={cx(
            "block aspect-[16/10] w-full rounded-lg ring-1 transition-shadow",
            selected() ? "ring-2 ring-(--plane-accent-primary)" : "ring-(--plane-border-subtle-1) group-hover:ring-(--plane-border-strong)",
          )}
        />
        <span class="truncate px-0.5 text-sm text-(--plane-text-primary)">{props.label}</span>
      </button>
      <div class="absolute top-1 right-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-expanded]]:opacity-100 max-md:opacity-100">
        {props.menu}
      </div>
    </div>
  );
}

function ImportModal(props: { onClose(): void }) {
  const [code, setCode] = createSignal("");
  const add = () => {
    const decoded = decodeThemeCode(code());
    if (!decoded) {
      toast.error(t("That theme code isn't valid"));
      return;
    }
    saveTheme({ name: decoded.name || t("My theme"), spec: decoded.spec });
    props.onClose();
  };
  return (
    <DashboardFormModal
      open
      title={t("Import a theme")}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("Cancel")}
          </Button>
          <Button disabled={!code().trim()} onClick={add}>
            {t("Add theme")}
          </Button>
        </>
      }
    >
      <textarea
        aria-label={t("Theme code")}
        class={cx(fieldControlBase, "h-24 resize-none py-1.5 font-mono select-text")}
        placeholder={t("Paste a theme code")}
        spellcheck={false}
        value={code()}
        onInput={(event) => setCode(event.currentTarget.value)}
      />
    </DashboardFormModal>
  );
}

export function ThemeSection() {
  const [builder, setBuilder] = createSignal<BuilderStart | null>(null);
  const [importing, setImporting] = createSignal(false);

  const label = (theme: SavedTheme) => (theme.name === "plan.video" ? theme.name : t(theme.name));

  const copyCode = async (theme: SavedTheme) => {
    try {
      await navigator.clipboard.writeText(encodeThemeCode(theme.name, theme.spec));
      toast.success(t("Theme code copied"));
    } catch {
      toast.error(t("Couldn't copy the theme code"));
    }
  };

  const menu = (theme: SavedTheme, custom: boolean) => (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger
        as="button"
        type="button"
        aria-label={t("{name} options", { name: custom ? theme.name : label(theme) })}
        class="grid size-6 place-items-center rounded-md bg-(--plane-surface-1) text-(--plane-text-secondary) ring-1 ring-(--plane-border-subtle-1) press hover:text-(--plane-text-primary) focus-ring"
      >
        <Icon name="more-three-dots-small-horizontal" class="size-6" />
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="w-44">
          <DropdownMenuItem onSelect={() => setBuilder(custom ? theme : { id: null, name: t("My theme"), spec: theme.spec })}>
            {custom ? t("Edit") : t("Customize")}
          </DropdownMenuItem>
          <Show when={custom}>
            <DropdownMenuItem onSelect={() => saveTheme({ name: theme.name, spec: theme.spec })}>{t("Duplicate")}</DropdownMenuItem>
          </Show>
          <DropdownMenuItem onSelect={() => void copyCode(theme)}>{t("Copy theme code")}</DropdownMenuItem>
          <Show when={custom}>
            <DropdownMenuItem variant="destructive" onSelect={() => deleteTheme(theme.id)}>
              {t("Delete")}
            </DropdownMenuItem>
          </Show>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  );

  return (
    <DashboardTitledSection
      title={t("Appearance")}
      action={
        <div class="flex items-center">
          <Button variant="secondary" class="rounded-r-none" onClick={() => setBuilder({ id: null, name: t("My theme"), spec: DEFAULT_THEME })}>
            {t("New theme")}
          </Button>
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger
              as={Button}
              variant="secondary"
              size="icon"
              aria-label={t("More options")}
              class="-ml-px rounded-l-none text-(--plane-text-secondary)"
            >
              <Icon name="chevron-down" class="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-40">
                <DropdownMenuItem onSelect={() => setImporting(true)}>{t("Import a theme")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </div>
      }
    >
      <DashboardSurfaceCard class="flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-(--plane-text-primary)">{t("Mode")}</span>
          <PageToggle label={t("Mode")} options={MODES} value={themeModeChoice()} onChange={setDashboardTheme} />
        </div>
        <div role="radiogroup" aria-label={t("Theme")} class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <For each={THEME_PRESETS}>{(theme) => <ThemeTile theme={theme} label={label(theme)} menu={menu(theme, false)} />}</For>
          <For each={customThemes()}>{(theme) => <ThemeTile theme={theme} label={theme.name} menu={menu(theme, true)} />}</For>
        </div>
      </DashboardSurfaceCard>
      <Show when={builder()} keyed>
        {(start) => (
          <Suspense>
            <ThemeBuilder start={start} onClose={() => setBuilder(null)} />
          </Suspense>
        )}
      </Show>
      <Show when={importing()}>
        <ImportModal onClose={() => setImporting(false)} />
      </Show>
    </DashboardTitledSection>
  );
}
