/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Show, createContext, useContext } from "solid-js";

import { t } from "@/lib/i18n";

import type { WordSetting } from "@/lib/caption-word-style";

const NONE: ReadonlySet<WordSetting> = new Set();

const WordMix = createContext<() => ReadonlySet<WordSetting>>(() => NONE);

export const WordMixProvider = WordMix.Provider;

export function useMixed(): (setting: WordSetting) => boolean {
  const mix = useContext(WordMix);
  return (setting) => mix().has(setting);
}

export function MixedTag(props: { when: boolean }) {
  return (
    <Show when={props.when}>
      <span class="text-muted-foreground">{t("Mixed")}</span>
    </Show>
  );
}
