/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { COLOR_MODE_STORAGE_KEY, useColorMode } from "@kobalte/core";
import { createEffect, createSignal } from "solid-js";
import { t } from "@/lib/i18n";
import type { Theme } from "./types";

const getStoredThemePreference = (): Theme | undefined => {
  if (typeof window === "undefined") return undefined;

  try {
    const stored = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // ignore storage access errors and fall back to resolved color mode
  }

  return undefined;
};

export function PreferencesMenu() {
  const { colorMode, setColorMode } = useColorMode();

  const [snapToGeometry, setSnapToGeometry] = createSignal(true);
  const [snapToObjects, setSnapToObjects] = createSignal(true);
  const [showInfoTooltips, setShowInfoTooltips] = createSignal(true);
  const [useNumberKeysForOpacity, setUseNumberKeysForOpacity] =
    createSignal(true);
  const [invertedZoomDirection, setInvertedZoomDirection] =
    createSignal(false);
  const [timelineSnapping, setTimelineSnapping] = createSignal(true);
  const [showSeekIndicatorOnTimeline, setShowSeekIndicatorOnTimeline] =
    createSignal(false);
  const [onlyShowSelectedClipsKeyframes, setOnlyShowSelectedClipsKeyframes] =
    createSignal(false);
  const [theme, setThemePreference] = createSignal<Theme>("dark");

  createEffect(() => {
    const resolvedColorMode = colorMode();
    setThemePreference(getStoredThemePreference() ?? resolvedColorMode);
  });

  const setTheme = (nextTheme: Theme) => {
    setThemePreference(nextTheme);
    setColorMode(nextTheme);
  };

  const resetToDefaults = () => {
    setSnapToGeometry(true);
    setSnapToObjects(true);
    setShowInfoTooltips(true);
    setUseNumberKeysForOpacity(true);
    setInvertedZoomDirection(false);
    setTimelineSnapping(true);
    setShowSeekIndicatorOnTimeline(false);
    setOnlyShowSelectedClipsKeyframes(false);
    setTheme("dark");
  };

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Files & permissions...")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Keyboard shortcuts...")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={snapToGeometry()}
          onChange={setSnapToGeometry}
        >
          {t("Snap to geometry")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={snapToObjects()}
          onChange={setSnapToObjects}
        >
          {t("Snap to objects")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={showInfoTooltips()}
          onChange={setShowInfoTooltips}
        >
          {t("Show info tooltips")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={useNumberKeysForOpacity()}
          onChange={setUseNumberKeysForOpacity}
        >
          {t("Use number keys for opacity")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={invertedZoomDirection()}
          onChange={setInvertedZoomDirection}
        >
          {t("Inverted zoom direction")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={timelineSnapping()}
          onChange={setTimelineSnapping}
        >
          {t("Timeline snapping")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={showSeekIndicatorOnTimeline()}
          onChange={setShowSeekIndicatorOnTimeline}
        >
          {t("Show seek indicator on timeline")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={onlyShowSelectedClipsKeyframes()}
          onChange={setOnlyShowSelectedClipsKeyframes}
        >
          {t("Only show selected clips’ keyframes")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem>{t("Editor nudge amount...")}</DropdownMenuItem>
        <DropdownMenuItem>{t("Timeline nudge amount...")}</DropdownMenuItem>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{t("Theme")}</DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent class="w-[152px]">
              <DropdownMenuRadioGroup
                value={theme()}
                onChange={(value) => setTheme(value as Theme)}
              >
                <DropdownMenuRadioItem value="light">
                  {t("Light")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  {t("Dark")}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  {t("System theme")}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <DropdownMenuSeparator />

      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={resetToDefaults}>
          {t("Reset all to default")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}
